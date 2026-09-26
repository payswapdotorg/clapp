/**
 * @clapp/repair — the bounded repair strategies (CLAPP-042).
 *
 * Three REQUIRED capabilities, each a pure content transform
 * `(fileContent, finding) → StrategyResult` — no git, no fs, no plan
 * access. All input facts come from the finding's expected / actual
 * payloads (observable left-side truth vs candidate-side observation).
 * Strategies never GUESS: when the evidence cannot locate the edit
 * uniquely, the strategy returns null (honest "not applicable") and the
 * attempt records an abort.
 *
 *  1. text-restore — expected/actual are two different strings on the
 *     same route → replace the actual string with the expected in the
 *     scoped page module. Minimal single-string edit: the needle must
 *     appear exactly ONCE (byte-perfect restoration; ambiguity aborts).
 *
 *  2. attribute-restore — a missing/renamed data-testid (expected names
 *     the testid + the route) → add/restore the attribute on the matching
 *     element in the scoped page module, inserted at the candidate
 *     layout's canonical attribute slot so a successful repair is
 *     byte-identical to the pristine generated file.
 *
 *  3. mock-restore — a network-shaped finding (expected statusCode/body
 *     vs actual) → restore the status/body inside the scoped generated
 *     server's mock entry for the named endpoint.
 *
 * ESCAPING: generated page modules embed HTML inside a TS template
 * literal (backslash/backtick/${ escaped) and the HTML itself escapes
 * `& < >` (attributes additionally `"`). Each strategy therefore tries
 * the needle in three equivalent forms — template(html(x)), html(x), raw
 * x — and replaces with the SAME form of the expected value, so ordinary
 * ASCII payloads (the corpus texts) restore byte-perfectly and escaped
 * payloads still repair correctly.
 *
 * IDEMPOTENCE: every strategy first checks whether the finding's
 * expected fact ALREADY holds (duplicate findings of one defect, re-runs)
 * and reports a resolved no-op in that case — never a second edit.
 */

import type { DiffFinding } from './diff-contract';
import {
  isMockPayload,
  isTestidPayload,
  isTextPayload,
  MOCK_TARGET_PATH,
  pageModulePathForRoute,
  type MockPayload,
  type TestidPayload,
  type TextPayload,
} from './payload';

// ---------------------------------------------------------------------------
// Shared escaping helpers (mirror @clapp/codegen's emission conventions)
// ---------------------------------------------------------------------------

function htmlEscape(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function templateEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

/** The byte-forms a payload string can appear in inside a generated file (canonical first). */
function needleForms(value: string): string[] {
  const html = htmlEscape(value);
  const template = templateEscape(html);
  return [...new Set([template, html, value])];
}

/** The first needle form present exactly once, with its position. */
function uniqueNeedle(content: string, value: string): { needle: string; index: number } | null {
  for (const form of needleForms(value)) {
    const first = content.indexOf(form);
    if (first === -1) {
      continue;
    }
    if (content.indexOf(form, first + form.length) === -1) {
      return { needle: form, index: first };
    }
  }
  return null;
}

/** The first needle form present at all, with its position. */
function anyNeedle(content: string, value: string): { needle: string; index: number } | null {
  for (const form of needleForms(value)) {
    const index = content.indexOf(form);
    if (index !== -1) {
      return { needle: form, index };
    }
  }
  return null;
}

/** Counts non-overlapping occurrences of `needle` in `content`. */
function countOccurrences(content: string, needle: string): number {
  if (needle === '') {
    return 0;
  }
  let count = 0;
  let index = content.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = content.indexOf(needle, index + needle.length);
  }
  return count;
}

// ---------------------------------------------------------------------------
// Strategy result shape
// ---------------------------------------------------------------------------

export type StrategyName = 'text-restore' | 'attribute-restore' | 'mock-restore';

/** One strategy's attempted edit over one file's content. */
export interface StrategyResult {
  strategy: StrategyName;
  /** The new file content after the edit (=== input when nothing changed). */
  content: string;
  /** Local post-edit verification: the finding's expected fact now holds. */
  resolved: boolean;
  /** Whether the strategy actually changed the content. */
  edited: boolean;
  /** One honest sentence for the commit message. */
  summary: string;
}

// ---------------------------------------------------------------------------
// 1. text-restore
// ---------------------------------------------------------------------------

function textPayloadPair(finding: DiffFinding): { expected: TextPayload; actual: TextPayload } | null {
  if (!isTextPayload(finding.expected) || !isTextPayload(finding.actual)) {
    return null;
  }
  if (finding.expected.route !== finding.actual.route || finding.expected.text === finding.actual.text) {
    return null;
  }
  return { expected: finding.expected, actual: finding.actual };
}

/** Verifies the expected text is present (any needle form). */
function verifyText(content: string, expected: TextPayload): boolean {
  return anyNeedle(content, expected.text) !== null;
}

/**
 * text-restore: replace the actual text (appearing exactly once) with the
 * expected text, same byte-form. Aborts (null) when either text is absent
 * or the actual text is ambiguous (≠1 occurrence) — never a fuzzy guess.
 */
export function applyTextRestore(content: string, finding: DiffFinding): StrategyResult | null {
  const pair = textPayloadPair(finding);
  if (pair === null) {
    return null;
  }
  if (verifyText(content, pair.expected)) {
    return {
      strategy: 'text-restore',
      content,
      resolved: true,
      edited: false,
      summary: `text-restore: expected text already present on ${pair.expected.route} (idempotent)`,
    };
  }
  const needle = uniqueNeedle(content, pair.actual.text);
  if (needle === null) {
    return null;
  }
  // Replace with the same byte-form of the expected text.
  const formIndex = needleForms(pair.actual.text).indexOf(needle.needle);
  const expectedForms = needleForms(pair.expected.text);
  const replacement =
    formIndex >= 0 && formIndex < expectedForms.length
      ? expectedForms[formIndex]
      : (expectedForms[0] ?? pair.expected.text);
  const next =
    content.slice(0, needle.index) + replacement + content.slice(needle.index + needle.needle.length);
  return {
    strategy: 'text-restore',
    content: next,
    resolved: verifyText(next, pair.expected),
    edited: true,
    summary: `text-restore on ${pair.expected.route}: ${JSON.stringify(pair.actual.text)} -> ${JSON.stringify(pair.expected.text)}`,
  };
}

// ---------------------------------------------------------------------------
// 2. attribute-restore (data-testid)
// ---------------------------------------------------------------------------

/** The locator facts an attribute-restore needs, merged from both sides. */
interface TestidLocator extends TestidPayload {
  expectedTestId: string;
}

function testidLocator(finding: DiffFinding): TestidLocator | null {
  if (!isTestidPayload(finding.expected) || !isTestidPayload(finding.actual)) {
    return null;
  }
  if (finding.expected.route !== finding.actual.route) {
    return null;
  }
  const expectedTestId = finding.expected.testId;
  if (expectedTestId === undefined || expectedTestId === '') {
    return null;
  }
  if (finding.actual.testId === expectedTestId) {
    return null; // no divergence to repair
  }
  return {
    kind: 'testid' as const,
    route: finding.actual.route,
    testId: finding.actual.testId,
    tag: finding.actual.tag ?? finding.expected.tag,
    text: finding.actual.text ?? finding.expected.text,
    matchIndex: finding.actual.matchIndex ?? finding.expected.matchIndex,
    expectedTestId,
  };
}

/**
 * The candidate layout's attribute slots: where @clapp/codegen renders
 * `data-testid` inside each element's opening tag. Inserting at the
 * canonical slot makes a successful restore byte-identical to the
 * pristine generated file.
 */
const TESTID_SLOT_PREFIX_ATTRS: Readonly<Record<string, readonly string[]>> = {
  a: ['href', 'aria-label'],
  button: ['type', 'aria-label'],
  img: ['src', 'alt', 'aria-label'],
  form: ['action', 'method'],
  div: ['role'],
  nav: ['aria-label'],
  ul: ['aria-label'],
  ol: ['aria-label'],
  header: ['aria-label'],
  main: ['aria-label'],
  footer: ['aria-label'],
  aside: ['aria-label'],
  article: ['aria-label'],
  section: ['aria-label'],
};

/** Tags whose data-testid renders LAST in the opening tag (codegen field order: id/name/type/…/required/testid). */
const TESTID_SLOT_AT_END = new Set(['input', 'textarea', 'select']);

/** Heading tags: data-testid renders immediately after the tag name. */
function isHeadingTag(tag: string): boolean {
  return /^h[1-6]$/.test(tag);
}

/** Paragraphs and labels cannot carry a data-testid in the candidate layout (no testid slot is rendered). */
const UNSLOTTABLE_TAGS = new Set(['p', 'label']);

interface OpeningTagMatch {
  /** Full opening tag text, e.g. `<h1>` or `<a href="/">`. */
  tag: string;
  /** Index of the opening tag in the content. */
  index: number;
  /** Index just past the closing `>` of the opening tag. */
  end: number;
}

/** Finds the matchIndex-th opening tag of `tag` whose immediate text content is `text`. */
function locateElement(
  content: string,
  tag: string,
  text: string,
  matchIndex: number,
): OpeningTagMatch | null {
  for (const form of needleForms(text)) {
    const openRegex = new RegExp(`<${tag}(?:\\s[^>]*)?>`, 'g');
    let seen = 0;
    for (let match = openRegex.exec(content); match !== null; match = openRegex.exec(content)) {
      const opening: OpeningTagMatch = {
        tag: match[0],
        index: match.index,
        end: match.index + match[0].length,
      };
      // The element's text content must start right after `>`.
      if (!content.startsWith(form, opening.end)) {
        continue;
      }
      if (seen === matchIndex) {
        return opening;
      }
      seen += 1;
    }
  }
  return null;
}

/**
 * Computes the absolute insertion offset for ` data-testid="…"` inside an
 * opening tag (the candidate layout's canonical slot), or null when the
 * tag renders no data-testid slot at all.
 */
function testidInsertionOffset(opening: OpeningTagMatch): number | null {
  const inner = opening.tag.slice(1, -1); // between `<` and `>`
  const tag = inner.split(/\s/)[0] ?? '';
  if (tag === '' || UNSLOTTABLE_TAGS.has(tag)) {
    return null;
  }
  if (TESTID_SLOT_AT_END.has(tag)) {
    return opening.end - 1; // just before the closing `>`
  }
  if (isHeadingTag(tag)) {
    return opening.index + 1 + tag.length; // immediately after the tag name
  }
  const prefixAttrs = TESTID_SLOT_PREFIX_ATTRS[tag];
  if (prefixAttrs === undefined) {
    return opening.index + 1 + tag.length; // unknown tag: after the tag name
  }
  // After the LAST of the listed prefix attributes actually present.
  let offset = opening.index + 1 + tag.length;
  for (const attr of prefixAttrs) {
    const attrRegex = new RegExp(`\\s${attr}="[^"]*"`);
    const found = attrRegex.exec(opening.tag);
    if (found !== null) {
      offset = Math.max(offset, opening.index + found.index + found[0].length);
    }
  }
  return offset;
}

/** attribute-restore: add (missing) or rewrite (renamed) a data-testid at the canonical slot. */
export function applyAttributeRestore(content: string, finding: DiffFinding): StrategyResult | null {
  const locator = testidLocator(finding);
  if (locator === null) {
    return null;
  }

  // Renamed testid: a pure attribute-value swap, no element location needed.
  if (locator.testId !== undefined && locator.testId !== '') {
    const oldAttr = `data-testid="${locator.testId}"`;
    const newAttr = `data-testid="${locator.expectedTestId}"`;
    if (countOccurrences(content, oldAttr) === 1) {
      const next = content.replace(oldAttr, newAttr);
      return {
        strategy: 'attribute-restore',
        content: next,
        resolved: countOccurrences(next, newAttr) === 1,
        edited: true,
        summary: `attribute-restore on ${locator.route}: data-testid ${JSON.stringify(locator.testId)} -> ${JSON.stringify(locator.expectedTestId)}`,
      };
    }
  }

  // Missing testid: locate the element (tag + text + ordinal) and insert.
  if (locator.tag === undefined || locator.text === undefined) {
    return null;
  }
  const located = locateElement(content, locator.tag, locator.text, locator.matchIndex ?? 0);
  if (located === null) {
    return null; // element not locatable — honest abstention
  }
  const insertion = ` data-testid="${locator.expectedTestId}"`;
  if (located.tag.includes(insertion.trim())) {
    return {
      strategy: 'attribute-restore',
      content,
      resolved: true,
      edited: false,
      summary: `attribute-restore: data-testid ${JSON.stringify(locator.expectedTestId)} already present on ${locator.route} (idempotent)`,
    };
  }
  const offset = testidInsertionOffset(located);
  if (offset === null) {
    return null; // tag has no data-testid slot in the candidate layout
  }
  const next = content.slice(0, offset) + insertion + content.slice(offset);
  const verify = locateElement(next, locator.tag, locator.text, locator.matchIndex ?? 0);
  const resolved = verify !== null && verify.tag.includes(insertion.trim());
  return {
    strategy: 'attribute-restore',
    content: next,
    resolved,
    edited: true,
    summary: `attribute-restore on ${locator.route}: add data-testid ${JSON.stringify(locator.expectedTestId)} to <${locator.tag}>`,
  };
}

// ---------------------------------------------------------------------------
// 3. mock-restore
// ---------------------------------------------------------------------------

function mockPayloadPair(finding: DiffFinding): { expected: MockPayload; actual: MockPayload } | null {
  if (!isMockPayload(finding.expected) || !isMockPayload(finding.actual)) {
    return null;
  }
  if (
    finding.expected.method.toUpperCase() !== finding.actual.method.toUpperCase() ||
    finding.expected.urlPattern !== finding.actual.urlPattern
  ) {
    return null;
  }
  if (
    finding.expected.statusCode === finding.actual.statusCode &&
    JSON.stringify(finding.expected.bodyJson) === JSON.stringify(finding.actual.bodyJson)
  ) {
    return null; // no divergence
  }
  return { expected: finding.expected, actual: finding.actual };
}

/** Locates the generated server's mock entry block (mocks: [ … ]) for (method, urlPattern). */
function locateMockEntry(content: string, payload: MockPayload): { start: number; end: number } | null {
  const segments = payload.urlPattern.split('/').filter((segment) => segment !== '');
  const segmentsNeedle = `segments: ${JSON.stringify(segments)},`;
  const methodNeedle = `method: ${JSON.stringify(payload.method)},`;
  let searchFrom = 0;
  for (;;) {
    const segIndex = content.indexOf(segmentsNeedle, searchFrom);
    if (segIndex === -1) {
      return null;
    }
    searchFrom = segIndex + segmentsNeedle.length;
    // The entry block lays endpointId / method / segments on consecutive
    // lines; the method line sits within a short window before segments.
    const window = content.slice(Math.max(0, segIndex - 300), segIndex);
    if (!window.includes(methodNeedle)) {
      continue;
    }
    const mocksIndex = content.indexOf('mocks: [', segIndex);
    if (mocksIndex === -1) {
      return null;
    }
    const closeIndex = content.indexOf('],', mocksIndex);
    if (closeIndex === -1) {
      return null;
    }
    return { start: mocksIndex, end: closeIndex };
  }
}

/** mock-restore: restore status (and body when divergent) inside the endpoint's mocks block. */
export function applyMockRestore(content: string, finding: DiffFinding): StrategyResult | null {
  const pair = mockPayloadPair(finding);
  if (pair === null) {
    return null;
  }
  const { expected, actual } = pair;
  const entry = locateMockEntry(content, expected);
  if (entry === null) {
    return null;
  }
  const block = content.slice(entry.start, entry.end);
  const expectedBodyLiteral =
    expected.bodyJson === undefined ? undefined : `bodyJson: ${JSON.stringify(expected.bodyJson)}`;

  // Idempotence: expected facts already hold in the entry.
  if (
    block.includes(`statusCode: ${expected.statusCode}`) &&
    (expectedBodyLiteral === undefined || block.includes(expectedBodyLiteral))
  ) {
    return {
      strategy: 'mock-restore',
      content,
      resolved: true,
      edited: false,
      summary: `mock-restore: ${expected.method} ${expected.urlPattern} already answers ${String(expected.statusCode)} (idempotent)`,
    };
  }

  let nextBlock = block;
  if (expected.statusCode !== actual.statusCode) {
    const statusNeedle = `statusCode: ${actual.statusCode}`;
    if (countOccurrences(nextBlock, statusNeedle) !== 1) {
      return null; // cannot locate the divergent status uniquely
    }
    nextBlock = nextBlock.replace(statusNeedle, `statusCode: ${expected.statusCode}`);
  }
  if (
    expectedBodyLiteral !== undefined &&
    actual.bodyJson !== undefined &&
    JSON.stringify(expected.bodyJson) !== JSON.stringify(actual.bodyJson)
  ) {
    const bodyNeedle = `bodyJson: ${JSON.stringify(actual.bodyJson)}`;
    if (countOccurrences(nextBlock, bodyNeedle) === 1) {
      nextBlock = nextBlock.replace(bodyNeedle, expectedBodyLiteral);
    } else if (!nextBlock.includes(expectedBodyLiteral)) {
      return null; // cannot locate the divergent body uniquely
    }
  }
  const next = content.slice(0, entry.start) + nextBlock + content.slice(entry.end);
  const verifyEntry = locateMockEntry(next, expected);
  const verifyBlock = verifyEntry === null ? '' : next.slice(verifyEntry.start, verifyEntry.end);
  const resolved =
    verifyBlock.includes(`statusCode: ${expected.statusCode}`) &&
    (expectedBodyLiteral === undefined || verifyBlock.includes(expectedBodyLiteral));
  return {
    strategy: 'mock-restore',
    content: next,
    resolved,
    edited: true,
    summary: `mock-restore on ${expected.method} ${expected.urlPattern}: status ${String(actual.statusCode)} -> ${String(expected.statusCode)}`,
  };
}

// ---------------------------------------------------------------------------
// Strategy selection + verification (pure dispatch)
// ---------------------------------------------------------------------------

export interface StrategyPlan {
  strategy: StrategyName;
  /** The candidate-relative file this strategy edits (derived from the payload). */
  targetPath: string;
}

/** The route a text/testid payload carries, or null. */
function payloadRoute(value: unknown): string | null {
  if (isTextPayload(value) || isTestidPayload(value)) {
    return value.route;
  }
  return null;
}

/** Selects the strategy for a finding, or null when no strategy's input shape matches. */
export function selectStrategy(finding: DiffFinding): StrategyPlan | null {
  const route = payloadRoute(finding.expected) ?? payloadRoute(finding.actual);
  if (textPayloadPair(finding) !== null && route !== null) {
    return { strategy: 'text-restore', targetPath: pageModulePathForRoute(route) };
  }
  if (testidLocator(finding) !== null && route !== null) {
    return { strategy: 'attribute-restore', targetPath: pageModulePathForRoute(route) };
  }
  if (mockPayloadPair(finding) !== null) {
    return { strategy: 'mock-restore', targetPath: MOCK_TARGET_PATH };
  }
  return null;
}

/** Applies the finding's selected strategy to `content`. */
export function applyStrategy(content: string, finding: DiffFinding): StrategyResult | null {
  if (textPayloadPair(finding) !== null) {
    return applyTextRestore(content, finding);
  }
  if (testidLocator(finding) !== null) {
    return applyAttributeRestore(content, finding);
  }
  if (mockPayloadPair(finding) !== null) {
    return applyMockRestore(content, finding);
  }
  return null;
}

/**
 * Local post-edit verification WITHOUT editing: does the finding's
 * expected fact already hold in `content`? (Idempotence + resolution
 * check — the BEHAVIORAL verification is the re-run oracle's job.)
 */
export function verifyFinding(content: string, finding: DiffFinding): boolean {
  if (isTextPayload(finding.expected)) {
    return verifyText(content, finding.expected);
  }
  const locator = testidLocator(finding);
  if (locator !== null) {
    if (locator.tag !== undefined && locator.text !== undefined) {
      const located = locateElement(content, locator.tag, locator.text, locator.matchIndex ?? 0);
      return located !== null && located.tag.includes(`data-testid="${locator.expectedTestId}"`);
    }
    return content.includes(`data-testid="${locator.expectedTestId}"`);
  }
  const pair = mockPayloadPair(finding);
  if (pair !== null) {
    const entry = locateMockEntry(content, pair.expected);
    if (entry === null) {
      return false;
    }
    const block = content.slice(entry.start, entry.end);
    return (
      block.includes(`statusCode: ${pair.expected.statusCode}`) &&
      (pair.expected.bodyJson === undefined ||
        block.includes(`bodyJson: ${JSON.stringify(pair.expected.bodyJson)}`))
    );
  }
  return false;
}
