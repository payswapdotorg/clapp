/**
 * CLAPP-022 test battery — explorer resilience over a tmpdir corpus.
 *
 * A small hand-authored corpus served by the frozen fixture server from a
 * temp directory (stdlib HTTP on 127.0.0.1 only) exercises the paths b01
 * cannot: a dead link (404 navigation), a self-submitting form
 * (route-preserving submission), and duplicate arrivals. Assertions read
 * capture payloads back out of the artifact store — the evidence is the
 * proof, not the report.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RecordingSession } from '@clapp/evidence';
import { createDomApplier, startFixtureServer } from '@clapp/journey';
import { MemoryArtifactStore, MemoryRunStore } from '@clapp/store';
import { createExplorationPolicy, explore } from '../src/index';
import type { ExploreResult } from '../src/index';

const PAGE = (title: string, body: string): string => `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>${title}</title></head>
<body>
<main>
<h1>${title}</h1>
${body}
</main>
</body>
</html>`;

const INDEX = PAGE(
  'Resilience index',
  `
<nav aria-label="Main">
  <a href="gone.html" data-testid="broken-link">Broken</a>
  <a href="next.html" data-testid="next-link">Next</a>
</nav>
<form action="done.html" method="get" id="main-form">
  <label for="q">Query</label>
  <input id="q" name="q" type="text" data-testid="q">
  <button type="submit" data-testid="go">Go</button>
</form>
`,
);

const NEXT = PAGE(
  'Resilience next',
  `
<p><a href="/" data-testid="home-link">Home</a></p>
<form action="done.html" method="get">
  <input name="q" type="text" aria-label="Note">
  <button type="submit">Send</button>
</form>
`,
);

const DONE = PAGE(
  'Resilience done',
  `
<p><a href="/" data-testid="home-link">Home</a></p>
<form action="done.html" method="get">
  <input name="q" type="text" aria-label="Tag">
  <button type="submit">Save</button>
</form>
`,
);

let corpusRoot: string;
let server: Awaited<ReturnType<typeof startFixtureServer>>;
let result: ExploreResult;
let stores: { runStore: MemoryRunStore; artifactStore: MemoryArtifactStore };
let session: RecordingSession;

beforeAll(async () => {
  corpusRoot = await mkdtemp(join(tmpdir(), 'clapp-explore-resilience-'));
  await writeFile(join(corpusRoot, 'index.html'), INDEX, 'utf8');
  await writeFile(join(corpusRoot, 'next.html'), NEXT, 'utf8');
  await writeFile(join(corpusRoot, 'done.html'), DONE, 'utf8');
  // gone.html intentionally absent — the dead link 404s.
  server = await startFixtureServer({ root: corpusRoot });
  stores = { runStore: new MemoryRunStore(), artifactStore: new MemoryArtifactStore() };
  session = await RecordingSession.start(stores, { targetId: 'bench/resilience' });
  result = await explore({
    baseUrl: server.url,
    applier: createDomApplier({ baseUrl: server.url }),
    recorder: session,
    policy: createExplorationPolicy({
      entrypoints: ['/'],
      maxSteps: 60,
      maxScreens: 8,
      maxActionsPerScreen: 6,
      seed: 77,
    }),
    application: {
      id: 'app_resilience',
      name: 'resilience',
      platform: 'web',
      entrypoints: ['/'],
    },
  });
}, 60_000);

afterAll(async () => {
  await server.close();
  await rm(corpusRoot, { recursive: true, force: true });
});

interface UserCapture {
  kind: string;
  payload: {
    subkind: string;
    action: { type: string; url?: string };
    outcome: string;
    route: string;
    errorCode?: string;
  };
}

async function readUserCaptures(): Promise<UserCapture[]> {
  const captures: UserCapture[] = [];
  for (const entry of result.model.evidence) {
    if (entry.ref.kind !== 'user') continue;
    const record = await stores.artifactStore.getBySha256(entry.ref.sha256, session.runId);
    if (record === null) throw new Error(`missing artifact for ${entry.ref.evidenceId}`);
    const bytes = await stores.artifactStore.readBytes(record.id);
    if (bytes === null) throw new Error(`missing bytes for ${record.id}`);
    captures.push(JSON.parse(new TextDecoder().decode(bytes)) as UserCapture);
  }
  return captures;
}

describe('explorer — resilience (failure never aborts)', () => {
  it('survives a dead link: the failed navigation is evidence, not a crash', async () => {
    expect([...result.report.screensVisited].sort()).toEqual(['/', '/done', '/next']);
    const captures = await readUserCaptures();
    const failed = captures.filter((capture) => capture.payload.outcome === 'skipped');
    expect(failed).toHaveLength(1);
    expect(failed[0]?.payload.action.type).toBe('navigate');
    expect(failed[0]?.payload.action.url).toContain('gone.html');
    expect(failed[0]?.payload.errorCode).toBe('navigate-failed');
    // the dead route never became a screen
    expect(result.report.screensVisited).not.toContain('/gone');
    // and it never blocked completion
    expect(result.report.budgetStops).toEqual([]);
    expect(result.report.frontierExhausted).toBe(true);
  });

  it('counts duplicate arrivals honestly (self-submit + cross-page submit)', () => {
    expect(result.report.duplicateScreensSkipped).toBe(2);
    expect(result.report.actionsSkipped).toBe(0); // acts all applied; the NAVIGATE failed
  });

  it('records a storage inventory after every applied form submission', async () => {
    const storageEntries = result.model.evidence.filter((entry) => entry.ref.kind === 'storage');
    expect(storageEntries).toHaveLength(3); // index→done, done→done (self), next→done
    for (const entry of storageEntries) {
      const record = await stores.artifactStore.getBySha256(entry.ref.sha256, session.runId);
      expect(record).not.toBeNull();
      if (record === null) continue;
      const bytes = await stores.artifactStore.readBytes(record.id);
      const capture = JSON.parse(new TextDecoder().decode(bytes as Uint8Array)) as {
        payload: { subkind: string; keys: string[] };
      };
      expect(capture.payload.subkind).toBe('storage-inventory');
      expect(capture.payload.keys).toEqual([]); // honestly empty: no storage channel
    }
  });

  it('emits NO self-transition for the route-preserving self-submit (no storage signal)', () => {
    const { model } = result;
    const routeOf = (screenId: string): string => {
      const screen = model.screens.find((candidate) => candidate.id === screenId);
      if (screen === undefined) throw new Error('unknown screen');
      return screen.route;
    };
    for (const transition of model.state.transitions) {
      expect(transition.fromScreenId).not.toBe(transition.toScreenId);
    }
    const edges = model.state.transitions
      .map((transition) => `${routeOf(transition.fromScreenId)}->${routeOf(transition.toScreenId)}`)
      .sort();
    // The done→done self-submit produced NO edge; the failed navigate
    // produced NO edge; the applied submission and the applied navigation did.
    expect(edges).toEqual(['/->/done', '/done->/next', '/next->/done']);
  });
});
