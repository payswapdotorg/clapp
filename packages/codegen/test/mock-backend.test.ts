/**
 * @clapp/codegen tests — the mock backend (CLAPP-031).
 *
 * A plan with endpoints (one mocked with TWO mocks — first by declaration
 * order must serve; one without mocks; one with a bodyless mock) is
 * generated, written, spawned, and exercised over real HTTP. The
 * in-package matching oracle (matchApiRoute/segmentsMatch) is covered by
 * unit assertions first.
 */

import { afterAll, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateApp, matchApiRoute, selectApiRoute, writeApp } from '../src/index';
import type { ApiRouteEntry } from '../src/index';
import { headingInit, makePlan } from './helpers/plans';
import { spawnApp, type SpawnedApp } from './helpers/spawn-app';

const API_GET_ID = 'api_00000000-0000-4000-8000-000000000000';
const API_POST_ID = 'api_00000000-0000-4000-8000-000000000001';
const API_DELETE_ID = 'api_00000000-0000-4000-8000-000000000002';

const mockPlan = makePlan({
  name: 'Mock API App',
  pages: [{ path: '/', title: 'Home', elements: [headingInit('Home')] }],
  endpoints: [
    { method: 'GET', urlPattern: '/api/items/:id' },
    { method: 'POST', urlPattern: '/api/subscribe' },
    { method: 'DELETE', urlPattern: '/api/items/:id' },
  ],
  mocks: [
    { endpointId: API_GET_ID, statusCode: 200, bodyJson: { id: '42', name: 'Widget', tags: ['a', 'b'] } },
    { endpointId: API_GET_ID, statusCode: 201, bodyJson: { id: 'other' } }, // must NEVER serve (second)
    { endpointId: API_DELETE_ID, statusCode: 204 }, // bodyless mock
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

describe('mock backend — matching oracle (unit)', () => {
  const entries: ApiRouteEntry[] = [
    { endpointId: 'api_a', method: 'GET', segments: ['api', 'items', ':id'], mocks: [] },
    { endpointId: 'api_b', method: 'GET', segments: ['api', 'items'], mocks: [] },
  ];

  it('matches :param against exactly one non-empty segment', () => {
    expect(matchApiRoute(entries, '/api/items/42')?.endpointId).toBe('api_a');
    expect(matchApiRoute(entries, '/api/items/abc')?.endpointId).toBe('api_a');
    expect(matchApiRoute(entries, '/api/items')?.endpointId).toBe('api_b');
    expect(matchApiRoute(entries, '/api/items/')).toBeNull();
    expect(matchApiRoute(entries, '/api/items/42/extra')).toBeNull();
    expect(matchApiRoute(entries, '/api/other/42')).toBeNull();
    expect(matchApiRoute(entries, '/')).toBeNull();
  });

  it('resolves path+method when endpoints share a pattern', () => {
    const shared: ApiRouteEntry[] = [
      { endpointId: 'api_get', method: 'GET', segments: ['api', 'items', ':id'], mocks: [] },
      { endpointId: 'api_post', method: 'POST', segments: ['api', 'items', ':id'], mocks: [] },
    ];
    const get = selectApiRoute(shared, '/api/items/42', 'GET');
    expect(get.kind).toBe('serve');
    if (get.kind === 'serve') {
      expect(get.route.endpointId).toBe('api_get');
    }
    const post = selectApiRoute(shared, '/api/items/42', 'POST');
    expect(post.kind).toBe('serve');
    if (post.kind === 'serve') {
      expect(post.route.endpointId).toBe('api_post');
    }
    const deleted = selectApiRoute(shared, '/api/items/42', 'DELETE');
    expect(deleted.kind).toBe('method-mismatch');
    if (deleted.kind === 'method-mismatch') {
      expect(deleted.route.endpointId).toBe('api_get');
      expect(deleted.allowed).toEqual(['GET', 'POST']);
    }
    expect(selectApiRoute(shared, '/api/nope', 'GET').kind).toBe('no-path-match');
  });

  it('manifest labels endpoints as METHOD pattern', async () => {
    const app = generateApp(mockPlan);
    expect(app.manifest.apiEndpoints).toEqual(['GET /api/items/:id', 'POST /api/subscribe', 'DELETE /api/items/:id']);
  });
});

describe('mock backend — over real HTTP', () => {
  it(
    'serves the FIRST mock by declaration order with the exact body',
    async () => {
      const dir = await mkdtemp(join(tmpdir(), 'clapp-031-mock-'));
      scratch.push(dir);
      await writeApp(generateApp(mockPlan), dir);
      const server = await spawnApp(dir);
      servers.push(server);

      const ok = await fetch(new URL('/api/items/42', server.url));
      expect(ok.status).toBe(200);
      expect(ok.headers.get('content-type')).toContain('application/json');
      expect(await ok.json()).toEqual({ id: '42', name: 'Widget', tags: ['a', 'b'] });

      // Any single segment matches the :id parameter.
      const other = await fetch(new URL('/api/items/anything', server.url));
      expect(other.status).toBe(200);
      expect(await other.json()).toEqual({ id: '42', name: 'Widget', tags: ['a', 'b'] });

      // Bodyless mock: status served, empty body.
      const deleted = await fetch(new URL('/api/items/42', server.url), { method: 'DELETE' });
      expect(deleted.status).toBe(204);
      expect(await deleted.text()).toBe('');
    },
    30_000,
  );

  it(
    'answers 405 (JSON, naming the endpoint) for wrong methods',
    async () => {
      const dir = await mkdtemp(join(tmpdir(), 'clapp-031-mock405-'));
      scratch.push(dir);
      await writeApp(generateApp(mockPlan), dir);
      const server = await spawnApp(dir);
      servers.push(server);

      const post = await fetch(new URL('/api/items/42', server.url), { method: 'POST' });
      expect(post.status).toBe(405);
      expect(post.headers.get('content-type')).toContain('application/json');
      expect(await post.json()).toEqual({ error: 'method not allowed', endpointId: API_GET_ID, allowed: ['GET', 'DELETE'] });

      const get = await fetch(new URL('/api/subscribe', server.url));
      expect(get.status).toBe(405);
      const body = (await get.json()) as { endpointId?: string };
      expect(body.endpointId).toBe(API_POST_ID);
    },
    30_000,
  );

  it(
    'answers 501 (JSON, naming the endpoint id) for endpoints without mocks',
    async () => {
      const dir = await mkdtemp(join(tmpdir(), 'clapp-031-mock501-'));
      scratch.push(dir);
      await writeApp(generateApp(mockPlan), dir);
      const server = await spawnApp(dir);
      servers.push(server);

      const response = await fetch(new URL('/api/subscribe', server.url), { method: 'POST' });
      expect(response.status).toBe(501);
      expect(response.headers.get('content-type')).toContain('application/json');
      expect(await response.json()).toEqual({ error: 'no mock response declared for endpoint', endpointId: API_POST_ID });
    },
    30_000,
  );

  it(
    'answers 404 for paths matching no pattern',
    async () => {
      const dir = await mkdtemp(join(tmpdir(), 'clapp-031-mock404-'));
      scratch.push(dir);
      await writeApp(generateApp(mockPlan), dir);
      const server = await spawnApp(dir);
      servers.push(server);

      for (const path of ['/api/nope', '/api/items/42/extra', '/v1/api/items/42']) {
        const response = await fetch(new URL(path, server.url));
        expect(response.status).toBe(404);
      }
    },
    30_000,
  );

  it('documents endpoints and mocks in the generated README', () => {
    const app = generateApp(mockPlan);
    const readme = app.files.find((file) => file.path === 'README.md')?.contents ?? '';
    expect(readme).toContain('`GET /api/items/:id`');
    expect(readme).toContain('`POST /api/subscribe`');
    expect(readme).toContain('FIRST mock by declaration order serves');
    expect(readme).toContain('501');
  });
});
