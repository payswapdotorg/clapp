/**
 * CLAPP-041 test battery — FINDING-SHAPE CONFORMANCE (always runs).
 *
 * Every DiffFinding this package can produce must conform to the
 * diff-contract v0.1 MIRROR types: "diff_"-prefixed uuid v4 ids,
 * dimension/severity drawn from the closed unions, non-empty anchors,
 * and absent optional fields ABSENT — never null. This battery validates
 * findings from BOTH dimensions (network rule matrix + visual synthetic
 * matrix) through one structural validator written against the mirror.
 */

import { describe, expect, it } from 'bun:test';
import { newEvidenceId, sha256Hex } from '@clapp/core';
import type { EvidenceRef } from '@clapp/core';
import type { MockResponse, PlannedApiEndpoint } from '@clapp/plan';
import {
  DIFFEXT_ADAPTER_INFO,
  DIFF_VERSION,
  compareNetworkTraffic,
  compareVisualPair,
  encodePng,
  unavailableScreenshotAdapter,
  type CapturedRequest,
  type DiffAnchor,
  type DiffFinding,
  type DiffDimension,
  type DiffSeverity,
  type ScreenshotCapture,
} from '../src/index';

const UUID = '00000000-0000-4000-8000-';

// ---------------------------------------------------------------------------
// The structural validator (written against the MIRROR unions)
// ---------------------------------------------------------------------------

const DIMENSIONS: readonly DiffDimension[] = ['semantic', 'visual', 'network', 'state'];
const SEVERITIES: readonly DiffSeverity[] = ['critical', 'major', 'minor', 'info'];
const EVIDENCE_KINDS: readonly string[] = [
  'dom', 'runtime', 'network', 'storage', 'screenshot', 'static', 'user',
];

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function validateEvidenceRef(ref: unknown, path: string): string[] {
  const errors: string[] = [];
  if (typeof ref !== 'object' || ref === null) {
    return [`${path}: not an object`];
  }
  const record = ref as Record<string, unknown>;
  if (typeof record['evidenceId'] !== 'string' || !record['evidenceId'].startsWith('ev_')) {
    errors.push(`${path}.evidenceId: expected an "ev_"-prefixed string`);
  }
  if (typeof record['kind'] !== 'string' || !EVIDENCE_KINDS.includes(record['kind'])) {
    errors.push(`${path}.kind: not in the EvidenceKind union`);
  }
  if (typeof record['sha256'] !== 'string' || !/^[0-9a-f]{64}$/.test(record['sha256'])) {
    errors.push(`${path}.sha256: expected 64 lowercase hex chars`);
  }
  return errors;
}

/** Validates one finding against the mirror shape; returns violation messages. */
export function validateDiffFinding(finding: unknown): string[] {
  const errors: string[] = [];
  if (typeof finding !== 'object' || finding === null) {
    return ['finding: not an object'];
  }
  const record = finding as Record<string, unknown>;

  if (typeof record['id'] !== 'string' || !record['id'].startsWith('diff_')) {
    errors.push('id: expected a "diff_"-prefixed string');
  } else if (!UUID_V4.test(record['id'].slice('diff_'.length))) {
    errors.push('id: the suffix is not a uuid v4');
  }
  if (typeof record['dimension'] !== 'string' || !DIMENSIONS.includes(record['dimension'] as DiffDimension)) {
    errors.push('dimension: not in the closed DiffDimension union');
  }
  if (typeof record['severity'] !== 'string' || !SEVERITIES.includes(record['severity'] as DiffSeverity)) {
    errors.push('severity: not in the closed DiffSeverity union');
  }
  if (typeof record['summary'] !== 'string' || record['summary'].length === 0) {
    errors.push('summary: expected a non-empty string');
  }

  // Optional fields are ABSENT or present — never null.
  for (const key of ['expected', 'actual'] as const) {
    const value = record[key];
    if (value === null) {
      errors.push(`${key}: null is not a valid absence — omit the field`);
    }
  }

  if (!Array.isArray(record['anchors']) || (record['anchors'] as unknown[]).length === 0) {
    errors.push('anchors: expected a NON-EMPTY array');
    return errors;
  }
  for (const [index, anchor] of (record['anchors'] as unknown[]).entries()) {
    const path = `anchors[${index}]`;
    if (typeof anchor !== 'object' || anchor === null) {
      errors.push(`${path}: not an object`);
      continue;
    }
    const anchorRecord = anchor as Record<string, unknown>;
    if (typeof anchorRecord['stepIndex'] !== 'number') {
      errors.push(`${path}.stepIndex: expected a number`);
    }
    if (!Array.isArray(anchorRecord['sourceIds']) || (anchorRecord['sourceIds'] as unknown[]).some((id) => typeof id !== 'string')) {
      errors.push(`${path}.sourceIds: expected string[]`);
    }
    for (const key of ['leftEvidence', 'rightEvidence'] as const) {
      const value = anchorRecord[key];
      if (value === undefined) {
        continue; // absent is valid
      }
      if (value === null) {
        errors.push(`${path}.${key}: null is not a valid absence — omit the field`);
        continue;
      }
      errors.push(...validateEvidenceRef(value, `${path}.${key}`));
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Finding sources: BOTH dimensions, every branch
// ---------------------------------------------------------------------------

const ENDPOINTS: PlannedApiEndpoint[] = [
  {
    id: `api_${UUID}0000000000a1`,
    method: 'GET',
    urlPattern: '/api/notes',
    sourceOperationIds: [],
    provenance: { level: 'planned', rationale: 'fixture', sourceIds: [], evidenceRefs: [] },
  },
  {
    id: `api_${UUID}0000000000a2`,
    method: 'GET',
    urlPattern: '/api/items/:id',
    sourceOperationIds: [],
    provenance: { level: 'planned', rationale: 'fixture', sourceIds: [], evidenceRefs: [] },
  },
];

const MOCKS: MockResponse[] = [
  { id: `mock_${UUID}0000000000m1`, endpointId: ENDPOINTS[0]!.id, statusCode: 200, bodyJson: { ok: true } },
];

const ANCHOR: DiffAnchor = { stepIndex: 0, sourceIds: [`appsyn_${UUID}0000000000d1`] };

function networkFindings(): DiffFinding[] {
  const base = 'http://127.0.0.1:4533';
  const traffic: CapturedRequest[] = [
    // as-spec baseline
    { url: `${base}/api/notes`, method: 'GET', status: 200, headers: {}, body: '{"ok":true}' },
    { url: `${base}/api/items/7`, method: 'GET', status: 501, headers: {}, body: JSON.stringify({ error: 'no mock response declared for endpoint', endpointId: ENDPOINTS[1]!.id }) },
    // every violation branch
    { url: `${base}/api/notes`, method: 'GET', status: 500, headers: {}, body: '{"ok":true}' },
    { url: `${base}/api/notes`, method: 'GET', status: 200, headers: {}, body: '{"ok":false}' },
    { url: `${base}/api/notes`, method: 'GET', status: 200, headers: {}, body: 'nope' },
    { url: `${base}/api/items/7`, method: 'GET', status: 200, headers: {}, body: '{}' },
    { url: `${base}/api/notes`, method: 'PUT', status: 200, headers: {}, body: '{}' },
    { url: `${base}/api/rogue`, method: 'GET', status: 200, headers: {}, body: '{}' },
    { url: `${base}/page.html`, method: 'GET', status: 200, headers: { 'content-type': 'text/html' } },
    { url: `${base}/broken`, method: 'GET', status: 503, headers: {} },
    { url: `${base}/api/notes`, method: 'GET', failure: 'net::ERR_FAILED' },
    { url: `${base}/lost`, method: 'GET', failure: 'net::ERR_NAME_NOT_RESOLVED' },
    { url: `${base}/unknown`, method: 'GET', status: 404, headers: {} },
  ];
  return compareNetworkTraffic(traffic, ENDPOINTS, MOCKS, ANCHOR);
}

async function visualFindings(): Promise<DiffFinding[]> {
  const width = 24;
  const height = 24;
  /** White image with an optional black block (content in a region). */
  const imageWithBlock = (block: { x: number; y: number; w: number; h: number } | null): Uint8Array => {
    const rgba = new Uint8Array(width * height * 4).fill(255);
    if (block !== null) {
      for (let y = block.y; y < block.y + block.h; y += 1) {
        for (let x = block.x; x < block.x + block.w; x += 1) {
          rgba.set([0, 0, 0, 255], (y * width + x) * 4);
        }
      }
    }
    return encodePng({ width, height, rgba });
  };

  const shot = async (side: 'left' | 'right', png: Uint8Array): Promise<ScreenshotCapture> => {
    return {
      stepIndex: 0,
      side,
      url: 'http://127.0.0.1:4533/',
      status: 'captured',
      png,
      evidenceRef: { evidenceId: newEvidenceId(), kind: 'screenshot', sha256: await sha256Hex(png) },
    };
  };

  const left = await shot('left', imageWithBlock({ x: 4, y: 4, w: 12, h: 12 }));
  const right = await shot('right', imageWithBlock(null)); // content gone
  const evidenceLeft: EvidenceRef = {
    evidenceId: `ev_${UUID}0000000000e1`,
    kind: 'screenshot',
    sha256: '1'.repeat(64),
  };
  const evidenceRight: EvidenceRef = {
    evidenceId: `ev_${UUID}0000000000e2`,
    kind: 'screenshot',
    sha256: '2'.repeat(64),
  };

  const pixelBranch = compareVisualPair(left, right, { ...ANCHOR, leftEvidence: evidenceLeft, rightEvidence: evidenceRight });
  // The region includes background margin around the block (realistic
  // assert-visible bounding boxes are never uniform).
  const criticalBranch = compareVisualPair(left, right, ANCHOR, {
    postconditionRegions: [{ label: 'assert-visible fixture', region: { x: 2, y: 2, width: 16, height: 16 } }],
  });
  const outOfBoundsBranch = compareVisualPair(left, right, ANCHOR, {
    postconditionRegions: [{ label: 'assert-visible gone', region: { x: 999, y: 999, width: 4, height: 4 } }],
  });

  const unavailable = await unavailableScreenshotAdapter('shape fixture: no browser').captureScreenshot(0, 'left', 'http://127.0.0.1:1/');
  const unavailableBranch = compareVisualPair(unavailable, unavailable, ANCHOR);

  const dimensionBranch = compareVisualPair(
    await shot('left', imageWithBlock(null)),
    await shot('right', encodePng({ width: 12, height: 24, rgba: new Uint8Array(12 * 24 * 4).fill(255) })),
    ANCHOR,
  );

  const undecodable: ScreenshotCapture = {
    stepIndex: 0,
    side: 'right',
    url: 'http://127.0.0.1:4533/',
    status: 'captured',
    png: new Uint8Array(16),
  };
  const decodeBranch = compareVisualPair(left, undecodable, ANCHOR);

  return [
    ...pixelBranch,
    ...criticalBranch,
    ...outOfBoundsBranch,
    ...unavailableBranch,
    ...dimensionBranch,
    ...decodeBranch,
  ];
}

// ---------------------------------------------------------------------------
// The conformance battery
// ---------------------------------------------------------------------------

describe('finding-shape conformance against the mirror types', () => {
  it('every NETWORK finding validates (all rule branches)', () => {
    const findings = networkFindings();
    expect(findings.length).toBeGreaterThanOrEqual(10); // the matrix is non-vacuous
    for (const finding of findings) {
      const errors = validateDiffFinding(finding);
      expect(errors).toEqual([]); // failure message = the exact violations
    }
    expect(findings.every((finding) => finding.dimension === 'network')).toBe(true);
  });

  it('every VISUAL finding validates (all rule branches)', async () => {
    const findings = await visualFindings();
    expect(findings.length).toBeGreaterThanOrEqual(4); // pixel, critical, dimension, decode/unavailable
    for (const finding of findings) {
      const errors = validateDiffFinding(finding);
      expect(errors).toEqual([]);
    }
    expect(findings.every((finding) => finding.dimension === 'visual')).toBe(true);
  });

  it('severities observed across the matrix span minor/info/major/critical honestly', async () => {
    const findings = [...networkFindings(), ...(await visualFindings())];
    const observed = new Set(findings.map((finding) => finding.severity));
    expect(observed.has('major')).toBe(true);
    expect(observed.has('minor')).toBe(true);
    expect(observed.has('info')).toBe(true);
    expect(observed.has('critical')).toBe(true);
  });

  it('the mirror is re-exported from the public surface with its version', () => {
    expect(DIFF_VERSION).toBe('0.1');
    expect(DIFFEXT_ADAPTER_INFO.adapterId).toBe('@clapp/diffext');
    expect(DIFFEXT_ADAPTER_INFO.diffVersion).toBe(DIFF_VERSION);
    expect([...DIFFEXT_ADAPTER_INFO.dimensions]).toEqual(['visual', 'network']);
  });

  it('anchors carry both capture refs when both sides cite evidence', async () => {
    const findings = await visualFindings();
    const pixel = findings.find((finding) => finding.severity === 'minor' && finding.dimension === 'visual' && finding.expected !== undefined);
    expect(pixel).toBeDefined();
    expect(pixel!.anchors[0]?.leftEvidence?.sha256).toBe('1'.repeat(64));
    expect(pixel!.anchors[0]?.rightEvidence?.sha256).toBe('2'.repeat(64));
  });
});
