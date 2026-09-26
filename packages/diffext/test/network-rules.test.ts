/**
 * CLAPP-041 test battery — the network dimension's RULE MATRIX (synthetic,
 * browser-independent, always runs).
 *
 * Every verdict rule of compareNetworkTraffic is pinned here against
 * hand-built CapturedRequest / PlannedApiEndpoint / MockResponse literals,
 * including the as-spec no-finding cases. The REAL-server killer acceptance
 * lives in network-acceptance.test.ts; this file pins the rules themselves.
 *
 * The AS-SPEC BASELINE traffic (below) exercises BOTH planned endpoints
 * exactly per spec, so isolated rule probes never trip the honest
 * "never exercised" observation — the same structure the killer
 * acceptance uses ("exercise every endpoint, then probe").
 */

import { describe, expect, it } from 'bun:test';
import type { MockResponse, PlannedApiEndpoint } from '@clapp/plan';
import type { DiffAnchor, DiffFinding } from '../src/diff-contract';
import { compareNetworkTraffic, pathMatchesPattern, requestPathOf, jsonDeepEqual } from '../src/network';
import type { CapturedRequest } from '../src/network';

const UUID = '00000000-0000-4000-8000-';
const BASE = 'http://127.0.0.1:4533';

const ENDPOINTS: PlannedApiEndpoint[] = [
  {
    id: `api_${UUID}0000000000a1`,
    method: 'GET',
    urlPattern: '/api/notes',
    sourceOperationIds: [],
    provenance: { level: 'planned', rationale: 'test fixture', sourceIds: [], evidenceRefs: [] },
  },
  {
    id: `api_${UUID}0000000000a2`,
    method: 'GET',
    urlPattern: '/api/items/:id',
    sourceOperationIds: [],
    provenance: { level: 'planned', rationale: 'test fixture', sourceIds: [], evidenceRefs: [] },
  },
];

const MOCKS: MockResponse[] = [
  {
    id: `mock_${UUID}0000000000m1`,
    endpointId: ENDPOINTS[0]!.id,
    statusCode: 200,
    bodyJson: { ok: true, source: 'fixture', notes: [{ id: 'n1', title: 'First note' }] },
  },
];

const ANCHOR: DiffAnchor = { stepIndex: 0, sourceIds: [`appsyn_${UUID}0000000000d1`] };

function captured(init: Partial<CapturedRequest> & { url: string; method: string }): CapturedRequest {
  return { ...init };
}

function findingsFor(
  requests: CapturedRequest[],
  endpoints: PlannedApiEndpoint[] = ENDPOINTS,
  mocks: MockResponse[] = MOCKS,
): DiffFinding[] {
  return compareNetworkTraffic(requests, endpoints, mocks, ANCHOR);
}

/** Both endpoints exercised exactly per spec (mocked notes + unmocked items 501). */
function asSpecBaseline(): CapturedRequest[] {
  return [
    captured({
      url: `${BASE}/api/notes`,
      method: 'GET',
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ source: 'fixture', ok: true, notes: [{ id: 'n1', title: 'First note' }] }),
    }),
    captured({
      url: `${BASE}/api/items/42`,
      method: 'GET',
      status: 501,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ error: 'no mock response declared for endpoint', endpointId: ENDPOINTS[1]!.id }),
    }),
  ];
}

describe('pattern matching (codegen routing semantics)', () => {
  it('":id" matches exactly one non-empty segment', () => {
    expect(pathMatchesPattern('/api/items/:id', '/api/items/42')).toBe(true);
    expect(pathMatchesPattern('/api/items/:id', '/api/items/')).toBe(false);
    expect(pathMatchesPattern('/api/items/:id', '/api/items/42/x')).toBe(false);
    expect(pathMatchesPattern('/api/items/:id', '/api/items')).toBe(false);
  });

  it('literal segments must be equal; segment counts must match', () => {
    expect(pathMatchesPattern('/api/notes', '/api/notes')).toBe(true);
    expect(pathMatchesPattern('/api/notes', '/api/notes/')).toBe(false);
    expect(pathMatchesPattern('/api/notes', '/api/Notes')).toBe(false);
  });

  it('requestPathOf strips query + hash from absolute URLs', () => {
    expect(requestPathOf(`${BASE}/api/notes?x=1&y=2`)).toBe('/api/notes');
    expect(requestPathOf(`${BASE}/features.html#main`)).toBe('/features.html');
  });

  it('jsonDeepEqual is structural for parsed JSON values', () => {
    expect(jsonDeepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(jsonDeepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(jsonDeepEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(jsonDeepEqual([1, 2], [2, 1])).toBe(false);
    expect(jsonDeepEqual(null, null)).toBe(true);
    expect(jsonDeepEqual(1, '1')).toBe(false);
  });
});

describe('as-spec traffic produces NO findings (the positive paths)', () => {
  it('matched + mocked with exact status and body → no finding', () => {
    expect(findingsFor(asSpecBaseline())).toEqual([]);
  });

  it('matched + mocked with bodyless mock and empty body → no finding', () => {
    const endpoints: PlannedApiEndpoint[] = [
      { ...ENDPOINTS[0]!, urlPattern: '/api/empty', id: `api_${UUID}0000000000a3` },
    ];
    const mocks: MockResponse[] = [
      { id: `mock_${UUID}0000000000m2`, endpointId: endpoints[0]!.id, statusCode: 204 },
    ];
    const findings = findingsFor(
      [captured({ url: `${BASE}/api/empty`, method: 'GET', status: 204, headers: {}, body: '' })],
      endpoints,
      mocks,
    );
    expect(findings).toEqual([]);
  });

  it('wrong method answered 405 → no finding', () => {
    const findings = findingsFor([
      ...asSpecBaseline(),
      captured({
        url: `${BASE}/api/notes`,
        method: 'POST',
        status: 405,
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ error: 'method not allowed', endpointId: ENDPOINTS[0]!.id, allowed: ['GET'] }),
      }),
    ]);
    expect(findings).toEqual([]);
  });

  it('unmatched path answered 404 → no finding (the as-spec unknown answer)', () => {
    const findings = findingsFor([
      ...asSpecBaseline(),
      captured({
        url: `${BASE}/api/unknown`,
        method: 'GET',
        status: 404,
        headers: { 'content-type': 'text/html; charset=utf-8' },
        body: '<!DOCTYPE html><html><body>404</body></html>',
      }),
    ]);
    expect(findings).toEqual([]);
  });

  it('non-API document/static traffic → info-grade only', () => {
    const findings = findingsFor([
      ...asSpecBaseline(),
      captured({ url: `${BASE}/`, method: 'GET', status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: '<html></html>' }),
      captured({ url: `${BASE}/assets/logo.svg`, method: 'GET', status: 200, headers: { 'content-type': 'image/svg+xml' } }),
      captured({ url: `${BASE}/styles.css`, method: 'GET', status: 200, headers: { 'content-type': 'text/css' }, resourceType: 'stylesheet' }),
    ]);
    expect(findings.length).toBe(3);
    for (const finding of findings) {
      expect(finding.severity).toBe('info');
      expect(finding.dimension).toBe('network');
      expect(finding.summary).toContain('no consequence established');
    }
  });
});

describe('spec violations produce findings with expected/actual', () => {
  it('mock status mismatch → major with expected/actual', () => {
    const findings = findingsFor([
      ...asSpecBaseline(),
      captured({ url: `${BASE}/api/notes`, method: 'GET', status: 500, headers: {}, body: JSON.stringify({ ok: true }) }),
    ]);
    expect(findings.length).toBe(1);
    const finding = findings[0]!;
    expect(finding.severity).toBe('major');
    expect(finding.summary).toContain('HTTP 500');
    expect((finding.expected as { statusCode: number }).statusCode).toBe(200);
    expect((finding.actual as { statusCode: number }).statusCode).toBe(500);
    expect(finding.anchors[0]?.sourceIds).toContain(ENDPOINTS[0]!.id);
  });

  it('mock body mismatch → major with both bodies', () => {
    const findings = findingsFor([
      ...asSpecBaseline(),
      captured({ url: `${BASE}/api/notes`, method: 'GET', status: 200, headers: {}, body: JSON.stringify({ ok: false }) }),
    ]);
    expect(findings.length).toBe(1);
    const finding = findings[0]!;
    expect(finding.severity).toBe('major');
    expect(jsonDeepEqual((finding.expected as { body: unknown }).body, MOCKS[0]!.bodyJson)).toBe(true);
    expect((finding.actual as { body: unknown }).body).toEqual({ ok: false });
  });

  it('mock body not JSON → major', () => {
    const findings = findingsFor([
      ...asSpecBaseline(),
      captured({ url: `${BASE}/api/notes`, method: 'GET', status: 200, headers: {}, body: 'not json at all' }),
    ]);
    expect(findings.length).toBe(1);
    expect(findings[0]!.severity).toBe('major');
    expect(findings[0]!.summary).toContain('non-JSON');
  });

  it('unmocked endpoint answered non-501 → major naming the spec', () => {
    const findings = findingsFor([
      ...asSpecBaseline(),
      captured({ url: `${BASE}/api/items/42`, method: 'GET', status: 200, headers: {}, body: JSON.stringify({ hello: 1 }) }),
    ]);
    expect(findings.length).toBe(1);
    const finding = findings[0]!;
    expect(finding.severity).toBe('major');
    expect((finding.expected as { statusCode: number }).statusCode).toBe(501);
    expect((finding.actual as { statusCode: number }).statusCode).toBe(200);
  });

  it('wrong method answered non-405 → major', () => {
    const findings = findingsFor([
      ...asSpecBaseline(),
      captured({ url: `${BASE}/api/notes`, method: 'DELETE', status: 200, headers: {}, body: '{}' }),
    ]);
    expect(findings.length).toBe(1);
    const finding = findings[0]!;
    expect(finding.severity).toBe('major');
    expect((finding.expected as { statusCode: number }).statusCode).toBe(405);
    expect((finding.actual as { statusCode: number }).statusCode).toBe(200);
  });

  it('unmatched 2xx on an API-shaped path → major (unplanned API surface)', () => {
    const findings = findingsFor([
      ...asSpecBaseline(),
      captured({ url: `${BASE}/api/sneaky`, method: 'GET', status: 200, headers: {}, body: '{"x":1}' }),
    ]);
    expect(findings.length).toBe(1);
    expect(findings[0]!.severity).toBe('major');
    expect(findings[0]!.summary).toContain('outside the plan');
  });

  it('unmatched non-404 error status → minor', () => {
    const findings = findingsFor([
      ...asSpecBaseline(),
      captured({ url: `${BASE}/elsewhere`, method: 'GET', status: 503, headers: {} }),
    ]);
    expect(findings.length).toBe(1);
    expect(findings[0]!.severity).toBe('minor');
  });

  it('request matched a planned pattern but failed without a response → major', () => {
    const findings = findingsFor([
      ...asSpecBaseline(),
      captured({ url: `${BASE}/api/notes`, method: 'GET', failure: 'net::ERR_CONNECTION_REFUSED' }),
    ]);
    expect(findings.length).toBe(1);
    const finding = findings[0]!;
    expect(finding.severity).toBe('major');
    expect(finding.summary).toContain('failed without a response');
    expect((finding.actual as { failure: string }).failure).toBe('net::ERR_CONNECTION_REFUSED');
  });

  it('unmatched failed request → minor', () => {
    const findings = findingsFor([
      ...asSpecBaseline(),
      captured({ url: `${BASE}/nowhere`, method: 'GET', failure: 'net::ERR_FAILED' }),
    ]);
    expect(findings.length).toBe(1);
    expect(findings[0]!.severity).toBe('minor');
  });
});

describe('honest observations', () => {
  it('planned endpoint never exercised → one info finding naming it', () => {
    const findings = findingsFor([
      captured({
        url: `${BASE}/api/notes`,
        method: 'GET',
        status: 200,
        headers: {},
        body: JSON.stringify(MOCKS[0]!.bodyJson),
      }),
    ]);
    expect(findings.length).toBe(1);
    const finding = findings[0]!;
    expect(finding.severity).toBe('info');
    expect(finding.summary).toContain('GET /api/items/:id');
    expect(finding.anchors[0]?.sourceIds).toContain(ENDPOINTS[1]!.id);
    expect((finding.expected as { exercised: boolean }).exercised).toBe(true);
    expect((finding.actual as { exercised: boolean }).exercised).toBe(false);
  });

  it('a wrong-method probe still counts as exercised (no never-exercised noise)', () => {
    const findings = findingsFor([
      ...asSpecBaseline().slice(0, 1), // notes per spec
      captured({ url: `${BASE}/api/items/42`, method: 'POST', status: 405, headers: {}, body: '{}' }),
    ]);
    expect(findings).toEqual([]);
  });

  it('query strings are ignored for matching', () => {
    const findings = findingsFor([
      captured({
        url: `${BASE}/api/notes?page=2`,
        method: 'GET',
        status: 200,
        headers: {},
        body: JSON.stringify(MOCKS[0]!.bodyJson),
      }),
    ]);
    expect(findings.length).toBe(1); // only the never-exercised items endpoint
    expect(findings[0]!.summary).toContain('/api/items/:id');
  });

  it('an endpoint-less plan api section is legal input (the b01 corpus case)', () => {
    const findings = findingsFor(
      [captured({ url: `${BASE}/`, method: 'GET', status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: '<html></html>' })],
      [],
      [],
    );
    expect(findings.length).toBe(1);
    expect(findings[0]!.severity).toBe('info');
  });
});
