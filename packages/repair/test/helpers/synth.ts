/**
 * @clapp/repair tests — DiffReport synthesis from paired replays (CLAPP-042).
 *
 * This module is the TEST-SIDE stand-in for @clapp/diff's PairedRunner
 * (CLAPP-040, built in the parallel wave — NOT a dependency): it replays
 * the SEEDED b01 journeys through the SAME machinery on both sides
 * (createDomApplier against the corpus fixture server on the left, the
 * generated candidate server on the right), turns every failed
 * postcondition/assert-visible into a contract-shaped DiffFinding
 * (expected = the corpus-side truth, actual = the candidate-side
 * observation — built from the ReplaySummary, the JourneyReplayError
 * record, and the fetched HTML), and additionally probes the candidate's
 * planned api endpoint (the network dimension's "captured responses vs
 * the plan's api/mock spec" — the plan is consulted HERE, on the runner
 * side, never by the repair loop).
 *
 * Finding synthesis rules (honest, symmetric):
 * - assert-visible failure with a heading role+name: compare the heading
 *   LISTS (ordinal + level + text) on both sides' pages. Same ordinal,
 *   same level, different text → a text finding (repairable). Missing
 *   ordinal or level mismatch → a STRUCTURAL finding (expected/actual
 *   absent — honestly unrepairable by the strategy table).
 * - any failing action with a testId: find the left-side element that
 *   carries it; the right-side element at the same (tag, text, ordinal)
 *   position; a missing/renamed testid → a testid finding.
 * - anything else (navigate failure, visibility failure, …) → a
 *   structural finding.
 * - the api probe compares status (and parsed body) against the plan's
 *   mock → a network finding, severity 'major' (no seeded journey
 *   postcondition is contradicted; behavioral consequence for
 *   api-dependent clients).
 *
 * Determinism: finding ids are `diff_<prefix>_<n>` in synthesis order;
 * the report's generatedAt is fixed; evidence hashes are over real
 * bytes. The same mutated candidate always yields the same report.
 */

import { sha256Hex, type EvidenceRef } from '@clapp/core';
import {
  createDomApplier,
  replayJourney,
  type Journey,
  type JourneyAction,
} from '@clapp/journey';
import type {
  DiffFinding,
  DiffReport,
  PairedRun,
  PairedTarget,
  SideRunResult,
} from '../../src/diff-contract';
import type { SynthesisPlan } from '@clapp/plan';

/** A running side (fixture server or spawned candidate). */
export interface SynthSide {
  url: string;
}

export interface SynthesizeOptions {
  left: SynthSide;
  right: SynthSide;
  plan: SynthesisPlan;
  journeys: Journey[];
  baselineRootHash: string;
  /** Deterministic finding-id prefix (e.g. "killer"). */
  findingIdPrefix: string;
}

// ---------------------------------------------------------------------------
// Small HTML extraction (single-line elements — corpus + generated pages)
// ---------------------------------------------------------------------------

export interface ExtractedElement {
  tag: string;
  attrs: Record<string, string>;
  text: string;
}

/** Extracts single-line elements `<tag attrs…>text</tag>` from an HTML document. */
export function extractElements(html: string): ExtractedElement[] {
  const elements: ExtractedElement[] = [];
  const pattern = /<([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^<>]*?)?)>([^<]*)<\/\1>/g;
  for (let match = pattern.exec(html); match !== null; match = pattern.exec(html)) {
    const tag = match[1] ?? '';
    const attrText = match[2] ?? '';
    const text = match[3] ?? '';
    const attrs: Record<string, string> = {};
    const attrPattern = /([a-zA-Z-]+)(?:="([^"]*)")?/g;
    for (let attr = attrPattern.exec(attrText); attr !== null; attr = attrPattern.exec(attrText)) {
      const name = attr[1];
      if (name === undefined || name === '') {
        continue;
      }
      attrs[name] = attr[2] ?? '';
    }
    elements.push({ tag, attrs, text });
  }
  return elements;
}

/** The document's headings in order: {level, text}. */
export function extractHeadings(html: string): Array<{ level: number; text: string }> {
  return extractElements(html)
    .filter((element) => /^h[1-6]$/.test(element.tag))
    .map((element) => ({ level: Number(element.tag.slice(1)), text: element.text }));
}

function collapseWs(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

async function fetchPage(url: string): Promise<{ ok: boolean; html: string }> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    const html = await response.text();
    return { ok: response.ok, html };
  } catch {
    return { ok: false, html: '' };
  }
}

async function evidenceOf(html: string, suffix: string, kind: EvidenceRef['kind']): Promise<EvidenceRef> {
  return { evidenceId: `ev_${suffix}`, kind, sha256: await sha256Hex(html) };
}

// ---------------------------------------------------------------------------
// Per-failure finding synthesis
// ---------------------------------------------------------------------------

interface FailureContext {
  journey: Journey;
  actionIndex: number;
  action: JourneyAction;
  failureUrl: string | null;
  findingId: () => string;
  left: SynthSide;
  right: SynthSide;
  plan: SynthesisPlan;
  findings: DiffFinding[];
}

function sourceIdsForRoute(plan: SynthesisPlan, path: string, extraElementId?: string): string[] {
  const route = plan.routes.find((candidate) => candidate.path === path);
  const ids: string[] = [];
  if (route !== undefined) {
    ids.push(route.id);
    const page = plan.pages.find((candidate) => candidate.routeId === route.id);
    if (page !== undefined && extraElementId !== undefined) {
      const element = page.elements.find((candidate) => candidate.id === extraElementId);
      if (element !== undefined) {
        ids.push(element.id);
      }
    }
  }
  return ids.length > 0 ? ids : [path];
}

function planElementIdForHeading(plan: SynthesisPlan, path: string, text: string): string | undefined {
  const route = plan.routes.find((candidate) => candidate.path === path);
  if (route === undefined) {
    return undefined;
  }
  const page = plan.pages.find((candidate) => candidate.routeId === route.id);
  const element = page?.elements.find(
    (candidate) => candidate.kind === 'heading' && collapseWs(candidate.text ?? '') === collapseWs(text),
  );
  return element?.id;
}

function planElementIdForTestid(plan: SynthesisPlan, path: string, testId: string): string | undefined {
  const route = plan.routes.find((candidate) => candidate.path === path);
  if (route === undefined) {
    return undefined;
  }
  const page = plan.pages.find((candidate) => candidate.routeId === route.id);
  const element = page?.elements.find((candidate) => candidate.testId === testId);
  return element?.id;
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/** Synthesizes findings for one right-side replay failure. */
async function synthesizeFailure(context: FailureContext): Promise<void> {
  const { action, failureUrl, left, right, plan } = context;
  if (failureUrl === null) {
    structuralFinding(context, 'The candidate failed a journey step in a way the synthesizer cannot anchor to a page.');
    return;
  }
  const path = pathOf(failureUrl);

  // Case A: assert-visible with a heading role+name (the text dimension).
  if (action.type === 'assert-visible' && action.target.role === 'heading' && action.target.name !== undefined) {
    const [leftPage, rightPage] = await Promise.all([
      fetchPage(new URL(path, left.url).href),
      fetchPage(new URL(path, right.url).href),
    ]);
    const leftHeadings = extractHeadings(leftPage.html);
    const rightHeadings = extractHeadings(rightPage.html);
    const wanted = collapseWs(action.target.name);
    const leftIndex = leftHeadings.findIndex(
      (heading) => collapseWs(heading.text) === wanted,
    );
    if (leftIndex !== -1 && leftPage.ok && rightPage.ok) {
      const rightHeading = rightHeadings[leftIndex];
      if (
        rightHeading !== undefined &&
        rightHeading.level === leftHeadings[leftIndex]?.level &&
        collapseWs(rightHeading.text) !== wanted
      ) {
        // Text divergence: same ordinal, same level, different text.
        context.findings.push({
          id: context.findingId(),
          dimension: 'semantic',
          severity: 'critical',
          summary: `Candidate heading text on ${path} diverges from the original: ${JSON.stringify(rightHeading.text)} vs ${JSON.stringify(wanted)}.`,
          anchors: [
            {
              stepIndex: context.actionIndex,
              leftEvidence: await evidenceOf(leftPage.html, 'left_page', 'network'),
              rightEvidence: await evidenceOf(rightPage.html, 'right_page', 'network'),
              sourceIds: sourceIdsForRoute(plan, path, planElementIdForHeading(plan, path, wanted)),
            },
          ],
          expected: { kind: 'text', route: path, text: wanted },
          actual: { kind: 'text', route: path, text: collapseWs(rightHeading.text) },
        });
        return;
      }
    }
    // The heading is absent (or structurally different) on the candidate.
    structuralFinding(
      context,
      `The heading ${JSON.stringify(wanted)} is absent or structurally different on the candidate page ${path}; the original page carries it.`,
    );
    return;
  }

  // Case B: any failing action naming a testId (the testid dimension).
  const testId = action.type === 'click' || action.type === 'fill' || action.type === 'assert-visible'
    ? action.target.testId
    : undefined;
  if (testId !== undefined) {
    const [leftPage, rightPage] = await Promise.all([
      fetchPage(new URL(path, left.url).href),
      fetchPage(new URL(path, right.url).href),
    ]);
    // ONE extraction per side: ordinal matching needs identity within the
    // same array (indexOf is reference-based).
    const leftElements = extractElements(leftPage.html);
    const leftElement = leftElements.find(
      (element) => element.attrs['data-testid'] === testId,
    );
    if (leftElement !== undefined && leftPage.ok && rightPage.ok) {
      const rightElements = extractElements(rightPage.html);
      // Ordinal of the left element among same-tag/same-text matches.
      const ordinal = leftElements
        .filter((element) => element.tag === leftElement.tag && element.text === leftElement.text)
        .indexOf(leftElement);
      const sameShape = rightElements.filter(
        (element) => element.tag === leftElement.tag && element.text === leftElement.text,
      );
      const rightElement = sameShape[ordinal];
      if (rightElement !== undefined) {
        const rightTestId = rightElement.attrs['data-testid'];
        if (rightTestId !== testId) {
          const expectedPayload: Record<string, unknown> = {
            kind: 'testid',
            route: path,
            testId,
            tag: leftElement.tag,
            text: leftElement.text,
            matchIndex: ordinal,
          };
          const actualPayload: Record<string, unknown> = {
            kind: 'testid',
            route: path,
            tag: leftElement.tag,
            text: leftElement.text,
            matchIndex: ordinal,
          };
          if (rightTestId !== undefined) {
            actualPayload['testId'] = rightTestId;
          }
          const summary =
            rightTestId === undefined
              ? `data-testid ${JSON.stringify(testId)} is missing from the candidate page ${path}; the original element <${leftElement.tag}> carries it.`
              : `data-testid on ${path} was renamed: ${JSON.stringify(rightTestId)} vs the original ${JSON.stringify(testId)}.`;
          context.findings.push({
            id: context.findingId(),
            dimension: 'semantic',
            severity: 'critical',
            summary,
            anchors: [
              {
                stepIndex: context.actionIndex,
                leftEvidence: await evidenceOf(leftPage.html, 'left_page', 'network'),
                rightEvidence: await evidenceOf(rightPage.html, 'right_page', 'network'),
                sourceIds: sourceIdsForRoute(plan, path, planElementIdForTestid(plan, path, testId)),
              },
            ],
            expected: expectedPayload,
            actual: actualPayload,
          });
          return;
        }
      }
    }
    structuralFinding(
      context,
      `The element carrying data-testid ${JSON.stringify(testId)} could not be matched on the candidate page ${path}.`,
    );
    return;
  }

  structuralFinding(context, `The candidate failed a journey step on ${path} in a way no payload vocabulary expresses.`);
}

function structuralFinding(context: FailureContext, summary: string): void {
  context.findings.push({
    id: context.findingId(),
    dimension: 'semantic',
    severity: 'critical',
    summary,
    anchors: [
      {
        stepIndex: context.actionIndex,
        sourceIds: [context.journey.id],
      },
    ],
  });
}

// ---------------------------------------------------------------------------
// Report + findings-only synthesis
// ---------------------------------------------------------------------------

interface ReplayOutcome {
  completed: boolean;
  stepsCompleted: number;
  failure: string | undefined;
  failureUrl: string | null;
  failureActionIndex: number;
  failureAction: JourneyAction | null;
}

async function replaySide(journey: Journey, baseUrl: string): Promise<ReplayOutcome> {
  try {
    const summary = await replayJourney(journey, createDomApplier({ baseUrl }));
    return {
      completed: true,
      stepsCompleted: summary.actionsApplied,
      failure: undefined,
      failureUrl: null,
      failureActionIndex: -1,
      failureAction: null,
    };
  } catch (error) {
    const details = (error as { details?: Record<string, unknown> }).details;
    const url = details !== undefined && typeof details['url'] === 'string' ? details['url'] : null;
    const rawIndex: number | undefined = (error as { actionIndex?: number }).actionIndex;
    const actionIndex = typeof rawIndex === 'number' ? rawIndex : 0;
    return {
      completed: false,
      stepsCompleted: actionIndex,
      failure: String((error as Error).message),
      failureUrl: url,
      failureActionIndex: actionIndex,
      failureAction: ((error as { action?: JourneyAction }).action ?? null) as JourneyAction | null,
    };
  }
}

async function runEvidence(journeyId: string, side: 'left' | 'right', outcome: ReplayOutcome): Promise<EvidenceRef> {
  const record = {
    journeyId,
    side,
    completed: outcome.completed,
    stepsCompleted: outcome.stepsCompleted,
    failure: outcome.failure ?? null,
  };
  return {
    evidenceId: `ev_run_${side}_${journeyId}`,
    kind: 'network',
    sha256: await sha256Hex(JSON.stringify(record)),
  };
}

function stepPageIds(side: string, journey: Journey, outcome: ReplayOutcome): (string | undefined)[] {
  return journey.actions.map((action, index) =>
    action.type === 'navigate' && (outcome.completed || index <= outcome.stepsCompleted)
      ? `pg_${side}_${journey.id}_${index}`
      : undefined,
  );
}

/** Replays both sides and synthesizes findings ONLY (the oracle's core). */
export async function synthesizeFindings(options: SynthesizeOptions): Promise<DiffFinding[]> {
  const findings: DiffFinding[] = [];
  let counter = 0;
  const findingId = (): string => `diff_${options.findingIdPrefix}_${(counter += 1)}`;

  for (const journey of options.journeys) {
    const right = await replaySide(journey, options.right.url);
    if (right.completed) {
      continue; // no failure on the candidate — nothing to synthesize
    }
    const context: FailureContext = {
      journey,
      actionIndex: Math.max(0, right.failureActionIndex),
      action: right.failureAction ?? journey.actions[0] ?? { type: 'wait', ms: 0 },
      failureUrl: right.failureUrl,
      findingId,
      left: options.left,
      right: options.right,
      plan: options.plan,
      findings,
    };
    await synthesizeFailure(context);
  }

  // The api probe (network dimension): the runner side consults the plan's
  // mock spec — the repair loop NEVER does.
  for (const endpoint of options.plan.api.endpoints) {
    const mock = options.plan.api.mocks.find((candidate) => candidate.endpointId === endpoint.id);
    if (mock === undefined) {
      continue;
    }
    const url = new URL(endpoint.urlPattern.replace(/:[a-zA-Z]+/g, '1'), options.right.url).href;
    const response = await fetch(url, { signal: AbortSignal.timeout(5_000) }).catch(() => null);
    if (response === null) {
      continue;
    }
    const actualStatus = response.status;
    const bodyText = await response.text().catch(() => '');
    let actualBody: unknown;
    try {
      actualBody = bodyText === '' ? undefined : (JSON.parse(bodyText) as unknown);
    } catch {
      actualBody = undefined;
    }
    const expectedBody = mock.bodyJson;
    const statusDiverged = actualStatus !== mock.statusCode;
    const bodyDiverged = JSON.stringify(actualBody) !== JSON.stringify(expectedBody);
    if (statusDiverged || bodyDiverged) {
      const expectedPayload: Record<string, unknown> = {
        kind: 'mock',
        method: endpoint.method,
        urlPattern: endpoint.urlPattern,
        statusCode: mock.statusCode,
      };
      const actualPayload: Record<string, unknown> = {
        kind: 'mock',
        method: endpoint.method,
        urlPattern: endpoint.urlPattern,
        statusCode: actualStatus,
      };
      if (expectedBody !== undefined) {
        expectedPayload['bodyJson'] = expectedBody;
      }
      if (actualBody !== undefined) {
        actualPayload['bodyJson'] = actualBody;
      }
      findings.push({
        id: findingId(),
        dimension: 'network',
        severity: 'major',
        summary: `${endpoint.method} ${endpoint.urlPattern} answered ${actualStatus} on the candidate; the plan's mock declares ${mock.statusCode}.`,
        anchors: [
          {
            stepIndex: 0,
            leftEvidence: {
              evidenceId: `ev_mock_left_${endpoint.id}`,
              kind: 'network',
              sha256: await sha256Hex(JSON.stringify({ statusCode: mock.statusCode, bodyJson: expectedBody ?? null })),
            },
            rightEvidence: {
              evidenceId: `ev_mock_right_${endpoint.id}`,
              kind: 'network',
              sha256: await sha256Hex(bodyText),
            },
            sourceIds: [endpoint.id],
          },
        ],
        expected: expectedPayload,
        actual: actualPayload,
      });
    }
  }

  return findings;
}

/** Builds a full contract-shaped DiffReport from the paired replays. */
export async function synthesizeReport(options: SynthesizeOptions): Promise<DiffReport> {
  const findings: DiffFinding[] = await synthesizeFindings(options);

  const runs: PairedRun[] = [];
  for (const journey of options.journeys) {
    const [leftOutcome, rightOutcome] = await Promise.all([
      replaySide(journey, options.left.url),
      replaySide(journey, options.right.url),
    ]);
    const leftTarget: PairedTarget = {
      side: 'left',
      baseUrl: options.left.url,
      targetId: 'bench/b01-static',
      driver: 'replayer-dom',
    };
    const rightTarget: PairedTarget = {
      side: 'right',
      baseUrl: options.right.url,
      targetId: options.plan.application.id,
      driver: 'replayer-dom',
    };
    const leftRun: SideRunResult = {
      side: 'left',
      journeyId: journey.id,
      completed: leftOutcome.completed,
      stepsCompleted: leftOutcome.stepsCompleted,
      ...(leftOutcome.failure === undefined ? {} : { failure: leftOutcome.failure }),
      evidenceRef: await runEvidence(journey.id, 'left', leftOutcome),
      stepPageIds: stepPageIds('left', journey, leftOutcome),
      stepNetworkIds: journey.actions.map(() => undefined),
      storageIds: [],
    };
    const rightRun: SideRunResult = {
      side: 'right',
      journeyId: journey.id,
      completed: rightOutcome.completed,
      stepsCompleted: rightOutcome.stepsCompleted,
      ...(rightOutcome.failure === undefined ? {} : { failure: rightOutcome.failure }),
      evidenceRef: await runEvidence(journey.id, 'right', rightOutcome),
      stepPageIds: stepPageIds('right', journey, rightOutcome),
      stepNetworkIds: journey.actions.map(() => undefined),
      storageIds: [],
    };
    runs.push({
      journeyId: journey.id,
      transitionIds: [],
      left: leftTarget,
      right: rightTarget,
      runs: { left: leftRun, right: rightRun },
    });
  }

  const counts = { critical: 0, major: 0, minor: 0, info: 0 };
  for (const finding of findings) {
    counts[finding.severity] += 1;
  }

  return {
    id: `diffr_${options.findingIdPrefix}`,
    diffVersion: '0.1',
    candidateAppId: options.plan.application.id,
    baselineRootHash: options.baselineRootHash,
    runs,
    findings,
    counts,
    verdict: findings.length === 0 ? 'equivalent' : 'divergent',
    generatedAt: '2026-09-25T00:00:00.000Z',
  };
}
