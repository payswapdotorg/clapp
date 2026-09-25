/**
 * CLAPP-032 test battery — the minimal conforming server: route serving,
 * 404/405 policies, health path, mock sequencing (declaration order, last
 * repeats), 501 semantics, POST-to-route (form action) support, and the
 * PORT override.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createConformingServer } from './conforming-server';
import type { ConformingServerHandle } from './conforming-server';
import { GOLDEN_PLAN_PORT, buildGoldenPlan } from './golden-plan';
import type { SynthesisPlan } from './synthesis-contract';

const pp = (rationale: string) => ({
  level: 'planned' as const,
  rationale,
  sourceIds: [],
  evidenceRefs: [],
});

let plan: SynthesisPlan;
let server: ConformingServerHandle;

beforeAll(async () => {
  plan = await buildGoldenPlan();
  server = await createConformingServer(plan, { port: 0 });
});

afterAll(async () => {
  await server.close();
});

describe('conforming server — planned routes serve conforming HTML', () => {
  test('home page: heading text, testids, form labels, semantic tags', async () => {
    const response = await fetch(new URL('/', server.url));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    const body = await response.text();
    expect(body).toContain('<h1 data-testid="hero-heading">Capture every idea, calmly</h1>');
    expect(body).toContain('data-testid="nav-features"');
    expect(body).toContain('data-testid="newsletter-email"');
    expect(body).toContain('<footer');
    expect(body).toContain('<nav aria-label="Main">');
    expect(body).toContain('alt="Illustration of notes organized among clouds"');
    expect(body).toContain('<label for="form_newsletter-email">Email address</label>');
    expect(body).toContain('<button type="submit" data-testid="newsletter-submit">Subscribe</button>');
    expect(body).toContain('<title>Capture every idea, calmly — Nimbus Notes</title>');
  });

  test('contact page: the contact form with all fields and options', async () => {
    const response = await fetch(new URL('/contact.html', server.url));
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('<form data-testid="contact-form" action="/contact-success.html" method="get">');
    expect(body).toContain('<select id="form_contact-topic" name="topic" data-testid="contact-topic">');
    expect(body).toContain('<option value="general" selected>');
    expect(body).toContain('<textarea id="form_contact-message"');
    expect(body).toContain('<button type="submit" data-testid="contact-submit">Send message</button>');
  });

  test('unknown route → 404 (HTML page with a not-found testid)', async () => {
    const response = await fetch(new URL('/definitely-not-planned', server.url));
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('text/html');
    const body = await response.text();
    expect(body).toContain('data-testid="not-found"');
  });

  test('wrong method on a route → 405', async () => {
    const response = await fetch(new URL('/', server.url), { method: 'PUT' });
    expect(response.status).toBe(405);
  });

  test('POST to a route re-renders the page (plans may point form actions at routes)', async () => {
    const response = await fetch(new URL('/contact.html', server.url), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body: 'name=Ada&topic=general',
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    const body = await response.text();
    expect(body).toContain("We'd love to hear from you");
  });

  test('trailing slash tolerance on routes', async () => {
    const response = await fetch(new URL('/contact.html/', server.url));
    expect(response.status).toBe(200);
  });
});

describe('conforming server — health path', () => {
  test('the plan health path answers 200', async () => {
    const response = await fetch(new URL('/', server.url));
    expect(response.status).toBe(200);
  });

  test('a non-route health path answers 200 ok', async () => {
    const healthPlan: SynthesisPlan = {
      planVersion: '0.1',
      application: {
        id: 'appsyn_health_fixture',
        name: 'Health fixture',
        platform: 'web',
        sourceModelId: 'app_health_fixture',
        entrypoints: ['/'],
      },
      routes: [{ id: 'route_home', path: '/', pageId: 'page_home', provenance: pp('route') }],
      pages: [
        {
          id: 'page_home',
          routeId: 'route_home',
          title: 'Home',
          provenance: pp('page'),
          elements: [],
          forms: [],
        },
      ],
      navigation: [],
      storage: [],
      api: { endpoints: [], mocks: [] },
      acceptance: [],
      server: { startCommand: 'bun run start', port: 46232, healthPath: '/healthz' },
      assumptions: [],
      constraints: [],
    };
    const healthServer = await createConformingServer(healthPlan, { port: 0 });
    try {
      const ok = await fetch(new URL('/healthz', healthServer.url));
      expect(ok.status).toBe(200);
      expect(await ok.text()).toContain('ok');
      const notFound = await fetch(new URL('/healthz/sub', healthServer.url));
      expect(notFound.status).toBe(404);
    } finally {
      await healthServer.close();
    }
  });
});

describe('conforming server — API endpoints', () => {
  test('mocked endpoint answers statusCode + exact JSON body', async () => {
    const response = await fetch(new URL('/api/notes', server.url));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual({
      ok: true,
      notes: [{ id: 'n1', title: 'First note' }, { id: 'n2', title: 'Second note' }],
    });
  });

  test('parameterized endpoint without mocks → 501 naming the endpoint', async () => {
    const response = await fetch(new URL('/api/items/test-id', server.url));
    expect(response.status).toBe(501);
    const body = await response.text();
    expect(body).toContain('api_item');
    expect(body).toContain('/api/items/:id');
  });

  test('wrong method on an endpoint → 405', async () => {
    const response = await fetch(new URL('/api/notes', server.url), { method: 'DELETE' });
    expect(response.status).toBe(405);
    const body = await response.text();
    expect(body).toContain('api_notes');
  });

  test('mocks are consumed in declaration order and the last repeats', async () => {
    const sequencePlan: SynthesisPlan = {
      planVersion: '0.1',
      application: {
        id: 'appsyn_sequence_fixture',
        name: 'Sequence fixture',
        platform: 'web',
        sourceModelId: 'app_sequence_fixture',
        entrypoints: ['/'],
      },
      routes: [],
      pages: [],
      navigation: [],
      storage: [],
      api: {
        endpoints: [
          { id: 'api_seq', method: 'GET', urlPattern: '/api/seq', sourceOperationIds: [], provenance: pp('seq') },
        ],
        mocks: [
          { id: 'mock_seq_1', endpointId: 'api_seq', statusCode: 200, bodyJson: { step: 1 } },
          { id: 'mock_seq_2', endpointId: 'api_seq', statusCode: 200, bodyJson: { step: 2 } },
        ],
      },
      acceptance: [],
      server: { startCommand: 'bun run start', port: 46233, healthPath: '/healthz' },
      assumptions: [],
      constraints: [],
    };
    const seqServer = await createConformingServer(sequencePlan, { port: 0 });
    try {
      expect(await (await fetch(new URL('/api/seq', seqServer.url))).json()).toEqual({ step: 1 });
      expect(await (await fetch(new URL('/api/seq', seqServer.url))).json()).toEqual({ step: 2 });
      expect(await (await fetch(new URL('/api/seq', seqServer.url))).json()).toEqual({ step: 2 });
    } finally {
      await seqServer.close();
    }
  });
});

describe('conforming server — port handling', () => {
  test('PORT override honored (url reflects the requested port)', async () => {
    // A few candidates are tried so a busy port on this machine cannot make
    // the test flaky; whichever binds, the URL must reflect THE requested one.
    const candidates = [46017, 46018, 46019];
    let bound: ConformingServerHandle | undefined;
    let requested = -1;
    for (const port of candidates) {
      try {
        bound = await createConformingServer(plan, { port });
        requested = port;
        break;
      } catch {
        // EADDRINUSE — try the next candidate.
      }
    }
    expect(bound).toBeDefined();
    if (bound !== undefined) {
      try {
        expect(bound.url).toBe(`http://127.0.0.1:${requested}/`);
        const response = await fetch(new URL('/', bound.url));
        expect(response.status).toBe(200);
      } finally {
        await bound.close();
      }
    }
  });

  test('default port comes from the plan server spec', async () => {
    const defaultPortServer = await createConformingServer(plan);
    try {
      expect(defaultPortServer.url).toBe(`http://127.0.0.1:${GOLDEN_PLAN_PORT}/`);
    } finally {
      await defaultPortServer.close();
    }
  });
});
