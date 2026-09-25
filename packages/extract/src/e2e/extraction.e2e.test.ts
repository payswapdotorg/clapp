// CLAPP-021 e2e — the full pipeline against the real b01 fixture corpus
// under a REAL Playwright chromium browser:
//
//   startFixtureServer(b01)                       ← @clapp/journey serves the corpus
//     → ObservationRunner script visiting
//       '/', '/pricing.html', '/features.html'    ← capture-dom + screenshots
//     → RecordingSession                           ← real @clapp/evidence recording
//     → buildBundle                               ← sealed manifest
//     → extractIrModel
//     → 3 screens, treeRef/visualRef set, transitions in nav order,
//       every ref cited resolves in the bundle manifest.
//
// The sandbox flavor (launchServerInSandbox, exactly the machinery
// CLAPP-010's e2e used: ProcessSandboxExecutor + budget + readyPath +
// stopPath + graceful close) is exercised by launching the b01 corpus
// inside an execution profile and probing it over HTTP. It deliberately
// does NOT run a second browser session: this sandbox box (2 CPUs, no
// swap) has a hard concurrency budget for e2e sessions (010's suites
// already run three), and a second full session here was measured to make
// the shared `bun test` battery flaky for CLAPP-010's suites — the
// neighborly trade is documented in README "Known limitations".
//
// Browser-gated: skips cleanly when no browser binary is available
// (describe.skipIf(!canRun)); the unit battery covers every extractor
// against synthetic bundles.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ProcessSandboxExecutor } from '@clapp/sandbox';
import { resolveFixtureRoot, startFixtureServer } from '@clapp/journey';
import type { FixtureServer } from '@clapp/journey';
import { MemoryArtifactStore, MemoryRunStore } from '@clapp/store';
import { RecordingSession, buildBundle, loadRunFromStores } from '@clapp/evidence';
import { createPlaywrightDriverFactory, launchServerInSandbox, ObservationRunner } from '@clapp/observe';
import type { LaunchedServer, ObservationStep } from '@clapp/observe';
import type { Browser } from 'playwright';
import { chromium } from 'playwright';
import { extractIrModel } from '../extraction';
import { checkIrLiteral, collectCitedEvidenceRefs } from '../check-ir-literal';
import type { IrModel } from '../ir-contract';
import type { EvidenceRef } from '@clapp/core';

async function browserProbe(): Promise<boolean> {
  try {
    const browser = await chromium.launch({ headless: true });
    await browser.close();
    return true;
  } catch {
    return false;
  }
}

const canRun = await browserProbe();

/** The b01 corpus as a fixtures map (relative path → UTF-8 content). */
function loadB01Fixtures(): Record<string, string> {
  const root = resolveFixtureRoot();
  const out: Record<string, string> = {};
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const absolute = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(absolute, `${prefix}${entry.name}/`);
      } else {
        out[`b01/${prefix}${entry.name}`] = readFileSync(absolute, 'utf8');
      }
    }
  };
  walk(root, '');
  return out;
}

// A tiny stdlib-only static server for the sandbox flavor: serves ./b01
// (written into the profile by launchServerInSandbox), writes its bound
// port to server.port, and exits 0 on POST /__clapp/stop — the exact
// contract launchServerInSandbox polls (mirrors 010's fixture server).
const WRAPPER_SERVER = `
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';

const root = resolve('b01');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

const server = createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && (req.url ?? '').split('?')[0] === '/__clapp/stop') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('stopping');
      server.close(() => process.exit(0));
      return;
    }
    const raw = (req.url ?? '/').split('?')[0].split('#')[0];
    let decoded = raw;
    try { decoded = decodeURIComponent(raw); } catch { decoded = raw; }
    let filePath = join(root, normalize(decoded));
    try {
      const stats = await stat(filePath);
      if (stats.isDirectory()) filePath = join(filePath, 'index.html');
    } catch {}
    if (filePath !== root && !filePath.startsWith(root + sep)) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('out of bounds');
      return;
    }
    try {
      const body = await readFile(filePath);
      res.writeHead(200, { 'content-type': MIME[extname(filePath)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/html' });
      res.end('<h1>404</h1>');
    }
  } catch (error) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end(String(error));
  }
});
server.listen(0, '127.0.0.1', () => {
  writeFileSync('server.port', String(server.address().port));
});
`;

interface PipelineResult {
  model: IrModel;
  warnings: string[];
  manifestRefs: EvidenceRef[];
}

async function runExtractionPipeline(baseUrl: string, browser: Browser): Promise<PipelineResult> {
  const runStore = new MemoryRunStore();
  const artifactStore = new MemoryArtifactStore();
  const session = await RecordingSession.start({ runStore, artifactStore }, {
    targetId: 'bench/b01-static',
    environment: { browser: 'chromium', os: process.platform, network: 'deny-all' },
  });

  const routes = ['/', '/pricing.html', '/features.html'];
  const steps: ObservationStep[] = routes.flatMap((route): ObservationStep[] => [
    // URL resolution handles baseUrl forms with and without a trailing slash
    { type: 'navigate', url: new URL(route, baseUrl).href },
    { type: 'settle', ms: 150 }, // b01 pages are static; 'load' waits for subresources
    { type: 'capture-dom' },
    { type: 'screenshot' },
  ]);
  steps.push({ type: 'flush' });

  const runner = new ObservationRunner({
    recorder: session,
    sessionFactory: createPlaywrightDriverFactory({ browser }),
    script: { targetId: 'bench/b01-static', steps },
  });
  const observation = await runner.run();
  expect(observation.cleanupNotes).toEqual([]);
  expect(observation.stats.rejectedInvalid).toBe(0);
  expect(observation.stats.rejectedOversized).toBe(0);
  expect(observation.steps.every((step) => step.ok)).toBe(true);
  await session.complete();

  const loaded = await loadRunFromStores({ runStore, artifactStore }, session.runId);
  expect(loaded).not.toBeNull();
  const bundle = await buildBundle(loaded!);
  const result = await extractIrModel({
    bundle,
    readArtifact: (id) => artifactStore.readBytes(id),
  });
  return {
    model: result.model,
    warnings: result.warnings,
    manifestRefs: bundle.manifest.evidence,
  };
}

describe.skipIf(!canRun)('CLAPP-021 e2e — b01 extraction pipeline', () => {
  let browser: Browser;
  let directServer: FixtureServer;
  let sandboxedServer: LaunchedServer;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
    directServer = await startFixtureServer({ root: resolveFixtureRoot() });
    sandboxedServer = await launchServerInSandbox(new ProcessSandboxExecutor(), {
      command: 'bun',
      args: ['server.ts'],
      fixtures: { 'server.ts': WRAPPER_SERVER, ...loadB01Fixtures() },
      budget: { maxDurationMs: 120_000 },
      readyPath: '/',
      stopPath: '/__clapp/stop',
      label: 'clapp-021-e2e-b01',
    });
  }, 120_000);

  afterAll(async () => {
    if (sandboxedServer !== undefined) {
      const result = await sandboxedServer.close();
      expect(result.outcome).toEqual({ status: 'completed', exitCode: 0 });
    }
    if (directServer !== undefined) {
      await directServer.close();
    }
    if (browser !== undefined) {
      await browser.close();
    }
  }, 60_000);

  test(
    'full pipeline over startFixtureServer(b01): 3 screens, treeRef/visualRef set, transitions in nav order, refs resolve',
    async () => {
      const { model, warnings, manifestRefs } = await runExtractionPipeline(directServer.url, browser);
      const manifestEvidenceIds = new Set(manifestRefs.map((ref) => ref.evidenceId));

      // --- 3 screens in nav order ---
      expect(model.screens.map((screen) => screen.route)).toEqual(['/', '/pricing.html', '/features.html']);

      // --- treeRef and visualRef set on every screen, resolving in the manifest ---
      for (const screen of model.screens) {
        expect(screen.treeRef).toBeDefined();
        expect(screen.visualRef).toBeDefined();
        expect(manifestEvidenceIds.has(screen.treeRef!.evidenceId)).toBe(true);
        expect(manifestEvidenceIds.has(screen.visualRef!.evidenceId)).toBe(true);
        expect(screen.provenance.level).toBe('derived');
      }

      // --- components: the real b01 nav structure, actionable roles only ---
      expect(model.components.length).toBeGreaterThan(5);
      const roles = new Set(model.components.map((component) => component.role));
      expect(roles.has('link')).toBe(true);
      const homeScreen = model.screens[0]!;
      const homeComponentNames = model.components
        .filter((component) => component.screenId === homeScreen.id)
        .map((component) => String(component.properties['name']));
      expect(homeComponentNames).toContain('Home');
      expect(homeComponentNames).toContain('Pricing');

      // --- transitions: nav order, / → /pricing.html → /features.html ---
      const routeByScreenId = new Map(model.screens.map((screen) => [screen.id, screen.route]));
      expect(
        model.state.transitions.map((transition) => [
          routeByScreenId.get(transition.fromScreenId),
          routeByScreenId.get(transition.toScreenId),
        ]),
      ).toEqual([
        ['/', '/pricing.html'],
        ['/pricing.html', '/features.html'],
      ]);
      for (const transition of model.state.transitions) {
        expect(transition.trigger).toEqual({ type: 'action', action: 'navigate' });
        expect(transition.provenance.level).toBe('derived');
        expect(transition.provenance.confidence.evidenceRefs.length).toBeGreaterThanOrEqual(4);
      }

      // --- document requests became api operations ---
      const urlPatterns = model.api.operations.map((operation) => operation.urlPattern);
      expect(urlPatterns).toContain('/');
      expect(urlPatterns).toContain('/pricing.html');
      expect(urlPatterns).toContain('/features.html');

      // --- every ref cited anywhere resolves in the bundle manifest ---
      const cited = collectCitedEvidenceRefs(model);
      expect(cited.length).toBeGreaterThan(0);
      for (const ref of cited) {
        expect(manifestEvidenceIds.has(ref.evidenceId)).toBe(true);
      }

      // --- no hard degradations; the internal self-check is clean ---
      expect(warnings.filter((warning) => warning.includes('not JSON') || warning.includes('hash') || warning.includes('readArtifact'))).toEqual([]);
      expect(checkIrLiteral(model, manifestRefs)).toEqual([]);
    },
    120_000,
  );

  test(
    'launchServerInSandbox flavor: the b01 corpus serves from inside the execution profile (same machinery as 010 e2e)',
    async () => {
      // The corpus must be reachable over HTTP from the sandboxed server.
      const home = await fetch(new URL('/', sandboxedServer.baseUrl).href);
      expect(home.status).toBe(200);
      expect(home.headers.get('content-type')).toContain('text/html');
      const homeBody = await home.text();
      expect(homeBody).toContain('Nimbus Notes');

      const pricing = await fetch(new URL('/pricing.html', sandboxedServer.baseUrl).href);
      expect(pricing.status).toBe(200);
      expect((await pricing.text()).length).toBeGreaterThan(100);

      const asset = await fetch(new URL('/assets/styles.css', sandboxedServer.baseUrl).href);
      expect(asset.status).toBe(200);
      expect(asset.headers.get('content-type')).toContain('text/css');
    },
    30_000,
  );
});
