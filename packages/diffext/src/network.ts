/**
 * @clapp/diffext — the NETWORK diff dimension (CLAPP-041).
 *
 * Compares ONE side's captured HTTP traffic against the plan's api/mock
 * spec (@clapp/plan synthesis-contract: PlannedApiEndpoint + MockResponse)
 * and produces 'network' DiffFindings per the differential verification
 * contract v0.1 mirror (./diff-contract.ts).
 *
 * MATCHING SEMANTICS (mirror the @clapp/codegen mock backend exactly —
 * documented there, reimplemented here because codegen is a devDependency
 * of this package, not a runtime one):
 * - a urlPattern matches a request PATH when both split into the same
 *   number of segments (only the LEADING empty segment is dropped; a
 *   trailing slash is NOT normalized away) and every literal segment is
 *   equal, while every ":name" segment matches exactly ONE non-empty
 *   path segment;
 * - the request QUERY STRING is ignored (the candidate server routes on
 *   the path alone);
 * - method comparison is case-insensitive;
 * - when several endpoints share a pattern, the first (declaration order)
 *   whose method matches is the serving one.
 *
 * VERDICT RULES (each anchored, each with machine-checkable expected/
 * actual where the check is not structural):
 * 1. matched + mocked endpoint: the response status MUST equal the mock's
 *    statusCode AND the parsed JSON body MUST deep-equal the mock's
 *    bodyJson (an absent bodyJson means an empty body). Any deviation is
 *    a 'major' finding (behavioral consequence: the candidate answers API
 *    traffic differently than the plan promises).
 * 2. matched + unmocked endpoint: the spec answer is 501 with a JSON body
 *    naming the endpoint id ({ error, endpointId } — the codegen server
 *    contract). A 501-with-endpointId is NO finding; anything else IS a
 *    'major' finding.
 * 3. path matched, method not (wrong method): the spec answer is 405. A
 *    405 is NO finding; anything else is a 'major' finding.
 * 4. unmatched request (no pattern matches the path):
 *    - answered 404 → NO finding. The candidate correctly reports the
 *      unknown path as unknown (the codegen server contract: unknown →
 *      404). This is the as-spec case the killer acceptance pins.
 *    - answered 2xx/3xx on an API-shaped path (default: path starts with
 *      '/api/') → 'major': the candidate serves unplanned API behavior.
 *    - answered 2xx/3xx on a document/static-asset-shaped request →
 *      'info': page documents and static assets are not API behavior;
 *      the divergence is recorded, no consequence established.
 *    - any other answer (4xx/5xx ≠ 404) → 'minor': an unexpected error
 *      surface on an unplanned path, consequence unestablished.
 *    - failed without a response → 'minor'.
 * 5. A request that MATCHED a planned pattern (any method) but failed
 *    without a response → 'major' (the planned API surface errored).
 * 6. A planned endpoint never exercised by ANY captured request → one
 *    'info' finding (honest observation, not an error).
 *
 * HONEST SCOPE (see also DIFFEXT_ADAPTER_INFO): this dimension judges the
 * candidate against the PLAN's api spec — the bench-b01 corpus carries NO
 * api baseline (endpoint-less plan api sections are legal input; corpus
 * page loads then surface as 'info'-grade document entries only).
 */

import type { MockResponse, PlannedApiEndpoint } from '@clapp/plan';
import type { DiffAnchor, DiffFinding, DiffSeverity } from './diff-contract';
import { newDiffFindingId } from './ids';

// ---------------------------------------------------------------------------
// Captured request vocabulary
// ---------------------------------------------------------------------------

/**
 * One captured HTTP exchange, driver-neutral. The dom driver (a recording
 * fetch, see ./capture.ts) fills every field; the playwright driver (the
 * @clapp/observe network channel) fills the same fields from
 * NetworkRequestPayload + drained responses, with bodyPreview-capped
 * bodies and resourceType.
 */
export interface CapturedRequest {
  /** Absolute request URL. */
  url: string;
  /** HTTP method (uppercase). */
  method: string;
  /** Response status; ABSENT when the request failed without a response. */
  status?: number;
  /** Response headers (lowercased names; volatile clock headers stripped). */
  headers?: Record<string, string>;
  /** Response body text (textual content types only); absent when unavailable. */
  body?: string;
  /** Playwright resourceType ('document' | 'stylesheet' | …) when captured in-browser. */
  resourceType?: string;
  /** Network failure text when the request failed without a response. */
  failure?: string;
}

/** Options for {@link compareNetworkTraffic}. */
export interface NetworkComparisonOptions {
  /**
   * Path prefixes that mark a request as API-shaped for unmatched-request
   * severity (default ['/api/']). Non-API 2xx/3xx traffic on document or
   * static-asset shapes stays 'info'.
   */
  apiPathPrefixes?: string[];
}

const DEFAULT_API_PATH_PREFIXES: readonly string[] = ['/api/'];

const STATIC_ASSET_EXTENSIONS: readonly string[] = [
  '.css', '.js', '.mjs', '.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp',
  '.ico', '.woff', '.woff2', '.ttf', '.otf', '.txt', '.webmanifest', '.map', '.html',
];

const DOCUMENT_RESOURCE_TYPES: ReadonlySet<string> = new Set([
  'document', 'stylesheet', 'script', 'image', 'font', 'media', 'manifest',
]);

// ---------------------------------------------------------------------------
// Pattern matching (codegen routing semantics, reimplemented)
// ---------------------------------------------------------------------------

/** Splits a path/pattern into segments; only the LEADING empty segment is dropped. */
function toSegments(path: string): string[] {
  const parts = path.split('/');
  return parts.length > 0 && parts[0] === '' ? parts.slice(1) : parts;
}

/** True when a request path matches a urlPattern (":name" = one non-empty segment). */
export function pathMatchesPattern(urlPattern: string, requestPath: string): boolean {
  const pattern = toSegments(urlPattern);
  const actual = toSegments(requestPath);
  if (pattern.length !== actual.length) {
    return false;
  }
  for (let index = 0; index < pattern.length; index += 1) {
    const expectedSegment = pattern[index];
    const actualSegment = actual[index];
    if (expectedSegment === undefined || actualSegment === undefined || actualSegment === '') {
      return false;
    }
    if (expectedSegment.startsWith(':')) {
      continue;
    }
    if (expectedSegment !== actualSegment) {
      return false;
    }
  }
  return true;
}

/** The request path of a captured URL (query + hash stripped, errors tolerated). */
export function requestPathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url.split('?')[0]?.split('#')[0] ?? url;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Structural JSON-value equality (both sides are JSON.parse output or plan literals). */
export function jsonDeepEqual(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }
  if (typeof left !== typeof right || left === null || right === null) {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    return left.every((element, index) => jsonDeepEqual(element, right[index]));
  }
  if (typeof left === 'object') {
    const leftKeys = Object.keys(left as Record<string, unknown>).sort();
    const rightKeys = Object.keys(right as Record<string, unknown>).sort();
    if (leftKeys.length !== rightKeys.length) {
      return false;
    }
    return leftKeys.every(
      (key) =>
        rightKeys.includes(key) &&
        jsonDeepEqual((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]),
    );
  }
  return false;
}

/** Parses a captured body as JSON; returns undefined when it is not JSON. */
function parseJsonBody(body: string | undefined): unknown {
  if (body === undefined || body.trim() === '') {
    return undefined;
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}

function isApiShapedPath(path: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => path.startsWith(prefix));
}

function staticShaped(request: CapturedRequest, path: string): boolean {
  if (request.resourceType !== undefined && DOCUMENT_RESOURCE_TYPES.has(request.resourceType)) {
    return true;
  }
  const contentType = request.headers?.['content-type'] ?? '';
  if (contentType.startsWith('text/html')) {
    return true;
  }
  const withoutQuery = path.split('?')[0] ?? path;
  return STATIC_ASSET_EXTENSIONS.some((extension) => withoutQuery.endsWith(extension));
}

/** The mocks serving one endpoint, plan declaration order (first serves — codegen determinism). */
function mocksForEndpoint(mocks: MockResponse[], endpointId: string): MockResponse[] {
  return mocks.filter((mock) => mock.endpointId === endpointId);
}

interface FindingInput {
  severity: DiffSeverity;
  summary: string;
  anchor: DiffAnchor;
  expected?: unknown;
  actual?: unknown;
}

function makeFinding(input: FindingInput): DiffFinding {
  const finding: DiffFinding = {
    id: newDiffFindingId(),
    dimension: 'network',
    severity: input.severity,
    summary: input.summary,
    anchors: [input.anchor],
  };
  if (input.expected !== undefined) {
    finding.expected = input.expected;
  }
  if (input.actual !== undefined) {
    finding.actual = input.actual;
  }
  return finding;
}

/** Augments the caller's anchor with the plan ids this finding concerns. */
function anchorFor(anchor: DiffAnchor, extraSourceIds: string[]): DiffAnchor {
  return { ...anchor, sourceIds: [...anchor.sourceIds, ...extraSourceIds] };
}

function endpointLabel(endpoint: PlannedApiEndpoint): string {
  return `${endpoint.method} ${endpoint.urlPattern}`;
}

// ---------------------------------------------------------------------------
// The comparison
// ---------------------------------------------------------------------------

/**
 * Compares captured traffic against the plan's api/mock spec. Pure and
 * synchronous: findings are derived from the records, never asserted.
 */
export function compareNetworkTraffic(
  captured: CapturedRequest[],
  planApi: PlannedApiEndpoint[],
  mocks: MockResponse[],
  anchor: DiffAnchor,
  options: NetworkComparisonOptions = {},
): DiffFinding[] {
  const apiPathPrefixes = options.apiPathPrefixes ?? DEFAULT_API_PATH_PREFIXES;
  const findings: DiffFinding[] = [];
  /** endpoint ids exercised by ANY pattern-matching request (any method). */
  const exercisedEndpointIds = new Set<string>();

  for (const request of captured) {
    const path = requestPathOf(request.url);
    const pathMatches = planApi.filter((endpoint) => pathMatchesPattern(endpoint.urlPattern, path));
    const serving = pathMatches.find(
      (endpoint) => endpoint.method.toLowerCase() === request.method.toLowerCase(),
    );

    if (serving !== undefined) {
      // Rule 1/2: a planned endpoint served this request.
      exercisedEndpointIds.add(serving.id);
      judgeServedEndpoint(request, serving, mocksForEndpoint(mocks, serving.id), anchor, findings);
      continue;
    }

    if (pathMatches.length > 0) {
      // Rule 3/5: the path is planned, the method is not.
      for (const endpoint of pathMatches) {
        exercisedEndpointIds.add(endpoint.id);
      }
      judgeWrongMethod(request, path, pathMatches, anchor, findings);
      continue;
    }

    // Rule 4: no planned pattern matches this path at all.
    judgeUnmatched(request, path, apiPathPrefixes, anchor, findings);
  }

  // Rule 6: planned endpoints never exercised → honest 'info' observations.
  for (const endpoint of planApi) {
    if (!exercisedEndpointIds.has(endpoint.id)) {
      findings.push(
        makeFinding({
          severity: 'info',
          summary: `planned endpoint ${endpointLabel(endpoint)} was never exercised by the captured traffic`,
          anchor: anchorFor(anchor, [endpoint.id]),
          expected: { exercised: true },
          actual: { exercised: false },
        }),
      );
    }
  }

  return findings;
}

/** Rules 1 + 2: the request hit a planned endpoint with the planned method. */
function judgeServedEndpoint(
  request: CapturedRequest,
  endpoint: PlannedApiEndpoint,
  endpointMocks: MockResponse[],
  anchor: DiffAnchor,
  findings: DiffFinding[],
): void {
  const endpointAnchor = anchorFor(anchor, [endpoint.id]);
  const label = endpointLabel(endpoint);

  if (request.status === undefined) {
    findings.push(
      makeFinding({
        severity: 'major',
        summary: `request to planned endpoint ${label} failed without a response${request.failure !== undefined ? ` (${request.failure})` : ''}`,
        anchor: endpointAnchor,
        expected: { statusCode: endpointMocks.length > 0 ? (endpointMocks[0]?.statusCode ?? null) : 501 },
        ...(request.failure !== undefined ? { actual: { failure: request.failure } } : {}),
      }),
    );
    return;
  }

  if (endpointMocks.length > 0) {
    const mock = endpointMocks[0]!;
    if (request.status !== mock.statusCode) {
      findings.push(
        makeFinding({
          severity: 'major',
          summary: `mocked endpoint ${label} answered HTTP ${request.status}; the plan's mock ${mock.id} declares ${mock.statusCode}`,
          anchor: endpointAnchor,
          expected: { statusCode: mock.statusCode, body: mock.bodyJson },
          actual: { statusCode: request.status, body: parseJsonBody(request.body) },
        }),
      );
      return;
    }
    const actualBody = parseJsonBody(request.body);
    if (mock.bodyJson === undefined) {
      if (actualBody !== undefined) {
        findings.push(
          makeFinding({
            severity: 'major',
            summary: `mocked endpoint ${label} answered a JSON body where the plan's mock ${mock.id} declares none`,
            anchor: endpointAnchor,
            expected: { statusCode: mock.statusCode, body: null },
            actual: { statusCode: request.status, body: actualBody },
          }),
        );
      }
      return;
    }
    if (actualBody === undefined) {
      findings.push(
        makeFinding({
          severity: 'major',
          summary: `mocked endpoint ${label} answered a non-JSON (or empty) body where the plan's mock ${mock.id} declares a JSON body`,
          anchor: endpointAnchor,
          expected: { statusCode: mock.statusCode, body: mock.bodyJson },
          actual: { statusCode: request.status, body: request.body ?? null },
        }),
      );
      return;
    }
    if (!jsonDeepEqual(actualBody, mock.bodyJson)) {
      findings.push(
        makeFinding({
          severity: 'major',
          summary: `mocked endpoint ${label} answered a different JSON body than the plan's mock ${mock.id} declares`,
          anchor: endpointAnchor,
          expected: { statusCode: mock.statusCode, body: mock.bodyJson },
          actual: { statusCode: request.status, body: actualBody },
        }),
      );
    }
    return;
  }

  // Unmocked endpoint: the spec answer is 501 + JSON naming the endpoint id.
  const actualBody = parseJsonBody(request.body);
  const namesEndpoint =
    request.status === 501 &&
    actualBody !== null &&
    typeof actualBody === 'object' &&
    !Array.isArray(actualBody) &&
    (actualBody as Record<string, unknown>)['endpointId'] === endpoint.id;
  if (!namesEndpoint) {
    findings.push(
      makeFinding({
        severity: 'major',
        summary: `unmocked endpoint ${label} answered HTTP ${request.status}; the spec requires 501 JSON naming endpoint ${endpoint.id}`,
        anchor: endpointAnchor,
        expected: { statusCode: 501, body: { error: 'no mock response declared for endpoint', endpointId: endpoint.id } },
        actual: { statusCode: request.status, body: actualBody ?? request.body ?? null },
      }),
    );
  }
}

/** Rules 3 + 5: the path matched planned patterns, the method did not. */
function judgeWrongMethod(
  request: CapturedRequest,
  path: string,
  pathMatches: PlannedApiEndpoint[],
  anchor: DiffAnchor,
  findings: DiffFinding[],
): void {
  const ids = pathMatches.map((endpoint) => endpoint.id);
  const labels = pathMatches.map((endpoint) => endpointLabel(endpoint)).join(', ');
  if (request.status === undefined) {
    findings.push(
      makeFinding({
        severity: 'major',
        summary: `${request.method} ${path} matches planned endpoint(s) ${labels} but failed without a response${request.failure !== undefined ? ` (${request.failure})` : ''}`,
        anchor: anchorFor(anchor, ids),
        expected: { statusCode: 405 },
        ...(request.failure !== undefined ? { actual: { failure: request.failure } } : {}),
      }),
    );
    return;
  }
  if (request.status !== 405) {
    findings.push(
      makeFinding({
        severity: 'major',
        summary: `${request.method} ${path} matched planned endpoint(s) ${labels} with a different method and answered HTTP ${request.status}; 405 was expected`,
        anchor: anchorFor(anchor, ids),
        expected: { statusCode: 405 },
        actual: { statusCode: request.status, body: parseJsonBody(request.body) },
      }),
    );
  }
}

/** Rule 4: no planned pattern matches. */
function judgeUnmatched(
  request: CapturedRequest,
  path: string,
  apiPathPrefixes: readonly string[],
  anchor: DiffAnchor,
  findings: DiffFinding[],
): void {
  if (request.status === undefined) {
    findings.push(
      makeFinding({
        severity: 'minor',
        summary: `unplanned request ${request.method} ${path} failed without a response${request.failure !== undefined ? ` (${request.failure})` : ''}`,
        anchor,
        ...(request.failure !== undefined ? { actual: { failure: request.failure } } : {}),
      }),
    );
    return;
  }
  if (request.status === 404) {
    // As-spec unknown-path answer — not a divergence (see module doc, rule 4).
    return;
  }
  if (request.status >= 200 && request.status < 400) {
    if (isApiShapedPath(path, apiPathPrefixes)) {
      findings.push(
        makeFinding({
          severity: 'major',
          summary: `unplanned API request ${request.method} ${path} was answered HTTP ${request.status} — the candidate serves API behavior outside the plan`,
          anchor,
          expected: { statusCode: 404 },
          actual: { statusCode: request.status, body: parseJsonBody(request.body) },
        }),
      );
      return;
    }
    findings.push(
      makeFinding({
        severity: 'info',
        summary: `non-API request ${request.method} ${path} (${describeShape(request, path)}) was captured outside the plan's api spec — recorded, no consequence established`,
        anchor,
        expected: { statusCode: 404 },
        actual: { statusCode: request.status },
      }),
    );
    return;
  }
  findings.push(
    makeFinding({
      severity: 'minor',
      summary: `unplanned request ${request.method} ${path} was answered HTTP ${request.status} — no planned endpoint matches, and the answer is not the as-spec 404`,
      anchor,
      expected: { statusCode: 404 },
      actual: { statusCode: request.status },
    }),
  );
}

function describeShape(request: CapturedRequest, path: string): string {
  if (request.resourceType !== undefined) {
    return `resourceType ${request.resourceType}`;
  }
  if (staticShaped(request, path)) {
    return 'document/static asset';
  }
  return 'non-API request';
}

// ---------------------------------------------------------------------------
// Evidence shaping for captured exchanges
// ---------------------------------------------------------------------------

/**
 * Builds the EvidenceRef-shaped record for one captured exchange: the
 * canonical JSON of the driver-neutral CapturedRequest (kind 'network').
 * Exposed so both capture drivers and the comparison share one hashing
 * vocabulary.
 */
export function capturedRequestEvidencePayload(request: CapturedRequest): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    kind: 'network',
    url: request.url,
    method: request.method,
  };
  if (request.status !== undefined) {
    payload['status'] = request.status;
  }
  if (request.headers !== undefined) {
    payload['headers'] = request.headers;
  }
  if (request.body !== undefined) {
    payload['body'] = request.body;
  }
  if (request.resourceType !== undefined) {
    payload['resourceType'] = request.resourceType;
  }
  if (request.failure !== undefined) {
    payload['failure'] = request.failure;
  }
  return payload;
}

/** The EvidenceRef kind every network capture uses (mirror vocabulary). */
export const NETWORK_EVIDENCE_KIND = 'network' as const;
