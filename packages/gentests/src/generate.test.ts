/**
 * CLAPP-032 test battery — generateTestSuite: determinism, coverage counts,
 * honest skips, input validation, and the coverage suite RUNNING clean
 * (with its skip) against its own conforming server.
 */

import { beforeAll, describe, expect, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import type { Journey } from '@clapp/journey';
import { createConformingServer } from './conforming-server';
import { GentestsError, generateTestSuite } from './generate';
import { writeSuite } from './write-suite';
import type { SynthesisPlan } from './synthesis-contract';
import { GENTESTS_ADAPTER_INFO } from './adapter-info';
import { makeScratchDir, runSubprocess } from './test-utils';

// ---------------------------------------------------------------------------
// The coverage fixture: 2 routes with elements + forms, 1 endpoint with a
// mock + 1 without, 2 acceptance entries — one with a supplied journey
// record, one without.
// ---------------------------------------------------------------------------

const COVERAGE_PORT = 46231;

const pp = (rationale: string) => ({
  level: 'planned' as const,
  rationale,
  sourceIds: [],
  evidenceRefs: [],
});

const coveragePlan: SynthesisPlan = {
  planVersion: '0.1',
  application: {
    id: 'appsyn_coverage_fixture',
    name: 'Coverage fixture app',
    platform: 'web',
    sourceModelId: 'app_coverage_fixture',
    entrypoints: ['/'],
  },
  routes: [
    { id: 'route_home', path: '/', pageId: 'page_home', provenance: pp('Coverage fixture home route.') },
    { id: 'route_contact', path: '/contact', pageId: 'page_contact', provenance: pp('Coverage fixture contact route.') },
  ],
  pages: [
    {
      id: 'page_home',
      routeId: 'route_home',
      title: 'Home',
      provenance: pp('Coverage fixture home page.'),
      elements: [
        {
          id: 'el_home_h1',
          kind: 'heading',
          role: 'heading',
          name: 'Welcome',
          text: 'Welcome',
          level: 1,
          testId: 'home-heading',
          provenance: pp('Heading with a testid.'),
        },
        { id: 'el_home_text', kind: 'text', text: 'Hello coverage world', provenance: pp('Plain text.') },
        {
          id: 'el_home_form',
          kind: 'form',
          role: 'form',
          formId: 'form_newsletter',
          provenance: pp('Newsletter form placement.'),
        },
      ],
      forms: [
        {
          id: 'form_newsletter',
          action: '/contact',
          method: 'get',
          fields: [
            {
              name: 'email',
              type: 'email',
              label: 'Email address',
              testId: 'newsletter-email',
              required: true,
              placeholder: 'you@example.com',
            },
          ],
          submitLabel: 'Subscribe',
          submitTestId: 'newsletter-submit',
          provenance: pp('Coverage fixture newsletter form.'),
        },
      ],
    },
    {
      id: 'page_contact',
      routeId: 'route_contact',
      title: 'Contact',
      provenance: pp('Coverage fixture contact page.'),
      elements: [
        {
          id: 'el_contact_h1',
          kind: 'heading',
          role: 'heading',
          name: 'Contact us',
          text: 'Contact us',
          level: 1,
          testId: 'contact-heading',
          provenance: pp('Heading with a testid.'),
        },
      ],
      forms: [],
    },
  ],
  navigation: [],
  storage: [],
  api: {
    endpoints: [
      { id: 'api_status', method: 'GET', urlPattern: '/api/status', sourceOperationIds: [], provenance: pp('Mocked endpoint.') },
      { id: 'api_missing', method: 'GET', urlPattern: '/api/missing', sourceOperationIds: [], provenance: pp('Unmocked endpoint.') },
    ],
    mocks: [{ id: 'mock_status', endpointId: 'api_status', statusCode: 200, bodyJson: { ok: true } }],
  },
  acceptance: [
    {
      id: 'acc_welcome',
      journeyId: 'journey_11111111-2222-4333-8444-555555555555',
      purpose: 'Open home and see the heading',
      steps: ['navigate to /', 'assert the home heading is visible'],
      expectedRoute: '/',
      mustSeeElementIds: ['el_home_h1'],
      sourceJourneyIds: ['journey_11111111-2222-4333-8444-555555555555'],
      provenance: pp('Acceptance with a supplied record.'),
    },
    {
      id: 'acc_missing',
      journeyId: 'journey_99999999-8888-4777-8666-555555555555',
      purpose: 'An acceptance whose journey record is never supplied',
      steps: ['navigate to /contact'],
      expectedRoute: '/contact',
      mustSeeElementIds: ['el_contact_h1'],
      sourceJourneyIds: ['journey_99999999-8888-4777-8666-555555555555'],
      provenance: pp('Acceptance without a record — must be skipped honestly.'),
    },
  ],
  server: { startCommand: 'bun run start', port: COVERAGE_PORT, healthPath: '/' },
  assumptions: [],
  constraints: [],
};

const coverageRecord: Journey = {
  id: 'journey_11111111-2222-4333-8444-555555555555',
  name: 'Coverage welcome journey',
  targetId: 'bench/coverage',
  actions: [
    { type: 'navigate', url: '/' },
    { type: 'assert-visible', target: { testId: 'home-heading' } },
  ],
};

const unreferencedRecord: Journey = {
  id: 'journey_77777777-6666-4555-8444-333333333333',
  name: 'Never referenced by any acceptance entry',
  targetId: 'bench/coverage',
  actions: [{ type: 'navigate', url: '/' }],
};

// ---------------------------------------------------------------------------

let acceptanceFile = '';
let routesFile = '';
let apiFile = '';

beforeAll(() => {
  const suite = generateTestSuite(coveragePlan, { journeyRecords: [coverageRecord] });
  acceptanceFile = suite.files.find((file) => file.path === 'acceptance.test.ts')?.contents ?? '';
  routesFile = suite.files.find((file) => file.path === 'routes.test.ts')?.contents ?? '';
  apiFile = suite.files.find((file) => file.path === 'api.test.ts')?.contents ?? '';
});

describe('generateTestSuite — manifest and coverage', () => {
  test('manifest counts are exact for the coverage plan', () => {
    const suite = generateTestSuite(coveragePlan, { journeyRecords: [coverageRecord] });
    expect(suite.manifest.testCount).toBe(7);
    expect(suite.manifest.routeTestCount).toBe(3); // 2 routes + 1 health
    expect(suite.manifest.apiTestCount).toBe(2); // 1 mocked + 1 unmocked
    expect(suite.manifest.acceptanceTestCount).toBe(2); // 1 replay + 1 skip
    expect(suite.manifest.skippedAcceptanceIds).toEqual(['acc_missing']);
  });

  test('emits exactly routes/api/acceptance files', () => {
    const suite = generateTestSuite(coveragePlan, { journeyRecords: [coverageRecord] });
    expect(suite.files.map((file) => file.path)).toEqual([
      'routes.test.ts',
      'api.test.ts',
      'acceptance.test.ts',
    ]);
  });

  test('the without-record acceptance lands in it.skip, the other replays', () => {
    expect(acceptanceFile).toContain('it.skip(');
    expect(acceptanceFile).toContain('acc_missing');
    expect(acceptanceFile).toContain('journey_99999999-8888-4777-8666-555555555555');
    expect(acceptanceFile).toContain('replayJourney(extended, createDomApplier');
    expect(acceptanceFile).toContain("journey_11111111-2222-4333-8444-555555555555");
  });

  test('route tests check status, content type, testids, headings, labels', () => {
    expect(routesFile).toContain('fetch(new URL("/", BASE_URL))');
    expect(routesFile).toContain('data-testid=\\"home-heading\\"');
    expect(routesFile).toContain('Welcome');
    expect(routesFile).toContain('Email address');
    expect(routesFile).toContain('fetch(new URL("/contact", BASE_URL))');
    expect(routesFile).toContain('server health');
  });

  test('api tests check the mocked endpoint exactly and the unmocked 501', () => {
    expect(apiFile).toContain('fetch(new URL("/api/status", BASE_URL), { method: "GET" })');
    expect(apiFile).toContain('expect(await first.json()).toEqual({');
    expect(apiFile).toContain('"ok": true');
    expect(apiFile).toContain('fetch(new URL("/api/missing", BASE_URL), { method: "GET" })');
    expect(apiFile).toContain('expect(response.status).toBe(501);');
    expect(apiFile).toContain('api_missing');
  });

  test('records not referenced by any acceptance entry are ignored', () => {
    const suite = generateTestSuite(coveragePlan, { journeyRecords: [unreferencedRecord] });
    expect(suite.manifest.acceptanceTestCount).toBe(2);
    expect(suite.manifest.skippedAcceptanceIds).toEqual(['acc_welcome', 'acc_missing']);
  });
});

describe('generateTestSuite — determinism', () => {
  test('same plan literal → byte-identical generated files (two calls)', async () => {
    const first = generateTestSuite(coveragePlan, { journeyRecords: [coverageRecord] });
    const second = generateTestSuite(coveragePlan, { journeyRecords: [coverageRecord] });
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  test('deep-cloned inputs generate byte-identical files (no hidden state)', async () => {
    const first = generateTestSuite(coveragePlan, { journeyRecords: [coverageRecord] });
    const second = generateTestSuite(structuredClone(coveragePlan), {
      journeyRecords: [structuredClone(coverageRecord)],
    });
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});

describe('generateTestSuite — options', () => {
  test('baseUrl defaults to the plan server spec port', () => {
    generateTestSuite(coveragePlan, { journeyRecords: [coverageRecord] });
    expect(routesFile).toContain(`http://127.0.0.1:${COVERAGE_PORT}/`);
    expect(acceptanceFile).toContain(`http://127.0.0.1:${COVERAGE_PORT}/`);
  });

  test('baseUrl overrides the plan server spec in every generated file', () => {
    const suite = generateTestSuite(coveragePlan, {
      baseUrl: 'http://127.0.0.1:9',
      journeyRecords: [coverageRecord],
    });
    const all = suite.files.map((file) => file.contents).join('\n');
    expect(all).toContain('"http://127.0.0.1:9/"');
    expect(all).not.toContain(String(COVERAGE_PORT));
  });

  test('suiteName lands in the describe labels', () => {
    const suite = generateTestSuite(coveragePlan, {
      suiteName: 'gate-42',
      journeyRecords: [coverageRecord],
    });
    const all = suite.files.map((file) => file.contents).join('\n');
    expect(all).toContain('routes — gate-42');
    expect(all).toContain('api — gate-42');
    expect(all).toContain('acceptance — gate-42');
  });
});

describe('generateTestSuite — input validation', () => {
  test('throws on a planVersion mismatch', () => {
    const bad = structuredClone(coveragePlan);
    bad.planVersion = '0.2';
    expect(() => generateTestSuite(bad)).toThrow(GentestsError);
    expect(() => generateTestSuite(bad)).toThrow('plan.planVersion');
  });

  test('throws on duplicate route paths', () => {
    const bad = structuredClone(coveragePlan);
    bad.routes.push({ id: 'route_dup', path: '/contact/', pageId: 'page_contact', provenance: pp('dup') });
    expect(() => generateTestSuite(bad)).toThrow(GentestsError);
    expect(() => generateTestSuite(bad)).toThrow('duplicate planned route path');
  });

  test('throws on a structurally invalid journey record', () => {
    const bad = structuredClone(coverageRecord) as unknown as { actions: unknown };
    bad.actions = 'not-actions';
    expect(() =>
      generateTestSuite(coveragePlan, { journeyRecords: [bad as unknown as Journey] }),
    ).toThrow(GentestsError);
    expect(() =>
      generateTestSuite(coveragePlan, { journeyRecords: [bad as unknown as Journey] }),
    ).toThrow('invalid journey');
  });

  test('throws on duplicate journey record ids', () => {
    expect(() =>
      generateTestSuite(coveragePlan, { journeyRecords: [coverageRecord, structuredClone(coverageRecord)] }),
    ).toThrow(GentestsError);
    expect(() =>
      generateTestSuite(coveragePlan, { journeyRecords: [coverageRecord, structuredClone(coverageRecord)] }),
    ).toThrow('duplicate journey id');
  });
});

describe('generateTestSuite — coverage suite runs clean against its conforming server', () => {
  test(
    'the full generated suite passes with the honest skip (subprocess)',
    async () => {
      const server = await createConformingServer(coveragePlan, { port: 0 });
      const suite = generateTestSuite(coveragePlan, {
        baseUrl: server.url,
        journeyRecords: [coverageRecord],
      });
      expect(suite.manifest.testCount).toBe(7);
      const root = await makeScratchDir('coverage-run');
      try {
        await writeSuite(suite, root);
        const result = await runSubprocess(process.execPath, ['test'], { cwd: root, timeoutMs: 90_000 });
        expect(result.code).toBe(0);
        expect(result.output).toContain('6 pass');
        expect(result.output).toContain('1 skip');
        expect(result.output).toContain('0 fail');
        expect(result.output).toContain('Ran 7 tests across 3 files');
      } finally {
        await server.close();
        await rm(root, { recursive: true, force: true });
      }
    },
    120_000,
  );
});

describe('GENTESTS_ADAPTER_INFO — honesty summary', () => {
  test('declares its capabilities and unsupported constructs', () => {
    expect(GENTESTS_ADAPTER_INFO.adapterId).toContain('@clapp/gentests');
    expect(GENTESTS_ADAPTER_INFO.supportedModelVersions).toEqual(['0.1']);
    expect(GENTESTS_ADAPTER_INFO.emittedCapabilities.length).toBeGreaterThan(0);
    expect(GENTESTS_ADAPTER_INFO.unsupportedConstructs.length).toBeGreaterThan(0);
    expect(GENTESTS_ADAPTER_INFO.unsupportedConstructs.join('\n')).toContain('plan.storage');
    expect(GENTESTS_ADAPTER_INFO.degradationBehavior).not.toBe('');
  });
});
