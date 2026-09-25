/**
 * @clapp/codegen tests — storage bindings (CLAPP-031).
 *
 * Cookie bindings → Set-Cookie on (and only on) the writtenOn transition's
 * destination route; localStorage/sessionStorage bindings → inline
 * <script> writes embedded in (and only in) the destination page's HTML;
 * 'server' bindings and unresolvable writtenOn references → documented in
 * the generated README only.
 */

import { afterAll, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateApp, writeApp } from '../src/index';
import { headingInit, makePlan, testNavId, testRouteId } from './helpers/plans';
import { spawnApp, type SpawnedApp } from './helpers/spawn-app';

const NAV_HOME_TO_AFTER = testNavId(0);

const storagePlan = makePlan({
  name: 'Storage App',
  pages: [
    { path: '/', title: 'Home', elements: [headingInit('Home')] },
    { path: '/after', title: 'After', elements: [headingInit('After')] },
  ],
  navigation: [
    {
      fromRouteId: testRouteId(0),
      toRouteId: testRouteId(1),
      trigger: { kind: 'link', elementId: 'el_00000000-0000-4000-8000-0000000000e1' },
    },
  ],
  storage: [
    { key: 'visited', storage: 'cookie', entityFieldNames: [], writtenOn: [NAV_HOME_TO_AFTER], sourceEntityIds: [] },
    { key: 'flag', storage: 'localStorage', entityFieldNames: [], writtenOn: [NAV_HOME_TO_AFTER], sourceEntityIds: [] },
    { key: 'session-flag', storage: 'sessionStorage', entityFieldNames: [], writtenOn: [NAV_HOME_TO_AFTER], sourceEntityIds: [] },
  ],
});

const serverStoragePlan = makePlan({
  name: 'Server Storage App',
  pages: [{ path: '/', title: 'Home', elements: [headingInit('Home')] }],
  storage: [
    { key: 'cart', storage: 'server', entityFieldNames: [], writtenOn: [], sourceEntityIds: [] },
    // Unresolvable transition reference: documented, never silently dropped.
    { key: 'dangling', storage: 'cookie', entityFieldNames: [], writtenOn: ['nav_missing'], sourceEntityIds: [] },
  ],
});

const scratch: string[] = [];
const servers: SpawnedApp[] = [];

afterAll(async () => {
  for (const server of servers) {
    await server.close().catch(() => undefined);
  }
  for (const dir of scratch) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

describe('storage — cookies and inline scripts over real HTTP', () => {
  it(
    'sets the cookie and embeds the scripts on the writtenOn route only',
    async () => {
      const dir = await mkdtemp(join(tmpdir(), 'clapp-031-storage-'));
      scratch.push(dir);
      await writeApp(generateApp(storagePlan), dir);
      const server = await spawnApp(dir);
      servers.push(server);

      // The writtenOn destination route (/after): header + scripts present.
      const after = await fetch(new URL('/after', server.url));
      expect(after.status).toBe(200);
      expect(after.headers.getSetCookie()).toEqual(['visited=visited; Path=/']);
      const afterHtml = await after.text();
      expect(afterHtml).toContain('<script>try{localStorage.setItem("flag","flag")}catch(e){}</script>');
      expect(afterHtml).toContain('<script>try{sessionStorage.setItem("session-flag","session-flag")}catch(e){}</script>');

      // Every other route: no header, no scripts.
      const home = await fetch(new URL('/', server.url));
      expect(home.status).toBe(200);
      expect(home.headers.getSetCookie()).toEqual([]);
      const homeHtml = await home.text();
      expect(homeHtml).not.toContain('<script>');
      expect(homeHtml).not.toContain('localStorage');
      expect(homeHtml).not.toContain('sessionStorage');
    },
    30_000,
  );

  it('places the scripts in the generated page module for the destination route only', () => {
    const app = generateApp(storagePlan);
    const afterModule = app.files.find((file) => file.path === 'pages/after.html.ts')?.contents ?? '';
    const homeModule = app.files.find((file) => file.path === 'pages/index.html.ts')?.contents ?? '';
    expect(afterModule).toContain('localStorage.setItem("flag","flag")');
    expect(afterModule).toContain('sessionStorage.setItem("session-flag","session-flag")');
    expect(homeModule).not.toContain('setItem');
    // The cookie lands in the generated server's cookie table.
    const serverSource = app.files.find((file) => file.path === 'server.ts')?.contents ?? '';
    expect(serverSource).toContain('"/after": ["visited=visited; Path=/"]');
    expect(serverSource).not.toContain('"/": ["visited');
  });

  it('documents storage bindings and the verbatim replay limitation in the README', () => {
    const app = generateApp(storagePlan);
    const readme = app.files.find((file) => file.path === 'README.md')?.contents ?? '';
    expect(readme).toContain('`visited` (cookie)');
    expect(readme).toContain('`flag` (localStorage)');
    expect(readme).toContain('`session-flag` (sessionStorage)');
    expect(readme).toContain('value = the key name');
    expect(readme).toContain("minidom replay never gates on storage; P4's paired runner owns storage verification.");
  });
});

describe('storage — honest degradation', () => {
  it("documents 'server' bindings and unresolvable writtenOn references", () => {
    const app = generateApp(serverStoragePlan);
    const readme = app.files.find((file) => file.path === 'README.md')?.contents ?? '';
    expect(readme).toContain('`cart` (server)');
    expect(readme).toContain('the mock backend is stateless by design');
    expect(readme).toContain('storage binding');
    expect(readme).toContain('nav_missing');
    expect(readme).toContain('write skipped');
    // Nothing leaks into the app itself.
    const serverSource = app.files.find((file) => file.path === 'server.ts')?.contents ?? '';
    expect(serverSource).toContain('const cookieRoutes: Record<string, string[]> = {};');
    const homeModule = app.files.find((file) => file.path === 'pages/index.html.ts')?.contents ?? '';
    expect(homeModule).not.toContain('<script>');
  });
});
