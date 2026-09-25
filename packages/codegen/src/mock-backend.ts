/**
 * @clapp/codegen — mock backend (CLAPP-031).
 *
 * The plan's api section becomes server routes in the generated app:
 *
 * - each PlannedApiEndpoint matches requests by METHOD + urlPattern, where
 *   a ":name" segment matches exactly one non-empty path segment
 *   ("/api/items/:id" matches "/api/items/42", not "/api/items/42/x");
 * - the matching MockResponse serves its statusCode + JSON body
 *   (content-type application/json);
 * - endpoints without mocks answer 501 with a JSON error body naming the
 *   endpoint id;
 * - when several mocks exist for one endpoint the FIRST by declaration
 *   order serves (documented determinism);
 * - a path that matches a pattern with the wrong method answers 405.
 *
 * buildApiTable/matchApiRoute are the in-package oracle for these
 * semantics; the generated server.ts embeds an equivalent, self-contained
 * matcher (generated apps never import @clapp/codegen), and the test
 * battery exercises the GENERATED server end-to-end.
 */

import type { PlannedApiEndpoint, SynthesisPlan } from './synthesis-contract';

/** One canned response as embedded in the generated server. */
export interface MockEntry {
  statusCode: number;
  bodyJson?: unknown;
}

/** One endpoint as embedded in the generated server (mocks pre-grouped). */
export interface ApiRouteEntry {
  endpointId: string;
  method: string;
  /** urlPattern split on '/'; ':name' segments are wildcards. */
  segments: string[];
  /** The endpoint's mocks in plan declaration order (index 0 serves). */
  mocks: MockEntry[];
}

/** Splits a url pattern into segments; only the LEADING empty segment is dropped. */
export function patternSegments(urlPattern: string): string[] {
  return toSegments(urlPattern);
}

/** Splits a request path the same way patterns are split. */
export function pathSegments(path: string): string[] {
  return toSegments(path);
}

/**
 * Strict segment split: '/api/items' → ['api','items'], but '/api/items/' →
 * ['api','items',''] (a trailing slash is NOT normalized away — page routes
 * match paths exactly, so api patterns keep the same strictness).
 */
function toSegments(path: string): string[] {
  const parts = path.split('/');
  return parts.length > 0 && parts[0] === '' ? parts.slice(1) : parts;
}

/** True when a request path matches a pattern segment list. */
export function segmentsMatch(pattern: string[], path: string[]): boolean {
  if (pattern.length !== path.length) {
    return false;
  }
  for (let index = 0; index < pattern.length; index += 1) {
    const expected = pattern[index];
    const actual = path[index];
    if (expected === undefined || actual === undefined || actual === '') {
      return false;
    }
    if (expected.startsWith(':')) {
      continue;
    }
    if (expected !== actual) {
      return false;
    }
  }
  return true;
}

/** The first endpoint whose pattern matches the path (method NOT considered). */
export function matchApiRoute(entries: ApiRouteEntry[], path: string): ApiRouteEntry | null {
  const segments = pathSegments(path);
  for (const entry of entries) {
    if (segmentsMatch(entry.segments, segments)) {
      return entry;
    }
  }
  return null;
}

/** All endpoints whose pattern matches the path, in declaration order. */
export function matchApiRoutes(entries: ApiRouteEntry[], path: string): ApiRouteEntry[] {
  const segments = pathSegments(path);
  return entries.filter((entry) => segmentsMatch(entry.segments, segments));
}

/** Result of resolving a (path, method) request against the endpoint table. */
export type ApiSelection =
  | { kind: 'serve'; route: ApiRouteEntry }
  /** 405: the path matches but no endpoint's method does (first match named). */
  | { kind: 'method-mismatch'; route: ApiRouteEntry; allowed: string[] }
  /** 404: no endpoint pattern matches the path. */
  | { kind: 'no-path-match' };

/**
 * Resolves a request against the endpoint table: the FIRST endpoint
 * matching path AND method serves (mirrors the generated server's
 * handler, where several endpoints may share one urlPattern with
 * different methods).
 */
export function selectApiRoute(entries: ApiRouteEntry[], path: string, method: string): ApiSelection {
  const pathMatches = matchApiRoutes(entries, path);
  if (pathMatches.length === 0) {
    return { kind: 'no-path-match' };
  }
  const serving = pathMatches.find((entry) => entry.method.toLowerCase() === method.toLowerCase());
  if (serving !== undefined) {
    return { kind: 'serve', route: serving };
  }
  const first = pathMatches[0];
  if (first === undefined) {
    return { kind: 'no-path-match' };
  }
  return { kind: 'method-mismatch', route: first, allowed: pathMatches.map((entry) => entry.method) };
}

/** True when the request method matches the endpoint's declared method. */
export function methodMatches(entry: ApiRouteEntry, method: string): boolean {
  return entry.method.toLowerCase() === method.toLowerCase();
}

/** Manifest label for an endpoint: "GET /api/items/:id". */
export function apiEndpointLabel(endpoint: PlannedApiEndpoint): string {
  return `${endpoint.method} ${endpoint.urlPattern}`;
}

/**
 * Builds the endpoint table for the generated server: endpoints in plan
 * declaration order, each with its mocks (filtered by endpointId, plan
 * declaration order preserved). Mocks naming unknown endpoint ids are
 * reported as notes — surfaced in the generated README, never silently
 * dropped.
 */
export function buildApiTable(
  plan: SynthesisPlan,
): { entries: ApiRouteEntry[]; notes: string[] } {
  const entries: ApiRouteEntry[] = plan.api.endpoints.map((endpoint) => ({
    endpointId: endpoint.id,
    method: endpoint.method,
    segments: patternSegments(endpoint.urlPattern),
    mocks: [],
  }));
  const byEndpointId = new Map(entries.map((entry) => [entry.endpointId, entry]));

  const notes: string[] = [];
  for (const mock of plan.api.mocks) {
    const entry = byEndpointId.get(mock.endpointId);
    if (entry === undefined) {
      notes.push(`mock ${mock.id} names endpoint ${mock.endpointId} which is not declared in plan.api.endpoints — mock ignored`);
      continue;
    }
    const validStatus = Number.isInteger(mock.statusCode) && mock.statusCode >= 100 && mock.statusCode <= 599;
    if (!validStatus) {
      notes.push(`mock ${mock.id} declares non-HTTP status ${String(mock.statusCode)} — served as 500`);
    }
    const mockEntry: MockEntry = {
      statusCode: validStatus ? mock.statusCode : 500,
      ...(mock.bodyJson === undefined ? {} : { bodyJson: mock.bodyJson }),
    };
    entry.mocks.push(mockEntry);
  }
  return { entries, notes };
}
