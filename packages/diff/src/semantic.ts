/**
 * @clapp/diff — the SEMANTIC diff dimension.
 *
 * Findings for one paired run, computed from the per-step captures and the
 * journey record:
 *
 * 1. RUN INTEGRITY — the right (candidate) side failing to complete the
 *    journey is a 'critical' finding (a seeded journey postcondition is
 *    contradicted on the candidate); the left (reference) side failing is
 *    a 'major' finding (the paired comparison loses its baseline at/after
 *    that step — structural only from there on).
 *
 * 2. NAVIGATION SYMMETRY — a step where one side captured a fresh page
 *    and the other did not is a 'major' finding (the action navigated on
 *    one side only); steps where both captured are compared further.
 *
 * 3. ROUTE AGREEMENT — both sides navigating to different route paths at
 *    the same step is a 'major' finding.
 *
 * 4. STRUCTURAL AGREEMENT — for each aligned page pair, the extracted
 *    feature groups (title, headings, testids, landmarks, targetable
 *    elements, form fields — see page-features.ts) are compared. Every
 *    divergence is a finding whose severity is escalated to 'critical'
 *    ONLY when the journey targets the divergent structure on that page
 *    (an assert-visible postcondition, or a click/fill target); plain
 *    text/formatting divergences stay 'minor' ('major' for form fields —
 *    submission behavior), and nothing is inflated beyond the evidence.
 *
 * 5. SELECTOR RESOLUTION SYMMETRY — for every action the journey
 *    attempted on both sides, the target selector is resolved against
 *    both sides' current captured trees with @clapp/observe's
 *    resolveTarget; asymmetric outcomes (resolves on one side only, or
 *    resolves to structurally different elements) are 'major' findings.
 *    Symmetric non-resolution (both sides fail the observe approximation,
 *    e.g. label-named controls) is skipped — honesty about the
 *    vocabulary's limits, never a false positive.
 *
 * When the runner has no captures for a run (a hand-constructed PairedRun
 * passed to PairedRunner.diff), only the run-integrity checks run —
 * documented, never fabricated.
 */

import { normalizeDomTree, resolveTarget, type SerializedNode } from '@clapp/observe';
import type { Journey, TargetSelector } from '@clapp/journey';
import type { DiffAnchor, DiffFinding, PairedRun } from './diff-contract';
import type { SideCaptureBundle } from './capture';
import type { DiffIdFactory } from './ids';
import { extractPageFeatures, normalizeRoutePath, type PageFeatures } from './page-features';
import { parseHtmlToRawTree } from './html-tree';

/** A plan-shaped anchor lookup: route path → route ids → page id. */
export interface PlanAnchorIndex {
  routeIdsByPath: Map<string, string[]>;
  pageIdsByRouteId: Map<string, string>;
}

export interface SemanticDiffInput {
  run: PairedRun;
  journey: Journey;
  captures?: { left: SideCaptureBundle; right: SideCaptureBundle };
  planAnchors?: PlanAnchorIndex;
  actionableRoles: ReadonlySet<string>;
  ids: DiffIdFactory;
}

interface FindingBuilder {
  ids: DiffIdFactory;
  findings: DiffFinding[];
}

function pushFinding(builder: FindingBuilder, finding: Omit<DiffFinding, 'id'>): DiffFinding {
  const full: DiffFinding = { id: builder.ids.newFindingId(), ...finding };
  builder.findings.push(full);
  return full;
}

/** The step of the freshest page capture at or before `stepIndex` (-1 when none). */
function freshestPageStep(bundle: SideCaptureBundle, stepIndex: number): number {
  let best = -1;
  for (const step of bundle.pageAtStep.keys()) {
    if (step <= stepIndex && step > best) {
      best = step;
    }
  }
  return best;
}

function pageEvidenceAtStep(bundle: SideCaptureBundle, stepIndex: number): DiffAnchor['leftEvidence'] {
  const captureId = bundle.pageAtStep.get(stepIndex);
  if (captureId === undefined) {
    return undefined;
  }
  return bundle.byCaptureId.get(captureId)?.evidence;
}

function pageEvidenceAtOrBefore(bundle: SideCaptureBundle, stepIndex: number): DiffAnchor['leftEvidence'] {
  const step = freshestPageStep(bundle, stepIndex);
  return step >= 0 ? pageEvidenceAtStep(bundle, step) : undefined;
}

function payloadUrl(bundle: SideCaptureBundle, captureId: string): string {
  const entry = bundle.byCaptureId.get(captureId);
  if (entry === undefined || entry.kind !== 'dom') {
    return '';
  }
  return (entry.payload as { url: string }).url;
}

/**
 * Builds one anchor for a step: the per-step page evidence when a page was
 * captured at exactly this step on a side, else the latest page evidence
 * at or before the step, else the side's bundle root ref. Foreign runs
 * (no captures) cite the sides' declared bundle refs.
 */
function anchor(
  stepIndex: number,
  run: PairedRun,
  captures: SemanticDiffInput['captures'],
  sourceIds: string[],
): DiffAnchor {
  const spec: DiffAnchor = { stepIndex, sourceIds };
  if (captures !== undefined) {
    spec.leftEvidence =
      pageEvidenceAtStep(captures.left, stepIndex) ??
      pageEvidenceAtOrBefore(captures.left, stepIndex) ??
      run.runs.left.evidenceRef;
    spec.rightEvidence =
      pageEvidenceAtStep(captures.right, stepIndex) ??
      pageEvidenceAtOrBefore(captures.right, stepIndex) ??
      run.runs.right.evidenceRef;
  } else {
    spec.leftEvidence = run.runs.left.evidenceRef;
    spec.rightEvidence = run.runs.right.evidenceRef;
  }
  return spec;
}

// ---------------------------------------------------------------------------
// Journey targeting analysis (the severity-escalation basis)
// ---------------------------------------------------------------------------

interface JourneyTargets {
  /** page step → selectors of the actions operating on that page. */
  selectorsByPageStep: Map<number, TargetSelector[]>;
  /** action step + selector, for the resolution-symmetry check. */
  actionSelectors: { stepIndex: number; selector: TargetSelector }[];
}

function analyzeJourneyTargets(journey: Journey, captures: { left: SideCaptureBundle; right: SideCaptureBundle }): JourneyTargets {
  const actionSelectors: JourneyTargets['actionSelectors'] = [];
  for (const [stepIndex, action] of journey.actions.entries()) {
    if (action.type === 'click' || action.type === 'fill' || action.type === 'assert-visible') {
      actionSelectors.push({ stepIndex, selector: action.target });
    }
  }

  // A selector operates on the page a side was showing at its action step
  // (the freshest capture at or before it); attribution uses EITHER side's
  // timeline (under driver-symmetric capture they agree).
  const selectorsByPageStep = new Map<number, TargetSelector[]>();
  for (const { stepIndex, selector } of actionSelectors) {
    for (const bundle of [captures.left, captures.right]) {
      const pageStep = freshestPageStep(bundle, stepIndex);
      if (pageStep < 0) {
        continue;
      }
      const list = selectorsByPageStep.get(pageStep) ?? [];
      if (!list.some((existing) => JSON.stringify(existing) === JSON.stringify(selector))) {
        list.push(selector);
      }
      selectorsByPageStep.set(pageStep, list);
    }
  }
  return { selectorsByPageStep, actionSelectors };
}

function targetedHeadingNames(targets: TargetSelector[]): Set<string> {
  const names = new Set<string>();
  for (const selector of targets) {
    if (selector.role === 'heading' && selector.name !== undefined && selector.name !== '') {
      names.add(selector.name);
    }
  }
  return names;
}

function targetedTestIds(targets: TargetSelector[]): Set<string> {
  const ids = new Set<string>();
  for (const selector of targets) {
    if (selector.testId !== undefined && selector.testId !== '') {
      ids.add(selector.testId);
    }
  }
  return ids;
}

function targetedPairs(targets: TargetSelector[]): Set<string> {
  const pairs = new Set<string>();
  for (const selector of targets) {
    if (selector.role !== undefined && selector.role !== '' && selector.name !== undefined && selector.name !== '') {
      pairs.add(`${selector.role}::${selector.name}`);
    }
  }
  return pairs;
}

function targetedLandmarkRoles(targets: TargetSelector[]): Map<string, Set<string>> {
  const roles = new Map<string, Set<string>>();
  for (const selector of targets) {
    if (selector.role === undefined || selector.role === '') {
      continue;
    }
    const names = roles.get(selector.role) ?? new Set<string>();
    if (selector.name !== undefined && selector.name !== '') {
      names.add(selector.name);
    }
    roles.set(selector.role, names);
  }
  return roles;
}

/** True when a journey selector targets this form field (by testid, or by its label name). */
function fieldTargeted(
  field: { label: string; testId?: string },
  targets: TargetSelector[],
): boolean {
  for (const selector of targets) {
    if (selector.testId !== undefined && selector.testId !== '' && selector.testId === field.testId) {
      return true;
    }
    if (
      selector.role !== undefined &&
      ['textbox', 'searchbox', 'combobox', 'spinbutton', 'textarea'].includes(selector.role) &&
      selector.name !== undefined &&
      selector.name !== '' &&
      selector.name === field.label
    ) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Feature extraction caches + comparisons
// ---------------------------------------------------------------------------

function pageFeaturesFor(
  bundle: SideCaptureBundle,
  captureId: string,
  cache: Map<string, PageFeatures>,
  actionableRoles: ReadonlySet<string>,
): PageFeatures | undefined {
  const cached = cache.get(captureId);
  if (cached !== undefined) {
    return cached;
  }
  const entry = bundle.byCaptureId.get(captureId);
  if (entry === undefined || entry.kind !== 'dom') {
    return undefined;
  }
  const payload = entry.payload as { url: string; html: string };
  const features = extractPageFeatures(payload.html, payload.url, actionableRoles);
  cache.set(captureId, features);
  return features;
}

function serializedTreeFor(
  bundle: SideCaptureBundle,
  captureId: string,
  cache: Map<string, SerializedNode>,
): SerializedNode | undefined {
  const cached = cache.get(captureId);
  if (cached !== undefined) {
    return cached;
  }
  const entry = bundle.byCaptureId.get(captureId);
  if (entry === undefined || entry.kind !== 'dom') {
    return undefined;
  }
  const payload = entry.payload as { url: string; html: string };
  const { root } = normalizeDomTree(parseHtmlToRawTree(payload.html));
  cache.set(captureId, root);
  return root;
}

interface IndexedDivergence<T> {
  index: number;
  left?: T;
  right?: T;
}

function compareOrdered<T>(left: T[], right: T[], equal: (a: T, b: T) => boolean): IndexedDivergence<T>[] {
  const divergences: IndexedDivergence<T>[] = [];
  const max = Math.max(left.length, right.length);
  for (let index = 0; index < max; index += 1) {
    const leftItem = left[index];
    const rightItem = right[index];
    if (leftItem === undefined || rightItem === undefined) {
      divergences.push({ index, left: leftItem, right: rightItem });
      continue;
    }
    if (!equal(leftItem, rightItem)) {
      divergences.push({ index, left: leftItem, right: rightItem });
    }
  }
  return divergences;
}

const sameHeading = (a: PageFeatures['headings'][number], b: PageFeatures['headings'][number]): boolean =>
  a.level === b.level && a.text === b.text;

const sameLandmark = (a: PageFeatures['landmarks'][number], b: PageFeatures['landmarks'][number]): boolean =>
  a.role === b.role && a.name === b.name;

const sameForm = (a: PageFeatures['forms'][number], b: PageFeatures['forms'][number]): boolean =>
  a.actionPath === b.actionPath &&
  a.method === b.method &&
  a.fields.length === b.fields.length &&
  a.fields.every((field, fieldIndex) => {
    const other = b.fields[fieldIndex];
    return (
      other !== undefined &&
      field.name === other.name &&
      field.type === other.type &&
      field.label === other.label &&
      field.testId === other.testId &&
      JSON.stringify(field.options ?? []) === JSON.stringify(other.options ?? [])
    );
  });

function describeHeading(heading: { level: number; text: string } | undefined): string {
  return heading === undefined ? '(absent)' : `h${heading.level} "${heading.text}"`;
}

function describeLandmark(landmark: { role: string; name: string } | undefined): string {
  return landmark === undefined ? '(absent)' : `${landmark.role}"${landmark.name}"`;
}

function describeForm(form: PageFeatures['forms'][number] | undefined): string {
  return form === undefined
    ? '(absent)'
    : `${form.method.toUpperCase()} ${form.actionPath} (${form.fields.length} fields)`;
}

// ---------------------------------------------------------------------------
// The semantic findings entry point
// ---------------------------------------------------------------------------

export function computeSemanticFindings(input: SemanticDiffInput): DiffFinding[] {
  const { run, journey, captures, planAnchors, actionableRoles, ids } = input;
  const builder: FindingBuilder = { ids, findings: [] };
  const left = run.runs.left;
  const right = run.runs.right;
  const transitionIds = run.transitionIds;

  const sourceIdsForPath = (path: string): string[] => {
    const result = [...transitionIds];
    if (planAnchors !== undefined) {
      for (const routeId of planAnchors.routeIdsByPath.get(path) ?? []) {
        result.push(routeId);
        const pageId = planAnchors.pageIdsByRouteId.get(routeId);
        if (pageId !== undefined) {
          result.push(pageId);
        }
      }
    }
    return result;
  };

  // ---- 1. run integrity ------------------------------------------------------
  if (!right.completed) {
    pushFinding(builder, {
      dimension: 'semantic',
      severity: 'critical',
      summary: `Right (candidate) side failed to complete journey "${journey.name}" at step ${right.stepsCompleted}: ${right.failure ?? 'unknown failure'} — the journey's postcondition set is contradicted on the candidate.`,
      anchors: [anchor(right.stepsCompleted, run, captures, [...transitionIds])],
    });
  }
  if (!left.completed) {
    pushFinding(builder, {
      dimension: 'semantic',
      severity: 'major',
      summary: `Left (reference) side failed at step ${left.stepsCompleted}: ${left.failure ?? 'unknown failure'} — the paired comparison loses its reference baseline at and after this step.`,
      anchors: [anchor(left.stepsCompleted, run, captures, [...transitionIds])],
    });
  }

  if (captures === undefined) {
    // Foreign run (no captures): run-integrity findings above are the whole
    // honest output; no page comparison is fabricated.
    return builder.findings;
  }

  const targets = analyzeJourneyTargets(journey, captures);
  const featureCache = new Map<string, PageFeatures>();
  const treeCache = new Map<string, SerializedNode>();

  // ---- 2 + 3 + 4. aligned page comparisons ------------------------------------
  const alignedSteps = new Set<number>([
    ...captures.left.pageAtStep.keys(),
    ...captures.right.pageAtStep.keys(),
  ]);

  for (const stepIndex of [...alignedSteps].sort((a, b) => a - b)) {
    const leftCaptureId = captures.left.pageAtStep.get(stepIndex);
    const rightCaptureId = captures.right.pageAtStep.get(stepIndex);

    // Navigation asymmetry: exactly one side loaded a fresh page.
    if ((leftCaptureId === undefined) !== (rightCaptureId === undefined)) {
      const navigatedSide = leftCaptureId !== undefined ? 'left' : 'right';
      const navigatedUrl =
        leftCaptureId !== undefined ? payloadUrl(captures.left, leftCaptureId) : payloadUrl(captures.right, rightCaptureId ?? '');
      const expected: Record<string, unknown> = { side: 'left', navigated: leftCaptureId !== undefined };
      const actual: Record<string, unknown> = { side: 'right', navigated: rightCaptureId !== undefined };
      if (leftCaptureId !== undefined) {
        expected.path = normalizeRoutePath(navigatedUrl);
      }
      if (rightCaptureId !== undefined) {
        actual.path = normalizeRoutePath(navigatedUrl);
      }
      pushFinding(builder, {
        dimension: 'semantic',
        severity: 'major',
        summary: `Navigation asymmetry at step ${stepIndex}: the ${navigatedSide} side navigated${navigatedUrl !== '' ? ` (${navigatedUrl})` : ''} while the other side loaded no new page.`,
        expected,
        actual,
        anchors: [anchor(stepIndex, run, captures, sourceIdsForPath('/'))],
      });
      continue;
    }
    if (leftCaptureId === undefined || rightCaptureId === undefined) {
      continue;
    }

    const leftFeatures = pageFeaturesFor(captures.left, leftCaptureId, featureCache, actionableRoles);
    const rightFeatures = pageFeaturesFor(captures.right, rightCaptureId, featureCache, actionableRoles);
    if (leftFeatures === undefined || rightFeatures === undefined) {
      continue;
    }

    const stepTargets = targets.selectorsByPageStep.get(stepIndex) ?? [];
    const sourceIds = sourceIdsForPath(leftFeatures.path);
    const pageAnchor = (): DiffAnchor => anchor(stepIndex, run, captures, sourceIds);

    // 3. route agreement
    if (leftFeatures.path !== rightFeatures.path) {
      pushFinding(builder, {
        dimension: 'semantic',
        severity: 'major',
        summary: `Landed routes diverge at step ${stepIndex}: left "${leftFeatures.path}", right "${rightFeatures.path}".`,
        expected: leftFeatures.path,
        actual: rightFeatures.path,
        anchors: [pageAnchor()],
      });
    }

    // 4a. title (not targetable by the v0.1 journey vocabulary: minor)
    if (leftFeatures.title !== rightFeatures.title) {
      pushFinding(builder, {
        dimension: 'semantic',
        severity: 'minor',
        summary: `Page title diverges at step ${stepIndex} (${leftFeatures.path}): left "${leftFeatures.title}", right "${rightFeatures.title}".`,
        expected: leftFeatures.title,
        actual: rightFeatures.title,
        anchors: [pageAnchor()],
      });
    }

    // 4b. headings
    const targetedHeadings = targetedHeadingNames(stepTargets);
    for (const divergence of compareOrdered(leftFeatures.headings, rightFeatures.headings, sameHeading)) {
      const critical = divergence.left !== undefined && targetedHeadings.has(divergence.left.text);
      const finding: Omit<DiffFinding, 'id'> = {
        dimension: 'semantic',
        severity: critical ? 'critical' : 'major',
        summary: `Heading ${divergence.index + 1} diverges at step ${stepIndex} (${leftFeatures.path}): left ${describeHeading(divergence.left)}, right ${describeHeading(divergence.right)}.`,
        anchors: [pageAnchor()],
      };
      if (divergence.left !== undefined) {
        finding.expected = { ...divergence.left };
      }
      if (divergence.right !== undefined) {
        finding.actual = { ...divergence.right };
      }
      pushFinding(builder, finding);
    }

    // 4c. testids
    const targetedIds = targetedTestIds(stepTargets);
    const leftOnlyIds = leftFeatures.testIds.filter((id) => !rightFeatures.testIds.includes(id));
    const rightOnlyIds = rightFeatures.testIds.filter((id) => !leftFeatures.testIds.includes(id));
    if (leftOnlyIds.length > 0 || rightOnlyIds.length > 0) {
      const critical = [...leftOnlyIds, ...rightOnlyIds].some((id) => targetedIds.has(id));
      pushFinding(builder, {
        dimension: 'semantic',
        severity: critical ? 'critical' : 'minor',
        summary: `data-testid surface diverges at step ${stepIndex} (${leftFeatures.path}): left-only [${leftOnlyIds.join(', ')}], right-only [${rightOnlyIds.join(', ')}].`,
        expected: leftOnlyIds,
        actual: rightOnlyIds,
        anchors: [pageAnchor()],
      });
    }

    // 4d. landmarks
    const targetedLandmarks = targetedLandmarkRoles(stepTargets);
    for (const divergence of compareOrdered(leftFeatures.landmarks, rightFeatures.landmarks, sameLandmark)) {
      const critical =
        divergence.left !== undefined &&
        (() => {
          const names = targetedLandmarks.get(divergence.left.role);
          return names !== undefined && (names.size === 0 || names.has(divergence.left.name));
        })();
      const finding: Omit<DiffFinding, 'id'> = {
        dimension: 'semantic',
        severity: critical ? 'critical' : 'minor',
        summary: `Landmark ${divergence.index + 1} diverges at step ${stepIndex} (${leftFeatures.path}): left ${describeLandmark(divergence.left)}, right ${describeLandmark(divergence.right)}.`,
        anchors: [pageAnchor()],
      };
      if (divergence.left !== undefined) {
        finding.expected = { ...divergence.left };
      }
      if (divergence.right !== undefined) {
        finding.actual = { ...divergence.right };
      }
      pushFinding(builder, finding);
    }

    // 4e. journey-targetable surface
    const targeted = targetedPairs(stepTargets);
    const leftOnlyTargets = leftFeatures.targetables.filter((pair) => !rightFeatures.targetables.includes(pair));
    const rightOnlyTargets = rightFeatures.targetables.filter((pair) => !leftFeatures.targetables.includes(pair));
    if (leftOnlyTargets.length > 0 || rightOnlyTargets.length > 0) {
      const critical = leftOnlyTargets.some((pair) => targeted.has(pair));
      pushFinding(builder, {
        dimension: 'semantic',
        severity: critical ? 'critical' : 'minor',
        summary: `Journey-targetable surface diverges at step ${stepIndex} (${leftFeatures.path}): left-only [${leftOnlyTargets.join(', ')}], right-only [${rightOnlyTargets.join(', ')}].`,
        expected: leftOnlyTargets,
        actual: rightOnlyTargets,
        anchors: [pageAnchor()],
      });
    }

    // 4f. forms
    for (const divergence of compareOrdered(leftFeatures.forms, rightFeatures.forms, sameForm)) {
      const critical =
        divergence.left !== undefined && divergence.left.fields.some((field) => fieldTargeted(field, stepTargets));
      const finding: Omit<DiffFinding, 'id'> = {
        dimension: 'semantic',
        severity: critical ? 'critical' : 'major',
        summary: `Form ${divergence.index + 1} diverges at step ${stepIndex} (${leftFeatures.path}): left ${describeForm(divergence.left)}, right ${describeForm(divergence.right)}.`,
        anchors: [pageAnchor()],
      };
      if (divergence.left !== undefined) {
        finding.expected = divergence.left;
      }
      if (divergence.right !== undefined) {
        finding.actual = divergence.right;
      }
      pushFinding(builder, finding);
    }
  }

  // ---- 5. selector resolution symmetry ----------------------------------------
  for (const { stepIndex, selector } of targets.actionSelectors) {
    if (stepIndex >= left.stepsCompleted || stepIndex >= right.stepsCompleted) {
      continue; // not attempted (and applied) on both sides
    }
    const leftStep = freshestPageStep(captures.left, stepIndex);
    const rightStep = freshestPageStep(captures.right, stepIndex);
    if (leftStep < 0 || rightStep < 0) {
      continue;
    }
    const leftTree = serializedTreeFor(captures.left, captures.left.pageAtStep.get(leftStep) ?? '', treeCache);
    const rightTree = serializedTreeFor(captures.right, captures.right.pageAtStep.get(rightStep) ?? '', treeCache);
    if (leftTree === undefined || rightTree === undefined) {
      continue;
    }
    const leftResolution = resolveTarget(leftTree, selector);
    const rightResolution = resolveTarget(rightTree, selector);
    if (leftResolution.ok !== rightResolution.ok) {
      pushFinding(builder, {
        dimension: 'semantic',
        severity: 'major',
        summary: `Target selector resolves asymmetrically at step ${stepIndex} (${JSON.stringify(selector)}): ${leftResolution.ok ? 'left resolved' : 'left did not resolve'}, ${rightResolution.ok ? 'right resolved' : 'right did not resolve'} under the observe resolution vocabulary.`,
        expected: { resolved: leftResolution.ok },
        actual: { resolved: rightResolution.ok },
        anchors: [anchor(stepIndex, run, captures, [])],
      });
      continue;
    }
    if (leftResolution.ok && rightResolution.ok) {
      const leftTestId = leftResolution.target.node.attrs?.['data-testid'] ?? '(none)';
      const rightTestId = rightResolution.target.node.attrs?.['data-testid'] ?? '(none)';
      if (leftTestId !== rightTestId) {
        pushFinding(builder, {
          dimension: 'semantic',
          severity: 'major',
          summary: `Target selector resolves to structurally different elements at step ${stepIndex} (${JSON.stringify(selector)}): left testid "${leftTestId}", right testid "${rightTestId}".`,
          expected: { testId: leftTestId },
          actual: { testId: rightTestId },
          anchors: [anchor(stepIndex, run, captures, [])],
        });
      }
    }
  }

  return builder.findings;
}
