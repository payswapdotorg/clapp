/**
 * CLAPP-041 test battery — the visual dimension's COMPARISON LOGIC
 * (synthetic PNGs, browser-independent, always runs).
 *
 * compareVisualPair is pinned against pixel-exact fixtures built with the
 * package's own zero-dep encoder: the byte-identity fast path, dimension
 * divergence, pixel delta + the documented 4×4 decomposition, tolerance,
 * severity policy (minor/info for pixels, critical ONLY for a lost
 * assert-visible postcondition region), the honest capture-unavailable
 * and undecodable-PNG degradations, and evidence-ref anchoring.
 *
 * The browser-gated battery (visual-browser.test.ts) proves the same
 * rules against REAL chromium screenshots of codegen candidates.
 */

import { describe, expect, it } from 'bun:test';
import { newEvidenceId, sha256Hex } from '@clapp/core';
import { encodePng, type RgbaImage } from '../src/png';
import {
  compareVisualPair,
  unavailableScreenshotAdapter,
  type ScreenshotCapture,
} from '../src/index';
import type { DiffAnchor, DiffSeverity } from '../src/diff-contract';

const ANCHOR: DiffAnchor = { stepIndex: 0, sourceIds: ['screen_fixture'] };

/** White image with a black block (the synthetic "content"). */
function imageWithBlock(
  width: number,
  height: number,
  block: { x: number; y: number; w: number; h: number } | null,
): RgbaImage {
  const rgba = new Uint8Array(width * height * 4).fill(255);
  if (block !== null) {
    for (let y = block.y; y < block.y + block.h; y += 1) {
      for (let x = block.x; x < block.x + block.w; x += 1) {
        const offset = (y * width + x) * 4;
        rgba[offset] = 0;
        rgba[offset + 1] = 0;
        rgba[offset + 2] = 0;
        rgba[offset + 3] = 255;
      }
    }
  }
  return { width, height, rgba };
}

function solidImage(width: number, height: number, pixel: [number, number, number, number]): RgbaImage {
  const rgba = new Uint8Array(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    rgba.set(pixel, index * 4);
  }
  return { width, height, rgba };
}

/** Builds a captured shot with a REAL EvidenceRef (sha256 of the PNG bytes). */
async function shot(
  side: 'left' | 'right',
  image: RgbaImage,
  url = 'http://127.0.0.1:4533/',
): Promise<ScreenshotCapture> {
  const png = encodePng(image);
  return {
    stepIndex: 0,
    side,
    url,
    status: 'captured',
    png,
    width: image.width,
    height: image.height,
    evidenceRef: { evidenceId: newEvidenceId(), kind: 'screenshot', sha256: await sha256Hex(png) },
  };
}

function severities(findings: { severity: DiffSeverity }[]): DiffSeverity[] {
  return findings.map((finding) => finding.severity);
}

describe('byte-identity fast path', () => {
  it('identical pixels (identical bytes) → no findings', async () => {
    const image = imageWithBlock(40, 40, { x: 5, y: 5, w: 10, h: 10 });
    const left = await shot('left', image);
    const right = await shot('right', image);
    expect(compareVisualPair(left, right, ANCHOR)).toEqual([]);
  });
});

describe('pixel divergence (equal dimensions)', () => {
  it('a moved block → one minor finding with delta ratio + 4x4 grid decomposition', async () => {
    const left = await shot('left', imageWithBlock(40, 40, { x: 5, y: 5, w: 10, h: 10 }));
    const right = await shot('right', imageWithBlock(40, 40, { x: 25, y: 25, w: 10, h: 10 }));
    const findings = compareVisualPair(left, right, ANCHOR);

    expect(findings.length).toBe(1);
    const finding = findings[0]!;
    expect(finding.dimension).toBe('visual');
    expect(finding.severity).toBe('minor');
    const actual = finding.actual as {
      pixelDeltaRatio: number;
      differingPixels: number;
      regionGridDeltas: number[];
      rowsWithDeltas: number;
      columnsWithDeltas: number;
    };
    expect(actual.differingPixels).toBe(200); // two disjoint 10x10 blocks
    expect(actual.pixelDeltaRatio).toBeCloseTo(200 / 1600, 6);
    expect(actual.regionGridDeltas.length).toBe(16);
    expect(actual.rowsWithDeltas).toBe(20);
    expect(actual.columnsWithDeltas).toBe(20);
    const expected = finding.expected as { pixelDeltaRatio: number; differingPixels: number };
    expect(expected.pixelDeltaRatio).toBe(0);
    expect(expected.differingPixels).toBe(0);
  });

  it('severity is caller-tunable to info (honest observation mode)', async () => {
    const left = await shot('left', solidImage(8, 8, [255, 0, 0, 255]));
    const right = await shot('right', solidImage(8, 8, [0, 0, 255, 255]));
    const findings = compareVisualPair(left, right, ANCHOR, { divergenceSeverity: 'info' });
    expect(findings.length).toBe(1);
    expect(findings[0]!.severity).toBe('info');
    const actual = findings[0]!.actual as { pixelDeltaRatio: number };
    expect(actual.pixelDeltaRatio).toBe(1); // every pixel differs
  });

  it('tolerance absorbs sub-threshold channel deltas', async () => {
    const left = await shot('left', solidImage(8, 8, [100, 100, 100, 255]));
    const right = await shot('right', solidImage(8, 8, [101, 100, 100, 255]));
    expect(compareVisualPair(left, right, ANCHOR, { tolerance: 1 })).toEqual([]);
    expect(compareVisualPair(left, right, ANCHOR).length).toBe(1); // exact by default
  });

  it('findings are fresh objects with fresh ids on every call (purity)', async () => {
    const left = await shot('left', solidImage(4, 4, [0, 0, 0, 255]));
    const right = await shot('right', solidImage(4, 4, [255, 255, 255, 255]));
    const first = compareVisualPair(left, right, ANCHOR);
    const second = compareVisualPair(left, right, ANCHOR);
    expect(first.length).toBe(1);
    expect(second.length).toBe(1);
    expect(first[0]!.id).not.toBe(second[0]!.id);
    expect(first[0]!.id).toMatch(/^diff_[0-9a-f-]{36}$/);
  });
});

describe('structural divergence (dimensions)', () => {
  it('unequal dimensions → one minor finding, pixel pass skipped honestly', async () => {
    const left = await shot('left', solidImage(40, 40, [0, 0, 0, 255]));
    const right = await shot('right', solidImage(41, 40, [0, 0, 0, 255]));
    const findings = compareVisualPair(left, right, ANCHOR);
    expect(findings.length).toBe(1);
    const finding = findings[0]!;
    expect(finding.severity).toBe('minor');
    expect(finding.summary).toContain('pixel comparison skipped');
    expect(finding.expected).toEqual({ width: 40, height: 40 });
    expect(finding.actual).toEqual({ width: 41, height: 40 });
  });
});

describe('honest degradations', () => {
  it('capture-unavailable sides → one info finding, no pixels judged', async () => {
    const adapter = unavailableScreenshotAdapter('test: no browser in this scenario');
    const left = await adapter.captureScreenshot(0, 'left', 'http://127.0.0.1:1/');
    const right = await adapter.captureScreenshot(0, 'right', 'http://127.0.0.1:1/');
    expect(left.status).toBe('capture-unavailable');
    expect('png' in left).toBe(false); // ABSENT, not null
    expect('evidenceRef' in left).toBe(false);
    expect(left.note).toContain('no browser');

    const findings = compareVisualPair(left, right, ANCHOR);
    expect(findings.length).toBe(1);
    expect(findings[0]!.severity).toBe('info');
    expect(findings[0]!.summary).toContain('visual comparison unavailable');
    expect(findings[0]!.summary).toContain('no pixels were judged');
    expect('expected' in findings[0]!).toBe(false);
    expect('actual' in findings[0]!).toBe(false);
  });

  it('undecodable PNG bytes → one info finding naming the codec error', async () => {
    const left = await shot('left', solidImage(8, 8, [0, 0, 0, 255]));
    const right: ScreenshotCapture = {
      stepIndex: 0,
      side: 'right',
      url: 'http://127.0.0.1:1/',
      status: 'captured',
      png: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), // corrupt capture
      evidenceRef: { evidenceId: newEvidenceId(), kind: 'screenshot', sha256: '0'.repeat(64) },
    };
    const findings = compareVisualPair(left, right, ANCHOR);
    expect(findings.length).toBe(1);
    expect(findings[0]!.severity).toBe('info');
    expect(findings[0]!.summary).toContain('could not be decoded');
  });
});

describe('postcondition regions (the only critical-grade visual case)', () => {
  it('left content + right blank → critical, citing both captures', async () => {
    // A realistic assert-visible region: the black block plus background
    // margin (text-like content is never uniform inside its bounding box).
    const left = await shot('left', imageWithBlock(60, 60, { x: 10, y: 10, w: 12, h: 12 }));
    const right = await shot('right', imageWithBlock(60, 60, null)); // content gone
    const region = { x: 5, y: 5, width: 22, height: 22 };

    const findings = compareVisualPair(left, right, ANCHOR, {
      postconditionRegions: [{ label: 'assert-visible hero-heading', region }],
    });

    expect(severities(findings)).toContain('critical');
    const critical = findings.find((finding) => finding.severity === 'critical')!;
    expect(critical.summary).toContain('assert-visible hero-heading');
    expect(critical.summary).toContain('uniformly blank');
    // The anchor cites BOTH sides' capture refs.
    expect(critical.anchors[0]?.leftEvidence?.evidenceId).toBe(left.evidenceRef!.evidenceId);
    expect(critical.anchors[0]?.rightEvidence?.evidenceId).toBe(right.evidenceRef!.evidenceId);
    // The pixel divergence is ALSO recorded (minor) — both facts stand.
    expect(severities(findings)).toContain('minor');
  });

  it('content preserved on the right → no critical even amid other pixel changes', async () => {
    const leftImage = imageWithBlock(60, 60, { x: 10, y: 10, w: 20, h: 20 });
    const left = await shot('left', leftImage);
    const rightImage = imageWithBlock(60, 60, { x: 10, y: 10, w: 20, h: 20 });
    rightImage.rgba.set([255, 0, 0, 255], (50 * 60 + 50) * 4); // one stray pixel far from the region
    const rightWithStray = await shot('right', rightImage);

    const findings = compareVisualPair(left, rightWithStray, ANCHOR, {
      postconditionRegions: [{ label: 'assert-visible hero-heading', region: { x: 5, y: 5, width: 30, height: 30 } }],
    });
    expect(severities(findings)).not.toContain('critical');
    expect(severities(findings)).toContain('minor'); // the stray pixel
  });

  it('a blank LEFT region proves nothing → honestly skipped (no finding for it)', async () => {
    const leftImage = solidImage(40, 40, [255, 255, 255, 255]);
    const rightImage = solidImage(40, 40, [255, 255, 255, 255]);
    rightImage.rgba.set([0, 0, 0, 255], (20 * 40 + 20) * 4); // content only on the RIGHT
    const left = await shot('left', leftImage);
    const right = await shot('right', rightImage);

    const findings = compareVisualPair(left, right, ANCHOR, {
      postconditionRegions: [{ label: 'assert-visible ghost', region: { x: 0, y: 0, width: 40, height: 40 } }],
    });
    expect(severities(findings)).not.toContain('critical');
    expect(findings.length).toBe(1); // just the pixel divergence
  });

  it('a region beyond a SHORTER right image → critical (content missing entirely)', async () => {
    // Left: tall image with content near the bottom; right: shorter page
    // that ends before the region — the footer-copyright scenario.
    const leftImage = imageWithBlock(60, 60, { x: 50, y: 50, w: 8, h: 8 });
    const rightImage = solidImage(60, 40, [255, 255, 255, 255]);
    const left = await shot('left', leftImage);
    const right = await shot('right', rightImage);

    const findings = compareVisualPair(left, right, ANCHOR, {
      postconditionRegions: [{ label: 'assert-visible footer-copyright', region: { x: 45, y: 45, width: 14, height: 14 } }],
    });
    const critical = findings.find((finding) => finding.severity === 'critical');
    expect(critical).toBeDefined();
    expect(critical!.summary).toContain('missing entirely on the right');
    expect(critical!.summary).toContain('assert-visible footer-copyright');
    // The dimension mismatch is ALSO recorded (both facts stand).
    expect(findings.some((finding) => finding.severity === 'minor')).toBe(true);
  });

  it('a region outside the screenshot bounds → info finding (cannot verify)', async () => {
    const left = await shot('left', solidImage(40, 40, [255, 255, 255, 255]));
    const right = await shot('right', solidImage(40, 40, [255, 255, 255, 255]));
    const findings = compareVisualPair(left, right, ANCHOR, {
      postconditionRegions: [{ label: 'assert-visible elsewhere', region: { x: 100, y: 100, width: 5, height: 5 } }],
    });
    expect(findings.length).toBe(1);
    expect(findings[0]!.severity).toBe('info');
    expect(findings[0]!.summary).toContain('outside the screenshot bounds');
  });

  it('byte-identical pair with NO regions → no findings at all (fast path)', async () => {
    const left = await shot('left', solidImage(40, 40, [12, 34, 56, 255]));
    const right = await shot('right', solidImage(40, 40, [12, 34, 56, 255]));
    expect(compareVisualPair(left, right, ANCHOR)).toEqual([]);
  });
});
