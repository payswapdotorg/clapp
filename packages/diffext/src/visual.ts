/**
 * @clapp/diffext — the VISUAL diff dimension (CLAPP-041).
 *
 * Compares a SCREENSHOT PAIR (left vs right capture of the same journey
 * step) and produces 'visual' DiffFindings per the differential
 * verification contract v0.1 mirror (./diff-contract.ts).
 *
 * COMPARISON PATH (all zero-dependency, deterministic):
 * 1. byte-identity fast path — identical PNG bytes are identical pixels;
 *    no finding, done (this is the determinism control's happy path).
 * 2. decode both PNGs with the local codec (./png.ts — node:zlib, no npm
 *    image library; documented color types, 8-bit, non-interlaced).
 * 3. structural comparison — image dimensions; unequal dimensions are a
 *    'minor' finding (capture asymmetry: viewport or page height), and
 *    the pixel pass is SKIPPED honestly (the summary says so) rather
 *    than rescaled (rescaling would fabricate evidence). Postcondition
 *    regions (step 5) still run across mismatched dimensions: HTML
 *    documents render top-anchored, so left-coordinate rectangles stay
 *    meaningful.
 * 4. pixel comparison — the DOCUMENTED DECOMPOSITION is a 4×4 region
 *    grid (per-cell differing-pixel ratio) plus row/column delta
 *    summaries (how many rows/columns carry at least one differing
 *    pixel, and where the busiest row/column sits), all embedded in the
 *    finding's `actual` for machine checking; the headline number is the
 *    pixel delta ratio (differing pixels ÷ total pixels, tolerance 0 by
 *    default — every channel must match exactly).
 * 5. postcondition regions — the caller may declare assert-visible
 *    regions (pixel rectangles in LEFT coordinates, e.g. from an element
 *    bounding box captured at screenshot time). A region that carries
 *    content on the left contradicts the journey postcondition when the
 *    right side cannot show it — the region is uniformly blank there, OR
 *    the right image ends before the region (content missing entirely)
 *    → 'critical' (the contract's only critical-grade visual case). A
 *    blank LEFT region proves nothing and is honestly skipped; WHICH
 *    element vanished or moved is the semantic dimension's concern.
 *
 * SEVERITY HONESTY (binding, from the packet): visual-only divergences
 * are 'minor' or 'info' UNLESS a journey postcondition is contradicted
 * (then 'critical'). Pixel divergence defaults to 'minor' (cosmetic,
 * consequence unestablished); pass divergenceSeverity: 'info' to record
 * observations more softly. Capture-unavailable sides and undecodable
 * PNGs are 'info' — they are verification gaps, not divergences.
 */

import type { DiffAnchor, DiffFinding, DiffSeverity } from './diff-contract';
import { newDiffFindingId } from './ids';
import { bytesEqual, decodePng, PngError, type RgbaImage } from './png';
import type { ScreenshotCapture } from './capture';

// ---------------------------------------------------------------------------
// Options + region vocabulary
// ---------------------------------------------------------------------------

/** A pixel rectangle (LEFT-screenshot coordinates, 0-based, inclusive start). */
export interface PixelRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * One assert-visible postcondition region: "this area of the left
 * screenshot proves target X was visible; it must not be blank on the
 * right". Regions come from the caller (e.g. element bounding boxes).
 */
export interface PostconditionRegion {
  /** What the region proves, e.g. 'assert-visible hero-heading'. */
  label: string;
  region: PixelRegion;
}

export interface VisualComparisonOptions {
  /**
   * Per-channel tolerance: pixels whose maximum channel delta is ≤ this
   * count as equal (default 0 — exact match; antialiasing-tolerant
   * callers may raise it).
   */
  tolerance?: number;
  /** Assert-visible regions in left-image pixel coordinates. */
  postconditionRegions?: PostconditionRegion[];
  /** Severity for plain pixel divergence (default 'minor'). */
  divergenceSeverity?: 'minor' | 'info';
}

/** Content-detection threshold: min per-channel spread inside a region that counts as content. */
const CONTENT_SPREAD_THRESHOLD = 8;

/** The region grid decomposition is 4×4 (documented; see module doc). */
const GRID_CELLS = 4;

// ---------------------------------------------------------------------------
// Finding construction
// ---------------------------------------------------------------------------

interface VisualFindingInput {
  severity: DiffSeverity;
  summary: string;
  anchor: DiffAnchor;
  expected?: unknown;
  actual?: unknown;
}

function makeVisualFinding(input: VisualFindingInput): DiffFinding {
  const finding: DiffFinding = {
    id: newDiffFindingId(),
    dimension: 'visual',
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

/** Merges the caller's anchor with the shots' evidence refs (capture-proven findings). */
function anchorWithCaptures(
  anchor: DiffAnchor,
  left: ScreenshotCapture,
  right: ScreenshotCapture,
): DiffAnchor {
  return {
    ...anchor,
    ...(anchor.leftEvidence === undefined && left.evidenceRef !== undefined
      ? { leftEvidence: left.evidenceRef }
      : {}),
    ...(anchor.rightEvidence === undefined && right.evidenceRef !== undefined
      ? { rightEvidence: right.evidenceRef }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// Pixel math
// ---------------------------------------------------------------------------

interface PixelDelta {
  differingPixels: number;
  totalPixels: number;
  deltaRatio: number;
  /** 4×4 per-cell differing-pixel ratio (row-major). */
  gridDeltas: number[];
  rowsWithDeltas: number;
  columnsWithDeltas: number;
  /** Row/column index with the most differing pixels (-1 when none). */
  busiestRow: number;
  busiestColumn: number;
}

function pixelDelta(
  left: RgbaImage,
  right: RgbaImage,
  tolerance: number,
): PixelDelta {
  const { width, height } = left;
  const totalPixels = width * height;
  let differingPixels = 0;
  const cellDiffering = new Array<number>(GRID_CELLS * GRID_CELLS).fill(0);
  const cellTotals = new Array<number>(GRID_CELLS * GRID_CELLS).fill(0);
  const rowDiffering = new Array<number>(height).fill(0);
  const columnDiffering = new Array<number>(width).fill(0);
  let busiestRow = -1;
  let busiestColumn = -1;

  for (let y = 0; y < height; y += 1) {
    const cellRow = Math.min(Math.floor((y / height) * GRID_CELLS), GRID_CELLS - 1);
    for (let x = 0; x < width; x += 1) {
      const cellColumn = Math.min(Math.floor((x / width) * GRID_CELLS), GRID_CELLS - 1);
      const cell = cellRow * GRID_CELLS + cellColumn;
      cellTotals[cell] = (cellTotals[cell] ?? 0) + 1;
      const offset = (y * width + x) * 4;
      let maxChannelDelta = 0;
      for (let channel = 0; channel < 4; channel += 1) {
        const delta = Math.abs(left.rgba[offset + channel]! - right.rgba[offset + channel]!);
        if (delta > maxChannelDelta) {
          maxChannelDelta = delta;
        }
      }
      if (maxChannelDelta > tolerance) {
        differingPixels += 1;
        cellDiffering[cell] = (cellDiffering[cell] ?? 0) + 1;
        rowDiffering[y] = (rowDiffering[y] ?? 0) + 1;
        columnDiffering[x] = (columnDiffering[x] ?? 0) + 1;
      }
    }
  }
  for (let y = 0; y < height; y += 1) {
    if ((rowDiffering[y] ?? 0) > 0 && (busiestRow === -1 || (rowDiffering[y] ?? 0) > (rowDiffering[busiestRow] ?? 0))) {
      busiestRow = y;
    }
  }
  for (let x = 0; x < width; x += 1) {
    if ((columnDiffering[x] ?? 0) > 0 && (busiestColumn === -1 || (columnDiffering[x] ?? 0) > (columnDiffering[busiestColumn] ?? 0))) {
      busiestColumn = x;
    }
  }

  return {
    differingPixels,
    totalPixels,
    deltaRatio: totalPixels === 0 ? 0 : differingPixels / totalPixels,
    gridDeltas: cellDiffering.map((count, index) => {
      const total = cellTotals[index] ?? 1;
      return count / total;
    }),
    rowsWithDeltas: rowDiffering.filter((count) => count > 0).length,
    columnsWithDeltas: columnDiffering.filter((count) => count > 0).length,
    busiestRow,
    busiestColumn,
  };
}

/** Clips a region to image bounds; returns null when nothing remains. */
function clipRegion(region: PixelRegion, image: RgbaImage): PixelRegion | null {
  const x0 = Math.max(0, Math.floor(region.x));
  const y0 = Math.max(0, Math.floor(region.y));
  const x1 = Math.min(image.width, Math.ceil(region.x + region.width));
  const y1 = Math.min(image.height, Math.ceil(region.y + region.height));
  if (x1 <= x0 || y1 <= y0) {
    return null;
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** Min→max channel spread inside a region (0 = perfectly uniform). */
function regionSpread(image: RgbaImage, region: PixelRegion): number {
  const mins = [255, 255, 255, 255];
  const maxs = [0, 0, 0, 0];
  for (let y = region.y; y < region.y + region.height; y += 1) {
    for (let x = region.x; x < region.x + region.width; x += 1) {
      const offset = (y * image.width + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        const value = image.rgba[offset + channel]!;
        if (value < (mins[channel] ?? 255)) {
          mins[channel] = value;
        }
        if (value > (maxs[channel] ?? 0)) {
          maxs[channel] = value;
        }
      }
    }
  }
  let spread = 0;
  for (let channel = 0; channel < 4; channel += 1) {
    const delta = (maxs[channel] ?? 0) - (mins[channel] ?? 255);
    if (delta > spread) {
      spread = delta;
    }
  }
  return spread;
}

// ---------------------------------------------------------------------------
// The comparison
// ---------------------------------------------------------------------------

/**
 * Compares a screenshot pair into 'visual' DiffFindings. Pure and
 * synchronous; every finding cites both sides' capture refs (when the
 * captures carry them) via the anchor.
 */
export function compareVisualPair(
  left: ScreenshotCapture,
  right: ScreenshotCapture,
  anchor: DiffAnchor,
  options: VisualComparisonOptions = {},
): DiffFinding[] {
  const tolerance = options.tolerance ?? 0;
  const divergenceSeverity = options.divergenceSeverity ?? 'minor';
  const findings: DiffFinding[] = [];
  const fullAnchor = anchorWithCaptures(anchor, left, right);

  // 1. Honesty gate: unavailable captures are verification gaps, not divergences.
  const unavailableNotes: string[] = [];
  if (left.status !== 'captured' || left.png === undefined) {
    unavailableNotes.push(`left: ${left.note ?? 'capture unavailable'}`);
  }
  if (right.status !== 'captured' || right.png === undefined) {
    unavailableNotes.push(`right: ${right.note ?? 'capture unavailable'}`);
  }
  if (unavailableNotes.length > 0) {
    findings.push(
      makeVisualFinding({
        severity: 'info',
        summary: `visual comparison unavailable for step ${left.stepIndex} (${unavailableNotes.join('; ')}) — no pixels were judged`,
        anchor: fullAnchor,
      }),
    );
    return findings;
  }

  // 2. Byte-identity fast path: identical bytes are identical pixels, so
  //    no divergence is possible — but postcondition regions were still
  //    REQUESTED: an out-of-bounds region is a caller configuration
  //    error worth reporting even against identical captures.
  const leftPng = left.png;
  const rightPng = right.png;
  if (leftPng === undefined || rightPng === undefined) {
    return findings; // unreachable (checked above); kept for the type checker
  }
  const byteIdentical = bytesEqual(leftPng, rightPng);
  const postconditionRegions = options.postconditionRegions ?? [];
  if (byteIdentical && postconditionRegions.length === 0) {
    return findings;
  }

  // 3. Decode both sides.
  let leftImage: RgbaImage;
  let rightImage: RgbaImage;
  try {
    leftImage = decodePng(leftPng);
    rightImage = decodePng(rightPng);
  } catch (error) {
    findings.push(
      makeVisualFinding({
        severity: 'info',
        summary: `screenshot pair could not be decoded for pixel comparison (${error instanceof PngError ? error.message : String(error)}) — no pixels were judged`,
        anchor: fullAnchor,
      }),
    );
    return findings;
  }

  if (byteIdentical) {
    // Identical pixels: only the region BOUNDS can still be wrong.
    for (const postcondition of postconditionRegions) {
      if (
        clipRegion(postcondition.region, leftImage) === null ||
        clipRegion(postcondition.region, rightImage) === null
      ) {
        findings.push(
          makeVisualFinding({
            severity: 'info',
            summary: `postcondition region "${postcondition.label}" lies outside the screenshot bounds — cannot verify`,
            anchor: fullAnchor,
            expected: { region: postcondition.region, insideBounds: true },
            actual: { region: postcondition.region, insideBounds: false, dimensions: { width: leftImage.width, height: leftImage.height } },
          }),
        );
      }
    }
    return findings;
  }

  // 4. Structural comparison: dimensions. Unequal dimensions are a
  //    capture asymmetry (minor); the pixel-delta pass is SKIPPED
  //    honestly (the summary says so) rather than rescaled — but
  //    postcondition regions still run below: HTML documents render
  //    top-anchored, so left-coordinate rectangles stay meaningful.
  const dimensionsMatch =
    leftImage.width === rightImage.width && leftImage.height === rightImage.height;
  if (!dimensionsMatch) {
    findings.push(
      makeVisualFinding({
        severity: 'minor',
        summary: `screenshot dimensions differ (left ${leftImage.width}x${leftImage.height}, right ${rightImage.width}x${rightImage.height}) — pixel comparison skipped, nothing was rescaled`,
        anchor: fullAnchor,
        expected: { width: leftImage.width, height: leftImage.height },
        actual: { width: rightImage.width, height: rightImage.height },
      }),
    );
  } else {
    // 5. Pixel comparison + documented decomposition.
    const delta = pixelDelta(leftImage, rightImage, tolerance);
    if (delta.differingPixels > 0) {
      findings.push(
        makeVisualFinding({
          severity: divergenceSeverity,
          summary: `visual divergence: ${delta.differingPixels} of ${delta.totalPixels} pixels differ (delta ratio ${(delta.deltaRatio * 100).toFixed(3)}%) between the left and right screenshots of ${left.url}`,
          anchor: fullAnchor,
          expected: {
            pixelDeltaRatio: 0,
            differingPixels: 0,
            dimensions: { width: leftImage.width, height: leftImage.height },
          },
          actual: {
            pixelDeltaRatio: Number(delta.deltaRatio.toFixed(6)),
            differingPixels: delta.differingPixels,
            dimensions: { width: leftImage.width, height: leftImage.height },
            regionGrid: `${GRID_CELLS}x${GRID_CELLS} differing-pixel ratios (row-major)`,
            regionGridDeltas: delta.gridDeltas.map((value) => Number(value.toFixed(6))),
            rowsWithDeltas: delta.rowsWithDeltas,
            columnsWithDeltas: delta.columnsWithDeltas,
            busiestRow: delta.busiestRow,
            busiestColumn: delta.busiestColumn,
          },
        }),
      );
    }
  }

  // 6. Postcondition regions: content lost on the right is 'critical'.
  //    Semantics (documented): a postcondition region is a caller-declared
  //    assert-visible target in LEFT coordinates. A region that carries
  //    content on the left is CONTRADICTED when the right image cannot
  //    show it — either the region lies beyond the right image's bounds
  //    (the page ends before the target's position: the content is
  //    missing entirely) or the region is uniformly blank there. A blank
  //    LEFT region proves nothing and is honestly skipped. Which element
  //    vanished or moved is the semantic dimension's concern (CLAPP-040).
  for (const postcondition of postconditionRegions) {
    const leftRegion = clipRegion(postcondition.region, leftImage);
    if (leftRegion === null) {
      findings.push(
        makeVisualFinding({
          severity: 'info',
          summary: `postcondition region "${postcondition.label}" lies outside the LEFT screenshot bounds — cannot verify`,
          anchor: fullAnchor,
          expected: { region: postcondition.region, insideBounds: true },
          actual: { region: postcondition.region, insideBounds: false, dimensions: { width: leftImage.width, height: leftImage.height } },
        }),
      );
      continue;
    }
    const leftSpread = regionSpread(leftImage, leftRegion);
    if (leftSpread <= CONTENT_SPREAD_THRESHOLD) {
      // A blank left region proves nothing — honestly skipped.
      continue;
    }
    const rightRegion = clipRegion(postcondition.region, rightImage);
    if (rightRegion === null) {
      findings.push(
        makeVisualFinding({
          severity: 'critical',
          summary: `assert-visible postcondition region "${postcondition.label}" lost: the left region carries content, and the right screenshot does not even reach the region (its page is shorter) — the content is missing entirely on the right`,
          anchor: fullAnchor,
          expected: { region: postcondition.region, leftContentSpread: leftSpread, rightRegion: 'within bounds' },
          actual: { region: postcondition.region, rightRegion: 'beyond the right image', rightHeight: rightImage.height },
        }),
      );
      continue;
    }
    const rightSpread = regionSpread(rightImage, rightRegion);
    if (rightSpread <= CONTENT_SPREAD_THRESHOLD) {
      findings.push(
        makeVisualFinding({
          severity: 'critical',
          summary: `assert-visible postcondition region "${postcondition.label}" lost: the left region carries content but the right region is uniformly blank`,
          anchor: fullAnchor,
          expected: { region: postcondition.region, leftContentSpread: leftSpread, rightContentSpread: 'content present' },
          actual: { region: postcondition.region, rightContentSpread: rightSpread, rightRegionBlank: true },
        }),
      );
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// In-browser canvas cross-check (optional parity path)
// ---------------------------------------------------------------------------

/** Result of the in-browser canvas pixel comparison. */
export interface InBrowserPixelComparison {
  leftWidth: number;
  leftHeight: number;
  rightWidth: number;
  rightHeight: number;
  differingPixels: number;
  totalPixels: number;
  deltaRatio: number;
}

/**
 * Cross-checks the local codec's delta ratio against a REAL browser
 * decode: both PNGs are loaded as data URLs and compared on a canvas via
 * PlaywrightSession.evaluate (the observe evaluateFnSource convention —
 * zero-dep image decode by the engine that PRODUCED the screenshots).
 * Used by the browser-gated visual battery to prove the two decode paths
 * agree; the pure path remains the default (browsers are optional).
 */
export const IN_BROWSER_COMPARE_FN = `async (images) => {
  const load = (dataUrl) => new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('image decode failed'));
    image.src = dataUrl;
  });
  const left = await load(images[0]);
  const right = await load(images[1]);
  const read = (image) => {
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    return context.getImageData(0, 0, canvas.width, canvas.height);
  };
  const leftData = read(left);
  const rightData = read(right);
  let differing = 0;
  const total = leftData.width * leftData.height;
  if (leftData.width === rightData.width && leftData.height === rightData.height) {
    for (let index = 0; index < leftData.data.length; index += 4) {
      const a0 = leftData.data[index], a1 = leftData.data[index + 1], a2 = leftData.data[index + 2], a3 = leftData.data[index + 3];
      const b0 = rightData.data[index], b1 = rightData.data[index + 1], b2 = rightData.data[index + 2], b3 = rightData.data[index + 3];
      if (a0 !== b0 || a1 !== b1 || a2 !== b2 || a3 !== b3) differing += 1;
    }
  }
  return {
    leftWidth: leftData.width,
    leftHeight: leftData.height,
    rightWidth: rightData.width,
    rightHeight: rightData.height,
    differingPixels: differing,
    totalPixels: total,
    deltaRatio: total === 0 ? 0 : differing / total,
  };
}`;

/** Runs {@link IN_BROWSER_COMPARE_FN} through a PlaywrightSession with two PNG data URLs. */
export async function comparePixelsInBrowser(
  evaluate: (fnSource: string, arg?: unknown) => Promise<unknown>,
  leftPng: Uint8Array,
  rightPng: Uint8Array,
): Promise<InBrowserPixelComparison> {
  const arg = [
    `data:image/png;base64,${base64Of(leftPng)}`,
    `data:image/png;base64,${base64Of(rightPng)}`,
  ];
  const result = await evaluate(IN_BROWSER_COMPARE_FN, arg);
  if (typeof result !== 'object' || result === null) {
    throw new Error('in-browser pixel comparison returned a non-object result');
  }
  const record = result as Record<string, unknown>;
  const differing = record['differingPixels'];
  const total = record['totalPixels'];
  if (typeof differing !== 'number' || typeof total !== 'number') {
    throw new Error('in-browser pixel comparison returned malformed counts');
  }
  return {
    leftWidth: asNumber(record['leftWidth']),
    leftHeight: asNumber(record['leftHeight']),
    rightWidth: asNumber(record['rightWidth']),
    rightHeight: asNumber(record['rightHeight']),
    differingPixels: differing,
    totalPixels: total,
    deltaRatio: total === 0 ? 0 : differing / total,
  };
}

function asNumber(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}

function base64Of(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}
