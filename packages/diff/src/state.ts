/**
 * @clapp/diff — the STATE diff dimension.
 *
 * Post-run storage verification of the CANDIDATE (right side) against the
 * plan's PlannedStorageBinding[] baseline — the plan declares "a storage
 * key the candidate app is planned to write" after the transitions listed
 * in `writtenOn` (the codegen emits cookie writes as Set-Cookie headers on
 * the writtenOn route and local/session writes as inline scripts there).
 *
 * Honesty rules (binding, per the contract's own scope note):
 * - cookie bindings are verified via the Set-Cookie response headers the
 *   right side's captures observed on the writtenOn route — this works
 *   under BOTH drivers (the dom applier's fetches carry response headers);
 * - localStorage/sessionStorage bindings are recorded ONLY when a browser
 *   driver ran (replayer-playwright): the dom applier does not execute
 *   page scripts, so under replayer-dom the finding is an 'info' entry
 *   documenting the limitation — a present ls/ss entry is NEVER fabricated
 *   from a non-browser run;
 * - 'server' storage bindings are not client-observable (the mock backend
 *   is stateless): an 'info' entry records that;
 * - a binding whose writtenOn route the journey never visited is recorded
 *   as 'info' (not exercised in this paired run) — absence of evidence is
 *   not evidence of absence;
 * - with NO plan provided there is no storage baseline: zero state
 *   findings (absence is honest, not an error).
 *
 * The left (reference) side's storage captures are recorded as evidence
 * context in SideRunResult.storageIds; the plan is the candidate's
 * baseline, so state findings anchor the right side's captures (and cite
 * the left's page evidence when the same route was visited there).
 */

import type { PlannedStorageBinding, SynthesisPlan } from '@clapp/plan';
import type { DiffAnchor, DiffFinding, PairedRun } from './diff-contract';
import type { SideCaptureBundle, StorageCapturePayload } from './capture';
import type { DiffIdFactory } from './ids';
import { normalizeRoutePath } from './page-features';

export interface StateDiffInput {
  run: PairedRun;
  plan?: SynthesisPlan;
  captures?: { left: SideCaptureBundle; right: SideCaptureBundle };
  ids: DiffIdFactory;
}

/** The to-route paths a binding's writtenOn transitions navigate to. */
function writtenOnPaths(plan: SynthesisPlan, binding: PlannedStorageBinding): { paths: string[]; resolvable: boolean } {
  const transitionsById = new Map(plan.navigation.map((transition) => [transition.id, transition]));
  const routesById = new Map(plan.routes.map((route) => [route.id, route]));
  const paths: string[] = [];
  let resolvable = binding.writtenOn.length > 0;
  for (const transitionId of binding.writtenOn) {
    const transition = transitionsById.get(transitionId);
    if (transition === undefined) {
      resolvable = false;
      continue;
    }
    const route = routesById.get(transition.toRouteId);
    if (route === undefined) {
      resolvable = false;
      continue;
    }
    if (!paths.includes(route.path)) {
      paths.push(route.path);
    }
  }
  return { paths, resolvable };
}

interface RouteVisit {
  stepIndex: number;
  captureId: string;
}

/** The first step at which the right side visited one of the given paths. */
function firstVisitOnRight(bundle: SideCaptureBundle | undefined, paths: string[]): RouteVisit | undefined {
  if (bundle === undefined) {
    return undefined;
  }
  const sorted = [...bundle.pageAtStep.entries()].sort((a, b) => a[0] - b[0]);
  for (const [stepIndex, captureId] of sorted) {
    const entry = bundle.byCaptureId.get(captureId);
    if (entry === undefined || entry.kind !== 'dom') {
      continue;
    }
    const url = (entry.payload as { url: string }).url;
    if (paths.includes(normalizeRoutePath(url))) {
      return { stepIndex, captureId };
    }
  }
  return undefined;
}

function anchorFor(
  run: PairedRun,
  captures: StateDiffInput['captures'],
  binding: PlannedStorageBinding,
  visit: RouteVisit | undefined,
): DiffAnchor {
  const stepIndex = visit !== undefined ? visit.stepIndex : Math.max(0, run.runs.right.stepsCompleted - 1);
  const sourceIds = [binding.id, ...binding.writtenOn, ...binding.sourceEntityIds];
  const anchor: DiffAnchor = { stepIndex, sourceIds };
  if (captures !== undefined) {
    if (visit !== undefined) {
      const rightEntry = captures.right.byCaptureId.get(visit.captureId);
      if (rightEntry !== undefined) {
        anchor.rightEvidence = rightEntry.evidence;
      }
      const leftCaptureId = captures.left.pageAtStep.get(visit.stepIndex);
      const leftEntry = leftCaptureId !== undefined ? captures.left.byCaptureId.get(leftCaptureId) : undefined;
      if (leftEntry !== undefined) {
        anchor.leftEvidence = leftEntry.evidence;
      }
    } else {
      anchor.rightEvidence = run.runs.right.evidenceRef;
      anchor.leftEvidence = run.runs.left.evidenceRef;
    }
  }
  return anchor;
}

/** Cookie observations on the writtenOn paths, from the right side's network captures. */
function cookieObservations(
  bundle: SideCaptureBundle | undefined,
  paths: string[],
  key: string,
): { path: string; setCookie: string[]; matched: boolean }[] {
  if (bundle === undefined) {
    return [];
  }
  const observations: { path: string; setCookie: string[]; matched: boolean }[] = [];
  for (const entry of bundle.entries) {
    if (entry.kind !== 'network') {
      continue;
    }
    const payload = entry.payload as { url: string; setCookie: string[] };
    const path = normalizeRoutePath(payload.url);
    if (!paths.includes(path)) {
      continue;
    }
    observations.push({
      path,
      setCookie: [...payload.setCookie],
      matched: payload.setCookie.some((header) => header.startsWith(`${key}=`)),
    });
  }
  return observations;
}

/** The right side's storage inventory payloads (browser or header-derived). */
function storagePayloads(bundle: SideCaptureBundle | undefined): StorageCapturePayload[] {
  if (bundle === undefined) {
    return [];
  }
  return bundle.entries
    .filter((entry) => entry.kind === 'storage')
    .map((entry) => entry.payload as StorageCapturePayload);
}

/** Computes the STATE dimension findings for one paired run. */
export function computeStateFindings(input: StateDiffInput): DiffFinding[] {
  const { run, plan, captures, ids } = input;
  if (plan === undefined) {
    return []; // no storage baseline: absence is honest, not an error
  }
  const findings: DiffFinding[] = [];
  const driver = run.right.driver;

  for (const binding of plan.storage) {
    const { paths, resolvable } = writtenOnPaths(plan, binding);
    const visit = captures !== undefined ? firstVisitOnRight(captures.right, paths) : undefined;
    const anchor = anchorFor(run, captures, binding, visit);
    const push = (severity: DiffFinding['severity'], summary: string, expected?: unknown, actual?: unknown): void => {
      const finding: DiffFinding = {
        id: ids.newFindingId(),
        dimension: 'state',
        severity,
        summary,
        anchors: [anchor],
      };
      if (expected !== undefined) {
        finding.expected = expected;
      }
      if (actual !== undefined) {
        finding.actual = actual;
      }
      findings.push(finding);
    };

    if (!resolvable) {
      push(
        'info',
        `Storage binding ${binding.id} (${binding.storage} "${binding.key}") names writtenOn transitions missing from the plan's navigation — unverifiable in this run.`,
      );
      continue;
    }

    if (binding.storage === 'cookie') {
      if (visit === undefined) {
        push(
          'info',
          `Planned cookie "${binding.key}" was not exercised: the journey never visited its writtenOn route(s) [${paths.join(', ')}] on the candidate.`,
          { storage: 'cookie', key: binding.key, writtenOnPaths: paths },
        );
        continue;
      }
      const observations = cookieObservations(captures?.right, paths, binding.key);
      const observed = observations.filter((observation) => observation.matched);
      if (observed.length > 0) {
        const first = observed[0];
        push(
          'info',
          `Planned cookie "${binding.key}" observed via Set-Cookie on the writtenOn route "${first?.path ?? ''}" as planned.`,
          { storage: 'cookie', key: binding.key, writtenOnPaths: paths },
          { storage: 'cookie', key: binding.key, route: first?.path ?? '', setCookie: first?.setCookie ?? [] },
        );
      } else {
        const first = observations[0];
        push(
          'major',
          `Planned cookie "${binding.key}" MISSING: the candidate's observed responses on the writtenOn route(s) [${paths.join(', ')}] carried no matching Set-Cookie header.`,
          { storage: 'cookie', key: binding.key, writtenOnPaths: paths, setCookieExpected: `${binding.key}=…` },
          { storage: 'cookie', key: binding.key, route: first?.path ?? '', setCookieObserved: first?.setCookie ?? [] },
        );
      }
      continue;
    }

    if (binding.storage === 'localStorage' || binding.storage === 'sessionStorage') {
      if (driver === 'replayer-dom') {
        push(
          'info',
          `Planned ${binding.storage} key "${binding.key}" is NOT VERIFIABLE under replayer-dom: the dom applier does not execute page scripts, so no inventory entry exists — none was fabricated (visit a browser-driver pair to verify).`,
          { storage: binding.storage, key: binding.key, writtenOnPaths: paths, exercised: visit !== undefined },
          { storage: binding.storage, key: binding.key, verified: false, limitation: 'replayer-dom executes no page scripts' },
        );
        continue;
      }
      // replayer-playwright: a real browser inventory was captured.
      const inventories = storagePayloads(captures?.right);
      if (visit === undefined) {
        push(
          'info',
          `Planned ${binding.storage} key "${binding.key}" was not exercised: the journey never visited its writtenOn route(s) [${paths.join(', ')}] on the candidate.`,
          { storage: binding.storage, key: binding.key, writtenOnPaths: paths },
        );
        continue;
      }
      const inventory = inventories[inventories.length - 1];
      const entries = binding.storage === 'localStorage' ? inventory?.localStorage ?? [] : inventory?.sessionStorage ?? [];
      const present = entries.some((entry) => entry.key === binding.key);
      if (present) {
        push(
          'info',
          `Planned ${binding.storage} key "${binding.key}" observed in the post-run browser inventory as planned.`,
          { storage: binding.storage, key: binding.key },
          { storage: binding.storage, key: binding.key, present: true },
        );
      } else {
        push(
          'major',
          `Planned ${binding.storage} key "${binding.key}" MISSING from the post-run browser inventory despite the writtenOn route being visited.`,
          { storage: binding.storage, key: binding.key, present: true },
          { storage: binding.storage, key: binding.key, present: false, observedKeys: entries.map((entry) => entry.key) },
        );
      }
      continue;
    }

    // storage === 'server'
    push(
      'info',
      `Planned server-storage key "${binding.key}" is not client-observable (the candidate's mock backend is stateless) — recorded, not verified.`,
      { storage: 'server', key: binding.key },
    );
  }

  return findings;
}
