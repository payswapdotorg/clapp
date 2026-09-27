/**
 * @clapp/diff — the paired differential runner (CLAPP-040 spine).
 *
 * `createPairedRunner(options)` builds the contract's {@link PairedRunner}:
 *
 * - runPair(journeyId) replays ONE journey on BOTH sides with the SAME
 *   driver vocabulary — createDomApplier('replayer-dom') or
 *   createPlaywrightApplier('replayer-playwright') — driving the actions
 *   one at a time through a symmetric capture pipeline (see capture.ts):
 *   per-step page captures, network captures, and a post-run storage
 *   inventory per side, all sealed into a root-hash-verifiable side
 *   bundle. Asymmetric capture capability is RECORDED honestly (absent
 *   entries), never fabricated.
 *
 * - diff(run) computes the SEMANTIC and STATE dimension findings for one
 *   paired run (semantic.ts / state.ts). Runs produced by this runner
 *   carry their captures (a WeakMap); a hand-constructed PairedRun for a
 *   known journey diffs structurally only (run integrity — no page
 *   comparison is invented).
 *
 * - report(runs) re-diffs every run, aggregates the findings, and
 *   assembles the DiffReport with COMPUTED counts and the derived verdict
 *   ('equivalent' iff critical === 0).
 *
 * Determinism: identity minting and timestamps flow through injectable
 * id/time factories (documented in README "Determinism"); sides run
 * sequentially (left, then right) so a fixed factory sequence yields
 * byte-identical serialized reports for identical inputs.
 *
 * Browser-optional: the 'replayer-playwright' driver lazily imports
 * playwright-core (a devDependency, exactly the @clapp/journey precedent);
 * importing this module never requires a browser. When neither a browser
 * can be launched nor one injected, the affected side run fails HONESTLY
 * (completed: false with the reason) — it is never reported as a
 * capture-less success.
 */

import {
  createDomApplier,
  createPlaywrightApplier,
  validateJourney,
  validateJourneyDetailed,
  JourneyReplayError,
  type Journey,
} from '@clapp/journey';
import { ACTIONABLE_ROLES } from '@clapp/observe';
import {
  PLANNED_APPLICATION_ID_PATTERN,
  validateSynthesisPlanDetailed,
  type SynthesisPlan,
} from '@clapp/plan';
import type { Browser } from 'playwright-core';
import type {
  DiffFinding,
  DiffReport,
  PairedRun,
  PairedRunner,
  PairedTarget,
  SideRunResult,
} from './diff-contract';
import {
  CaptureCollector,
  browserStorageInventory,
  responseHeaderStorageInventory,
  type SideCaptureBundle,
} from './capture';
import { createDiffIdFactory, type DiffIdFactory } from './ids';
import { computeSemanticFindings, type PlanAnchorIndex } from './semantic';
import { computeStateFindings } from './state';
import { buildDiffReport } from './report';

/** Raised for options/validation/lookup failures (never for replay failures — those are honest SideRunResults). */
export class DiffRunnerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiffRunnerError';
  }
}

/** Options for {@link createPairedRunner}. */
export interface PairedRunnerOptions {
  /** The journeys this runner can pair (structurally validated at creation). */
  journeys: Journey[];
  /** The authorized original site's target (left side). */
  left: PairedTarget;
  /** The synthesized candidate's target (right side). */
  right: PairedTarget;
  /** The candidate's planned application id ("appsyn_" + uuid) — must equal right.targetId. */
  candidateAppId: string;
  /** The evidence corpus rootHash the left side derives from (64-char hex). */
  baselineRootHash: string;
  /**
   * Optional SynthesisPlan: the STATE baseline (PlannedStorageBinding[])
   * and the plan-id anchoring for findings. Validated at creation; its
   * application.id must equal candidateAppId.
   */
  plan?: SynthesisPlan;
  /**
   * Optional IR anchor: journeyId → the IR transition ids the journey
   * exercises (recorded on the PairedRun and cited by findings). Absent
   * entries are honest absence, never an error.
   */
  irAnchors?: Record<string, string[]>;
  /** Injectable id factory (default: crypto.randomUUID-based). */
  ids?: DiffIdFactory;
  /** Injectable clock (default: real time; ISO-8601 UTC via toISOString). */
  now?: () => Date;
  /** Injectable fetch for the dom driver (default: global fetch). */
  fetchImpl?: typeof fetch;
  /**
   * Injectable browser for the playwright driver (caller owns its
   * lifecycle). Absent → the runner lazily launches one chromium and
   * keeps it for the runner's lifetime (process-bound).
   */
  playwrightBrowser?: Browser;
}

interface RunCaptures {
  left: SideCaptureBundle;
  right: SideCaptureBundle;
}

const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

function describeReplayFailure(error: unknown): string {
  if (error instanceof JourneyReplayError) {
    return `${error.code}: ${error.message}`;
  }
  return String(error);
}

/** Validates the options once, at creation (fail fast, honestly). */
function validateOptions(options: PairedRunnerOptions): void {
  if (!Array.isArray(options.journeys) || options.journeys.length === 0) {
    throw new DiffRunnerError('paired-runner: options.journeys must be a non-empty array');
  }
  const seenJourneyIds = new Set<string>();
  for (const [index, journey] of options.journeys.entries()) {
    if (!validateJourney(journey)) {
      const { errors } = validateJourneyDetailed(journey);
      throw new DiffRunnerError(`paired-runner: journeys[${index}] fails structural validation: ${errors.join('; ')}`);
    }
    if (seenJourneyIds.has(journey.id)) {
      throw new DiffRunnerError(`paired-runner: duplicate journey id ${journey.id}`);
    }
    seenJourneyIds.add(journey.id);
  }
  for (const [field, expectedSide] of [['left', 'left'], ['right', 'right']] as const) {
    const target = options[field];
    if (target.side !== expectedSide) {
      throw new DiffRunnerError(`paired-runner: options.${field}.side must be "${expectedSide}"`);
    }
    try {
      new URL(target.baseUrl);
    } catch {
      throw new DiffRunnerError(`paired-runner: options.${field}.baseUrl must be a valid URL: ${target.baseUrl}`);
    }
    if (typeof target.targetId !== 'string' || target.targetId === '') {
      throw new DiffRunnerError(`paired-runner: options.${field}.targetId must be a non-empty string`);
    }
    if (target.driver !== 'replayer-dom' && target.driver !== 'replayer-playwright') {
      throw new DiffRunnerError(`paired-runner: options.${field}.driver must be 'replayer-dom' or 'replayer-playwright'`);
    }
  }
  if (options.left.driver !== options.right.driver) {
    throw new DiffRunnerError(
      `paired-runner: symmetric capture requires both sides to use the same driver (left: ${options.left.driver}, right: ${options.right.driver})`,
    );
  }
  if (!PLANNED_APPLICATION_ID_PATTERN.test(options.candidateAppId)) {
    throw new DiffRunnerError(
      `paired-runner: options.candidateAppId must match the planned application id pattern ("appsyn_" + uuid), got ${options.candidateAppId}`,
    );
  }
  if (options.right.targetId !== options.candidateAppId) {
    throw new DiffRunnerError(
      `paired-runner: options.right.targetId must equal options.candidateAppId (the contract defines the right target as the candidate app id)`,
    );
  }
  if (!SHA256_HEX_RE.test(options.baselineRootHash)) {
    throw new DiffRunnerError('paired-runner: options.baselineRootHash must be 64-char lowercase hex');
  }
  if (options.plan !== undefined) {
    const check = validateSynthesisPlanDetailed(options.plan);
    if (!check.valid) {
      throw new DiffRunnerError(`paired-runner: options.plan fails plan validation: ${check.errors.join('; ')}`);
    }
    if (options.plan.application.id !== options.candidateAppId) {
      throw new DiffRunnerError(
        `paired-runner: options.plan.application.id (${options.plan.application.id}) must equal options.candidateAppId (${options.candidateAppId})`,
      );
    }
  }
  if (options.irAnchors !== undefined) {
    const unknown = Object.keys(options.irAnchors).filter((key) => !seenJourneyIds.has(key));
    if (unknown.length > 0) {
      throw new DiffRunnerError(`paired-runner: options.irAnchors keys must be known journey ids; unknown: ${unknown.join(', ')}`);
    }
    for (const [key, value] of Object.entries(options.irAnchors)) {
      if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
        throw new DiffRunnerError(`paired-runner: options.irAnchors["${key}"] must be an array of transition id strings`);
      }
    }
  }
}

/** Builds the plan-id anchor index (route path → ids) when a plan is given. */
function buildPlanAnchors(plan: SynthesisPlan | undefined): PlanAnchorIndex | undefined {
  if (plan === undefined) {
    return undefined;
  }
  const routeIdsByPath = new Map<string, string[]>();
  const pageIdsByRouteId = new Map<string, string>();
  for (const route of plan.routes) {
    const ids = routeIdsByPath.get(route.path) ?? [];
    ids.push(route.id);
    routeIdsByPath.set(route.path, ids);
    pageIdsByRouteId.set(route.id, route.pageId);
  }
  return { routeIdsByPath, pageIdsByRouteId };
}

/** Creates the paired differential runner (the contract's PairedRunner). */
export function createPairedRunner(options: PairedRunnerOptions): PairedRunner {
  validateOptions(options);

  const journeysById = new Map(options.journeys.map((journey) => [journey.id, journey]));
  const ids = options.ids ?? createDiffIdFactory();
  const now = options.now ?? (() => new Date());
  const planAnchors = buildPlanAnchors(options.plan);
  const capturesByRun = new WeakMap<PairedRun, RunCaptures>();
  let cachedBrowser: Promise<Browser> | undefined;

  const getBrowser = (): Promise<Browser> => {
    if (options.playwrightBrowser !== undefined) {
      return Promise.resolve(options.playwrightBrowser);
    }
    if (cachedBrowser === undefined) {
      cachedBrowser = (async () => {
        const playwright = await import('playwright-core');
        return playwright.chromium.launch({ headless: true });
      })();
    }
    return cachedBrowser;
  };

  interface DriveOutcome {
    bundle: SideCaptureBundle;
    stepPageIds: (string | undefined)[];
    stepNetworkIds: (string | undefined)[];
    storageIds: string[];
    stepsCompleted: number;
    completed: boolean;
    failure?: string;
  }

  const driveSide = async (journey: Journey, target: PairedTarget): Promise<DriveOutcome> => {
    const collector = new CaptureCollector({
      side: target.side,
      targetId: target.targetId,
      baseUrl: target.baseUrl,
      ids,
      now,
      fetchImpl: options.fetchImpl,
    });

    let stepsCompleted = 0;
    let failure: string | undefined;
    let cleanup: (() => Promise<void>) | undefined;

    try {
      if (target.driver === 'replayer-dom') {
        const applier = createDomApplier({ baseUrl: target.baseUrl, fetchImpl: collector.fetch });
        for (const [index, action] of journey.actions.entries()) {
          collector.setActiveStep(index);
          try {
            await applier.apply(action);
            stepsCompleted = index + 1;
          } catch (error) {
            failure = describeReplayFailure(error);
            stepsCompleted = index;
            break;
          }
        }
        // Post-run storage: cookies observed via Set-Cookie headers only —
        // recorded ONLY when at least one was observed (absent otherwise).
        const networkPayloads = collector.networkPayloads();
        const inventory = responseHeaderStorageInventory(collector.originOf(), networkPayloads);
        if (inventory.cookies.length > 0) {
          await collector.recordStorage(inventory);
        }
      } else {
        // replayer-playwright: lazy browser, per-run context, response
        // listener for network captures, page.content() after each action.
        const browser = await getBrowser();
        const context = await browser.newContext();
        const page = await context.newPage();
        cleanup = async () => {
          await context.close().catch(() => undefined);
        };
        const pendingNetwork: Promise<void>[] = [];
        page.on('response', (response) => {
          const stepIndex = collector.currentStep();
          pendingNetwork.push(
            (async () => {
              try {
                const headers = await response.headers();
                const headerArray = await response.headersArray();
                const setCookie = headerArray
                  .filter((header) => header.name.toLowerCase() === 'set-cookie')
                  .map((header) => header.value);
                await collector.recordNetwork({
                  subkind: 'http-transaction',
                  stepIndex,
                  method: response.request().method(),
                  url: response.url(),
                  status: response.status(),
                  contentType: headers['content-type'] ?? undefined,
                  setCookie,
                  location: headers['location'] ?? undefined,
                });
              } catch {
                // Absent entry, never fabricated.
              }
            })(),
          );
        });
        const applier = await createPlaywrightApplier({ page, baseUrl: target.baseUrl });
        // The capture point is the SETTLED post-action DOM. Actions that
        // trigger navigation (link clicks, Enter form submits) return
        // BEFORE the navigation is even registered, so: a bounded settle
        // grace for a navigation to start, then the load state, then the
        // read — with one bounded retry before the entry is honestly
        // absent (never fabricated).
        const captureContent = async (): Promise<string | undefined> => {
          await page.waitForTimeout(120).catch(() => undefined);
          await page.waitForLoadState('load', { timeout: 2_500 }).catch(() => undefined);
          try {
            return await page.content();
          } catch {
            await page.waitForTimeout(50).catch(() => undefined);
            try {
              return await page.content();
            } catch {
              return undefined;
            }
          }
        };
        try {
          for (const [index, action] of journey.actions.entries()) {
            collector.setActiveStep(index);
            try {
              await applier.apply(action);
              stepsCompleted = index + 1;
            } catch (error) {
              failure = describeReplayFailure(error);
              stepsCompleted = index;
              break;
            }
            const html = await captureContent();
            if (html !== undefined) {
              await collector.recordPage({
                subkind: 'page-html',
                stepIndex: index,
                url: page.url(),
                html,
              });
            }
          }
          // Post-run storage: a REAL browser inventory.
          const cookies = (await context.cookies()).map((cookie) => ({
            name: cookie.name,
            value: cookie.value,
            path: cookie.path,
          }));
          const localStorageEntries = await page.evaluate((): Record<string, string> => {
            const entries: Record<string, string> = {};
            for (let index = 0; index < localStorage.length; index += 1) {
              const key = localStorage.key(index);
              if (key !== null) {
                entries[key] = localStorage.getItem(key) ?? '';
              }
            }
            return entries;
          });
          const sessionStorageEntries = await page.evaluate((): Record<string, string> => {
            const entries: Record<string, string> = {};
            for (let index = 0; index < sessionStorage.length; index += 1) {
              const key = sessionStorage.key(index);
              if (key !== null) {
                entries[key] = sessionStorage.getItem(key) ?? '';
              }
            }
            return entries;
          });
          await collector.recordStorage(
            browserStorageInventory(
              collector.originOf(),
              cookies,
              localStorageEntries,
              sessionStorageEntries,
            ),
          );
        } finally {
          await Promise.allSettled(pendingNetwork);
          await cleanup();
        }
      }
    } catch (error) {
      // Driver-level failure (e.g. playwright unavailable): an honest
      // incomplete side run with the reason — never a capture-less success.
      failure = `driver unavailable: ${String(error)}`;
      stepsCompleted = 0;
      await cleanup?.().catch(() => undefined);
    }

    const attempted = failure !== undefined ? stepsCompleted + 1 : stepsCompleted;
    const stepPageIds: (string | undefined)[] = [];
    const stepNetworkIds: (string | undefined)[] = [];
    for (let index = 0; index < attempted; index += 1) {
      stepPageIds.push(collector.pageCaptureIdAt(index));
      stepNetworkIds.push(collector.networkCaptureIdAt(index));
    }
    const bundle = await collector.sealBundle(journey.id, target.driver);
    const storageIds = bundle.entries
      .filter((entry) => entry.kind === 'storage')
      .map((entry) => entry.captureId);

    const outcome: DriveOutcome = {
      bundle,
      stepPageIds,
      stepNetworkIds,
      storageIds,
      stepsCompleted,
      completed: failure === undefined,
    };
    if (failure !== undefined) {
      outcome.failure = failure;
    }
    return outcome;
  };

  const toSideRunResult = (journey: Journey, target: PairedTarget, outcome: DriveOutcome): SideRunResult => {
    const result: SideRunResult = {
      side: target.side,
      journeyId: journey.id,
      completed: outcome.completed,
      stepsCompleted: outcome.stepsCompleted,
      evidenceRef: outcome.bundle.rootRef,
      stepPageIds: outcome.stepPageIds,
      stepNetworkIds: outcome.stepNetworkIds,
      storageIds: outcome.storageIds,
    };
    if (outcome.failure !== undefined) {
      result.failure = outcome.failure;
    }
    return result;
  };

  return {
    async runPair(journeyId: string): Promise<PairedRun> {
      const journey = journeysById.get(journeyId);
      if (journey === undefined) {
        throw new DiffRunnerError(`paired-runner: unknown journey id ${journeyId} (known: ${[...journeysById.keys()].join(', ')})`);
      }
      const transitionIds = options.irAnchors?.[journeyId] ?? [];
      const left = await driveSide(journey, options.left);
      const right = await driveSide(journey, options.right);
      const run: PairedRun = {
        journeyId: journey.id,
        transitionIds,
        left: options.left,
        right: options.right,
        runs: {
          left: toSideRunResult(journey, options.left, left),
          right: toSideRunResult(journey, options.right, right),
        },
      };
      capturesByRun.set(run, { left: left.bundle, right: right.bundle });
      return run;
    },

    async diff(run: PairedRun): Promise<DiffFinding[]> {
      const journey = journeysById.get(run.journeyId);
      if (journey === undefined) {
        throw new DiffRunnerError(
          `paired-runner: diff() requires the run's journey to be known to this runner (unknown journey id ${run.journeyId})`,
        );
      }
      const captures = capturesByRun.get(run);
      const semantic = computeSemanticFindings({
        run,
        journey,
        captures,
        planAnchors,
        actionableRoles: ACTIONABLE_ROLES,
        ids,
      });
      const state = computeStateFindings({ run, plan: options.plan, captures, ids });
      return [...semantic, ...state];
    },

    async report(runs: PairedRun[]): Promise<DiffReport> {
      const findings: DiffFinding[] = [];
      for (const run of runs) {
        findings.push(...(await this.diff(run)));
      }
      return buildDiffReport({
        candidateAppId: options.candidateAppId,
        baselineRootHash: options.baselineRootHash,
        runs,
        findings,
        ids,
        now,
      });
    },
  };
}
