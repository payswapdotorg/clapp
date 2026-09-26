/**
 * @clapp/repair — the repair payload vocabulary (CLAPP-042).
 *
 * The diff-contract leaves `DiffFinding.expected`/`actual` as
 * dimension-specific `unknown` payloads. This module declares the ONE
 * vocabulary the repair strategies understand, plus the runtime guards and
 * the anchor→candidate-file mapping (scope path derivation) built on it.
 *
 * PAYLOAD SHAPES (documented, machine-checkable — see README for the full
 * strategy table; every shape is plain JSON so reports stay serializable):
 *
 *   text-restore input (dimension 'semantic'):
 *     expected: { kind: 'text', route: string, text: string }
 *     actual:   { kind: 'text', route: string, text: string }
 *     — the same observable string (heading text, link label, …) on the
 *       same route, with different values on the two sides.
 *
 *   attribute-restore input (dimension 'semantic'):
 *     expected: { kind: 'testid', route: string, testId: string,
 *                tag?: string, text?: string, matchIndex?: number }
 *     actual:   { kind: 'testid', route: string, testId?: string,
 *                tag?: string, text?: string, matchIndex?: number }
 *     — expected names the testid the LEFT side proves; actual omits
 *       testId (missing) or carries a different one (renamed). tag/text/
 *       matchIndex locate the element in document order when present.
 *
 *   mock-restore input (dimension 'network'):
 *     expected: { kind: 'mock', method: string, urlPattern: string,
 *                statusCode: number, bodyJson?: unknown }
 *     actual:   { kind: 'mock', method: string, urlPattern: string,
 *                statusCode: number, bodyJson?: unknown }
 *     — a mock backend response that diverged in status and/or body.
 *
 * Findings whose expected/actual do not conform to one of these shapes
 * (including fully STRUCTURAL findings, where the contract keeps
 * expected/actual absent) carry NO derivable target file: they cluster
 * into directives with empty scope and honestly abort as unrepairable —
 * never a forced or faked repair.
 *
 * NON-DEGENERACY: payloads carry only OBSERVABLE facts (route paths,
 * texts, testids, HTTP facts) — never SynthesisPlan constructs. The route
 * strings here are replay-observed URL paths; mapping them to candidate
 * files is pure file-layout knowledge (below), not plan knowledge.
 */

// ---------------------------------------------------------------------------
// Payload types
// ---------------------------------------------------------------------------

/** A text divergence on one route (text-restore input). */
export interface TextPayload {
  kind: 'text';
  /** Route path the text was observed on, e.g. "/pricing.html". */
  route: string;
  /** The observed text on that side. */
  text: string;
}

/** A data-testid divergence on one route (attribute-restore input). */
export interface TestidPayload {
  kind: 'testid';
  /** Route path the element was observed on. */
  route: string;
  /** The data-testid this side proves (ABSENT on the actual side when missing). */
  testId?: string;
  /** Element tag (locates the element when provided). */
  tag?: string;
  /** Element text (locates the element when provided). */
  text?: string;
  /** 0-based ordinal among same-tag/same-text matches in document order. */
  matchIndex?: number;
}

/** A mock backend response divergence (mock-restore input). */
export interface MockPayload {
  kind: 'mock';
  /** HTTP method, e.g. "GET". */
  method: string;
  /** The endpoint's url pattern, e.g. "/api/notes". */
  urlPattern: string;
  /** The status this side answered with. */
  statusCode: number;
  /** The parsed JSON body this side answered with (absent when empty). */
  bodyJson?: unknown;
}

// ---------------------------------------------------------------------------
// Runtime guards (unknown → payload; strict, absent-not-null)
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

/** True when `value` structurally conforms to {@link TextPayload}. */
export function isTextPayload(value: unknown): value is TextPayload {
  return (
    isPlainObject(value) &&
    value['kind'] === 'text' &&
    typeof value['route'] === 'string' &&
    typeof value['text'] === 'string'
  );
}

/** True when `value` structurally conforms to {@link TestidPayload}. */
export function isTestidPayload(value: unknown): value is TestidPayload {
  return (
    isPlainObject(value) &&
    value['kind'] === 'testid' &&
    typeof value['route'] === 'string' &&
    optionalString(value['testId']) &&
    optionalString(value['tag']) &&
    optionalString(value['text']) &&
    (value['matchIndex'] === undefined || typeof value['matchIndex'] === 'number')
  );
}

/** True when `value` structurally conforms to {@link MockPayload}. */
export function isMockPayload(value: unknown): value is MockPayload {
  return (
    isPlainObject(value) &&
    value['kind'] === 'mock' &&
    typeof value['method'] === 'string' &&
    typeof value['urlPattern'] === 'string' &&
    typeof value['statusCode'] === 'number' &&
    (value['bodyJson'] === undefined || isPlainObject(value['bodyJson']) || Array.isArray(value['bodyJson']))
  );
}

// ---------------------------------------------------------------------------
// The anchor→file mapping (scope path derivation)
// ---------------------------------------------------------------------------

/**
 * Candidate-layout knowledge: how @clapp/codegen names a route's page
 * module. Re-implemented here (NOT imported) because @clapp/codegen is a
 * devDependency reserved for tests — the shipped loop only needs the file
 * LAYOUT convention, which is stable generated-tree knowledge:
 *
 *   "/"                → "pages/index.html.ts"
 *   "/features.html"   → "pages/features.html.ts"
 *   "/docs/guide"      → "pages/docs/guide.html.ts"
 *
 * A path segment is lowercased and slugged (runs of non-alphanumerics →
 * "-", trimmed); a trailing ".html" is stripped first. This mirrors
 * @clapp/codegen's pageModulePath byte-for-byte so derived scope paths
 * always name real generated files.
 */
export function pageModulePathForRoute(route: string): string {
  const raw = route.split('#')[0]?.split('?')[0] ?? route;
  const segments = raw.split('/').filter((segment) => segment !== '');
  if (segments.length === 0) {
    return 'pages/index.html.ts';
  }
  return `pages/${segments.map(slugSegment).join('/')}.html.ts`;
}

function slugSegment(segment: string): string {
  const base = segment.toLowerCase().endsWith('.html')
    ? segment.slice(0, -'.html'.length)
    : segment;
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-+|-+$)/g, '');
  return slug === '' ? '-' : slug;
}

/** The candidate-relative file a mock/network finding targets: the generated server (mock backend lives in server.ts). */
export const MOCK_TARGET_PATH = 'server.ts';

/**
 * The candidate-relative file a finding's payload points at, or null when
 * the payload carries no locatable target (structural findings, foreign
 * payload shapes). The expected side wins; the actual side is the
 * fallback (they agree on route/method in every well-formed pair).
 */
export function payloadTargetPath(payload: unknown): string | null {
  if (isTextPayload(payload) || isTestidPayload(payload)) {
    return pageModulePathForRoute(payload.route);
  }
  if (isMockPayload(payload)) {
    return MOCK_TARGET_PATH;
  }
  return null;
}

/**
 * The scope path a finding maps to: the expected payload's target, else
 * the actual payload's, else null (unlocatable). Pure function of the
 * finding's observable payload — no plan access, ever.
 */
export function findingTargetPath(finding: { expected?: unknown; actual?: unknown }): string | null {
  return payloadTargetPath(finding.expected) ?? payloadTargetPath(finding.actual);
}

// ---------------------------------------------------------------------------
// Honest one-sentence acceptance clauses (per payload kind)
// ---------------------------------------------------------------------------

/**
 * The clause a finding contributes to its directive's acceptance
 * sentence. Templates (documented):
 *   text:  "the text '<expected>' must be observed on <route>"
 *   testid: "data-testid '<expected>' must be present on <route>"
 *   mock:  "<METHOD> <urlPattern> must answer <statusCode>"
 *   other: "finding <id> must no longer reproduce"
 */
export function acceptanceClause(finding: { id: string; expected?: unknown; actual?: unknown }): string {
  if (isTextPayload(finding.expected)) {
    return `the text ${JSON.stringify(finding.expected.text)} must be observed on ${finding.expected.route}`;
  }
  if (isTestidPayload(finding.expected) && finding.expected.testId !== undefined) {
    return `data-testid ${JSON.stringify(finding.expected.testId)} must be present on ${finding.expected.route}`;
  }
  if (isMockPayload(finding.expected)) {
    const body = finding.expected.bodyJson === undefined ? '' : ' with the expected body';
    return `${finding.expected.method} ${finding.expected.urlPattern} must answer ${String(finding.expected.statusCode)}${body}`;
  }
  return `finding ${finding.id} must no longer reproduce`;
}
