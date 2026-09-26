/**
 * CLAPP-041 test battery — the visual dimension, BROWSER-GATED.
 *
 * These tests run ONLY when a real chromium is launchable (playwright-core
 * is a devDependency, loaded lazily — the @clapp/journey replayer-
 * playwright precedent). The gating is REPORTED by a dedicated always-run
 * test below, never silently dropped: when the browser is unavailable the
 * skip is stated in the battery output AND the network killer acceptance
 * (network-acceptance.test.ts) remains the green spine of this package —
 * the README's limitation section says so explicitly.
 *
 * What runs when a browser IS available (this sandbox has one):
 * 1. DETERMINISM CONTROL — the golden candidate screenshotted twice
 *    through the same capture path: byte-identical or pixel-delta zero
 *    (compareVisualPair returns no findings).
 * 2. MUTATION CONTROL — a candidate with ONE heading text changed before
 *    server start: ≥1 'visual' finding, severity minor/info (NOT
 *    critical — a text-only change breaks no postcondition), anchored
 *    with BOTH sides' capture refs, and a pixel delta ratio > 0.
 * 3. POSTCONDITION ESCALATION — a candidate with the footer copyright
 *    paragraph REMOVED: the assert-visible region (measured on the
 *    golden page via a PlaywrightSession bounding rect) goes blank on
 *    the right → the contract's 'critical' case.
 * 4. DECODE PARITY — the zero-dep codec's delta ratio equals the
 *    IN-BROWSER canvas comparison ratio (comparePixelsInBrowser) for the
 *    same pair, and both decode real chromium PNGs to 1280-wide
 *    full-page captures.
 * 5. PLAYWRIGHT NETWORK PATH — captureNetworkWithPlaywright records the
 *    candidate's documents + synthesized SVG assets through the observe
 *    network channel (resourceType-classified), and the traffic compares
 *    to info-grade findings only.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import type { Browser } from 'playwright-core';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateApp, writeApp, type GeneratedApp } from '@clapp/codegen';
import { PlaywrightSession } from '@clapp/observe';
import {
  buildGoldenPlan,
  GOLDEN_B01_PLAN,
  GOLDEN_ELEMENT_IDS,
} from '../fixtures/golden-b01-plan';
import {
  captureNetworkWithPlaywright,
  comparePixelsInBrowser,
  compareVisualPair,
  openScreenshotAdapter,
  type ScreenshotAdapter,
} from '../src/index';
import { compareNetworkTraffic } from '../src/network';
import type { DiffAnchor, DiffFinding, DiffSeverity } from '../src/diff-contract';
import { spawnApp, type SpawnedApp } from './helpers/spawn-app';

// Lazy + guarded (the journey precedent): a missing package or missing
// browser degrades to null and the tests below skip — reported above.
const playwright: typeof import('playwright-core') | null = await import('playwright-core').then(
  (mod) => mod,
  () => null,
);

const browser: Browser | null =
  playwright !== null
    ? await playwright.chromium.launch({ headless: true }).then(
        (launched) => launched,
        () => null,
      )
    : null;

const browserAvailable = browser !== null;

afterAll(async () => {
  if (browser !== null) {
    await browser.close().catch(() => undefined);
  }
});

describe('visual battery gating — REPORTED, never silently dropped', () => {
  it('states whether the browser-gated visual battery is running', () => {
    // This test ALWAYS runs; its output line is the honest report.
    console.log(
      browserAvailable
        ? '[diffext] browser-gated visual battery: RUNNING (chromium launchable in this environment)'
        : '[diffext] browser-gated visual battery: SKIPPED (no chromium launchable — the browser-independent network killer acceptance remains the green spine; see README limitations)',
    );
    expect(typeof browserAvailable).toBe('boolean');
  });
});

// ---------------------------------------------------------------------------
// Shared fixture state (built once when the browser is available)
// ---------------------------------------------------------------------------

const ANCHOR: DiffAnchor = { stepIndex: 0, sourceIds: [GOLDEN_B01_PLAN.application.id, GOLDEN_ELEMENT_IDS.heroHeading] };

let adapter: ScreenshotAdapter | null = null;
let goldenApp: SpawnedApp | null = null;
let headingMutant: SpawnedApp | null = null;
let copyrightMutant: SpawnedApp | null = null;
const tempDirs: string[] = [];

async function startApp(app: GeneratedApp): Promise<SpawnedApp> {
  const dir = await mkdtemp(join(tmpdir(), 'clapp-041-visual-'));
  tempDirs.push(dir);
  const spawned = await spawnApp(await writeApp(app, dir));
  return spawned;
}

beforeAll(async () => {
  if (!browserAvailable) {
    return;
  }
  adapter = await openScreenshotAdapter({ fullPage: true });
  expect(adapter.driver).toBe('playwright');
  goldenApp = await startApp(generateApp(buildGoldenPlan()));
  headingMutant = await startApp(
    generateApp(buildGoldenPlan({ heroHeadingText: 'Capture every idea, urgently' })),
  );
  copyrightMutant = await startApp(generateApp(buildGoldenPlan({ removeFooterCopyright: true })));
});

afterAll(async () => {
  await adapter?.close().catch(() => undefined);
  await goldenApp?.close().catch(() => undefined);
  await headingMutant?.close().catch(() => undefined);
  await copyrightMutant?.close().catch(() => undefined);
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

function severities(findings: DiffFinding[]): DiffSeverity[] {
  return findings.map((finding) => finding.severity);
}

describe('visual dimension (browser-gated — skips when no chromium)', () => {
  it.skipIf(!browserAvailable)(
    'determinism control: same app screenshotted twice → no findings (byte-identical or pixel-delta zero)',
    async () => {
      expect(adapter).not.toBeNull();
      expect(goldenApp).not.toBeNull();
      const first = await adapter!.captureScreenshot(0, 'left', goldenApp!.url);
      const second = await adapter!.captureScreenshot(1, 'left', goldenApp!.url);

      // Capture shape: real pixels, evidence-shaped, full-page width.
      for (const shot of [first, second]) {
        expect(shot.status).toBe('captured');
        expect(shot.png).toBeDefined();
        expect(shot.width).toBe(1280);
        expect(shot.height).toBeGreaterThan(720); // full page > viewport
        expect(shot.evidenceRef?.kind).toBe('screenshot');
        expect(shot.evidenceRef?.evidenceId).toMatch(/^ev_[0-9a-f-]{36}$/);
        expect(shot.evidenceRef?.sha256).toMatch(/^[0-9a-f]{64}$/);
      }

      expect(compareVisualPair(first, second, ANCHOR)).toEqual([]);
    },
    60_000,
  );

  it.skipIf(!browserAvailable)(
    'mutation control: one heading text changed → ≥1 visual finding, minor/info severity, both capture refs anchored',
    async () => {
      expect(adapter).not.toBeNull();
      expect(goldenApp).not.toBeNull();
      expect(headingMutant).not.toBeNull();
      const left = await adapter!.captureScreenshot(0, 'left', goldenApp!.url);
      const right = await adapter!.captureScreenshot(0, 'right', headingMutant!.url);

      const findings = compareVisualPair(left, right, ANCHOR);
      expect(findings.length).toBeGreaterThanOrEqual(1);
      const divergence = findings.find(
        (finding) => finding.severity === 'minor' || finding.severity === 'info',
      );
      expect(divergence).toBeDefined();
      // Severity honesty: a text-only change is NEVER critical.
      expect(severities(findings)).not.toContain('critical');
      const actual = divergence!.actual as { pixelDeltaRatio: number; differingPixels: number };
      expect(actual.pixelDeltaRatio).toBeGreaterThan(0);
      expect(actual.differingPixels).toBeGreaterThan(0);
      // Both sides' capture refs prove the finding.
      expect(divergence!.anchors[0]?.leftEvidence?.evidenceId).toBe(left.evidenceRef!.evidenceId);
      expect(divergence!.anchors[0]?.rightEvidence?.evidenceId).toBe(right.evidenceRef!.evidenceId);
    },
    60_000,
  );

  it.skipIf(!browserAvailable)(
    "postcondition escalation: assert-visible region lost on the right → 'critical'",
    async () => {
      expect(adapter).not.toBeNull();
      expect(browser).not.toBeNull();
      expect(goldenApp).not.toBeNull();
      expect(copyrightMutant).not.toBeNull();

      // Measure the assert-visible region on the GOLDEN page: the footer
      // copyright paragraph's bounding rect (document coordinates — the
      // fresh session has not scrolled).
      const session = await PlaywrightSession.open({ browser: browser! });
      let region: { x: number; y: number; width: number; height: number };
      try {
        await session.navigate(goldenApp!.url, 'load');
        const rect = await session.evaluate<unknown>(
          `() => {
            const element = document.querySelector('footer > p');
            if (element === null) { return null; }
            const box = element.getBoundingClientRect();
            return { x: box.x, y: box.y + window.scrollY, width: box.width, height: box.height };
          }`,
        );
        expect(rect).not.toBeNull();
        region = rect as { x: number; y: number; width: number; height: number };
        expect(region.width).toBeGreaterThan(0);
        expect(region.height).toBeGreaterThan(0);
      } finally {
        await session.close().catch(() => undefined);
      }

      const left = await adapter!.captureScreenshot(0, 'left', goldenApp!.url);
      const right = await adapter!.captureScreenshot(0, 'right', copyrightMutant!.url);

      const findings = compareVisualPair(left, right, ANCHOR, {
        postconditionRegions: [{ label: 'assert-visible footer-copyright', region }],
      });

      const critical = findings.find((finding) => finding.severity === 'critical');
      expect(critical).toBeDefined();
      expect(critical!.summary).toContain('assert-visible footer-copyright');
      // The region's content is missing on the right — either flavor of
      // the loss is the contract's critical case (blank region, or a right
      // page too short to even reach the region).
      expect(
        critical!.summary.includes('uniformly blank') ||
          critical!.summary.includes('missing entirely on the right'),
      ).toBe(true);
      expect(critical!.anchors[0]?.leftEvidence?.evidenceId).toBe(left.evidenceRef!.evidenceId);
      expect(critical!.anchors[0]?.rightEvidence?.evidenceId).toBe(right.evidenceRef!.evidenceId);
    },
    60_000,
  );

  it.skipIf(!browserAvailable)(
    'decode parity: the zero-dep codec and the in-browser canvas comparison agree',
    async () => {
      expect(adapter).not.toBeNull();
      expect(browser).not.toBeNull();
      expect(goldenApp).not.toBeNull();
      expect(headingMutant).not.toBeNull();

      const left = await adapter!.captureScreenshot(0, 'left', goldenApp!.url);
      const right = await adapter!.captureScreenshot(0, 'right', headingMutant!.url);
      expect(left.png).toBeDefined();
      expect(right.png).toBeDefined();

      // Pure path ratio.
      const findings = compareVisualPair(left, right, ANCHOR);
      const pureFinding = findings.find((finding) => finding.actual !== undefined);
      expect(pureFinding).toBeDefined();
      const pureRatio = (pureFinding!.actual as { pixelDeltaRatio: number }).pixelDeltaRatio;

      // In-browser canvas path (a real PlaywrightSession decode).
      const session = await PlaywrightSession.open({ browser: browser! });
      try {
        const inBrowser = await comparePixelsInBrowser(
          (fnSource: string, arg?: unknown) => session.evaluate(fnSource, arg),
          left.png!,
          right.png!,
        );
        expect(inBrowser.leftWidth).toBe(1280);
        expect(left.height).toBeDefined();
        expect(inBrowser.leftHeight).toBe(left.height!);
        expect(inBrowser.rightWidth).toBe(1280);
        expect(inBrowser.differingPixels).toBeGreaterThan(0);
        // The finding's ratio is documented to 6 decimals (serializable
        // compactness); the parity bound matches that precision.
        expect(Math.abs(inBrowser.deltaRatio - pureRatio)).toBeLessThan(1e-6);
      } finally {
        await session.close().catch(() => undefined);
      }
    },
    60_000,
  );

  it.skipIf(!browserAvailable)(
    'playwright network path: documents + synthesized assets captured through the observe network channel',
    async () => {
      expect(browser).not.toBeNull();
      expect(goldenApp).not.toBeNull();
      const capture = await captureNetworkWithPlaywright({
        browser: browser!,
        urls: [goldenApp!.url, `${goldenApp!.url}features.html`],
      });

      // The capture vocabulary: absolute URLs, methods, statuses, resourceTypes.
      const paths = capture.requests.map((request) => new URL(request.url).pathname);
      expect(paths).toContain('/');
      expect(paths).toContain('/features.html');
      expect(paths.some((path) => path.startsWith('/assets/') && path.endsWith('.svg'))).toBe(true);
      for (const request of capture.requests) {
        expect(request.method).toBe('GET');
        expect(typeof request.status).toBe('number');
      }
      const documentRequest = capture.requests.find((request) => request.resourceType === 'document');
      expect(documentRequest).toBeDefined();

      // The golden plan's api section compared against browser traffic:
      // documents/assets are info-grade; the api endpoints (never called
      // by the static pages) surface as honest never-exercised infos.
      const findings = compareNetworkTraffic(
        capture.requests,
        GOLDEN_B01_PLAN.api.endpoints,
        GOLDEN_B01_PLAN.api.mocks,
        ANCHOR,
      );
      expect(findings.length).toBeGreaterThan(0);
      for (const finding of findings) {
        expect(finding.dimension).toBe('network');
        expect(finding.severity).toBe('info');
      }
      const neverExercised = findings.filter((finding) => finding.summary.includes('never exercised'));
      expect(neverExercised.length).toBe(2); // both api endpoints, honestly recorded

      // Evidence refs for the browser-path captures are well-formed.
      for (const ref of capture.evidenceRefs) {
        expect(ref.kind).toBe('network');
        expect(ref.evidenceId).toMatch(/^ev_[0-9a-f-]{36}$/);
        expect(ref.sha256).toMatch(/^[0-9a-f]{64}$/);
      }
    },
    60_000,
  );
});
