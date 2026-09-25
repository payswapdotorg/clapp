/**
 * @clapp/codegen tests — the generated golden app's server behaviors
 * (CLAPP-031): page serving, query strings, 404/405 policy, HEAD,
 * assets, PORT override, and health paths (both page-backed and
 * standalone).
 */

import { afterAll, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateApp, writeApp } from '../src/index';
import { GOLDEN_B01_PLAN } from '../fixtures/golden-b01-plan';
import { headingInit, makePlan } from './helpers/plans';
import { spawnApp, type SpawnedApp } from './helpers/spawn-app';

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

async function materialize(plan: Parameters<typeof generateApp>[0], label: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `clapp-031-${label}-`));
  scratch.push(dir);
  await writeApp(generateApp(plan), dir);
  return dir;
}

describe('generated server — golden app pages', () => {
  it(
    'serves every planned route with its page HTML and no-store cache control',
    async () => {
      const root = await materialize(GOLDEN_B01_PLAN, 'server-golden');
      const server = await spawnApp(root);
      servers.push(server);
      const expectations: Array<[string, string]> = [
        ['/', 'Capture every idea, calmly — Nimbus Notes'],
        ['/features.html', 'Everything you need to stay organized'],
        ['/pricing.html', 'Simple, honest pricing'],
        ['/contact.html', "We'd love to hear from you"],
        ['/contact-success.html', 'Thanks for reaching out!'],
        ['/newsletter-success.html', "You're on the list!"],
      ];
      for (const [path, marker] of expectations) {
        const response = await fetch(new URL(path, server.url));
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toContain('text/html');
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(await response.text()).toContain(marker);
      }
    },
    30_000,
  );

  it(
    'ignores query strings (GET form submissions land on their action route)',
    async () => {
      const root = await materialize(GOLDEN_B01_PLAN, 'server-query');
      const server = await spawnApp(root);
      servers.push(server);
      const response = await fetch(new URL('/contact-success.html?name=Ada+Lovelace&topic=general', server.url));
      expect(response.status).toBe(200);
      expect(await response.text()).toContain('Thanks for reaching out!');
    },
    30_000,
  );

  it(
    'answers 404 with the not-found page for unknown paths',
    async () => {
      const root = await materialize(GOLDEN_B01_PLAN, 'server-404');
      const server = await spawnApp(root);
      servers.push(server);
      const response = await fetch(new URL('/nope.html', server.url));
      expect(response.status).toBe(404);
      expect(await response.text()).toContain('data-testid="not-found"');
    },
    30_000,
  );

  it(
    'allows HEAD and POST on pages, rejects other methods with 405',
    async () => {
      const root = await materialize(GOLDEN_B01_PLAN, 'server-methods');
      const server = await spawnApp(root);
      servers.push(server);
      const head = await fetch(new URL('/features.html', server.url), { method: 'HEAD' });
      expect(head.status).toBe(200);
      expect(await head.text()).toBe('');
      const post = await fetch(new URL('/contact-success.html', server.url), {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'name=Ada',
      });
      expect(post.status).toBe(200);
      expect(await post.text()).toContain('Thanks for reaching out!');
      const put = await fetch(new URL('/', server.url), { method: 'PUT' });
      expect(put.status).toBe(405);
    },
    30_000,
  );

  it(
    'serves the synthesized image assets as SVG',
    async () => {
      const root = await materialize(GOLDEN_B01_PLAN, 'server-assets');
      const server = await spawnApp(root);
      servers.push(server);
      const logo = await fetch(new URL('/assets/nimbus-notes-logo.svg', server.url));
      expect(logo.status).toBe(200);
      expect(logo.headers.get('content-type')).toContain('image/svg+xml');
      expect(await logo.text()).toContain('<title>Nimbus Notes logo</title>');
      const missing = await fetch(new URL('/assets/does-not-exist.svg', server.url));
      expect(missing.status).toBe(404);
    },
    30_000,
  );

  it(
    'honors the PORT env override over the planned default port',
    async () => {
      const root = await materialize(GOLDEN_B01_PLAN, 'server-port');
      const fixedPort = 4591;
      const server = await spawnApp(root, { port: fixedPort });
      servers.push(server);
      expect(server.port).toBe(fixedPort);
      const response = await fetch(`http://127.0.0.1:${fixedPort}/`);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain('Capture every idea, calmly');
    },
    30_000,
  );
});

describe('generated server — health paths', () => {
  it(
    "serves the page when the health path is a planned route ('/')",
    async () => {
      const root = await materialize(GOLDEN_B01_PLAN, 'server-health-page');
      const server = await spawnApp(root);
      servers.push(server);
      const response = await fetch(server.url);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');
    },
    30_000,
  );

  it(
    "answers 200 'ok' when the health path is not a planned route",
    async () => {
      const plan = makePlan({
        pages: [{ path: '/', title: 'Home', elements: [headingInit('Home')] }],
        healthPath: '/healthz',
      });
      const root = await materialize(plan, 'server-health-plain');
      const server = await spawnApp(root);
      servers.push(server);
      const health = await fetch(new URL('/healthz', server.url));
      expect(health.status).toBe(200);
      expect(health.headers.get('content-type')).toContain('text/plain');
      expect(await health.text()).toBe('ok\n');
      // POST on a plain health path is rejected; the page still serves POSTs.
      const post = await fetch(new URL('/healthz', server.url), { method: 'POST' });
      expect(post.status).toBe(405);
      const page = await fetch(new URL('/', server.url), { method: 'POST' });
      expect(page.status).toBe(200);
    },
    30_000,
  );
});

describe('generated server — redirect transitions', () => {
  it(
    'serves 308 + Location from a pageless from-route',
    async () => {
      const plan = makePlan({
        pages: [
          { path: '/', title: 'Home', elements: [headingInit('Home')] },
          { path: '/new', title: 'New', elements: [headingInit('New')] },
        ],
        bareRoutes: ['/old'],
        navigation: [
          {
            fromRouteId: 'route_00000000-0000-4000-8000-000000000002',
            toRouteId: 'route_00000000-0000-4000-8000-000000000001',
            trigger: { kind: 'redirect', reason: 'legacy URL retired' },
          },
        ],
      });
      const root = await materialize(plan, 'server-redirect');
      const server = await spawnApp(root);
      servers.push(server);
      const response = await fetch(new URL('/old', server.url), { redirect: 'manual' });
      expect(response.status).toBe(308);
      expect(response.headers.get('location')).toBe('/new');
      const followed = await fetch(new URL('/old', server.url), { redirect: 'follow' });
      expect(followed.status).toBe(200);
      expect(await followed.text()).toContain('New');
    },
    30_000,
  );
});
