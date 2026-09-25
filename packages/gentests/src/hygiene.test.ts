/**
 * CLAPP-032 test battery — generated-code hygiene:
 *
 * - every generated file imports ONLY from 'bun:test' (bun stdlib) and
 *   '@clapp/journey' (never from @clapp/gentests itself);
 * - no eval, no new Function, no require(), no process.env;
 * - no http(s) origin other than the suite BASE_URL (a local server);
 * - every generated file is strict-clean TypeScript: `bun x tsc --noEmit`
 *   compiles the written suite (with the repo's strict base config) with
 *   ZERO errors — for the coverage suite AND the golden b01 suite.
 */

import { describe, expect, test } from 'bun:test';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { generateTestSuite } from './generate';
import { writeSuite } from './write-suite';
import type { GeneratedTestSuite } from './generate';
import { buildGoldenPlan, loadSeededB01Journeys } from './golden-plan';
import { baseConfigExtendsFrom, makeScratchDir, tscCompileSuite } from './test-utils';

/** Module specifiers of every import statement in a generated file. */
function importSpecifiers(contents: string): string[] {
  const out: string[] = [];
  for (const line of contents.split('\n')) {
    const match = /^import\b.*?from\s+['"]([^'"]+)['"]/.exec(line);
    if (match !== null) {
      out.push(match[1] ?? '');
    }
  }
  return out;
}

const ALLOWED_MODULES = new Set(['bun:test', '@clapp/journey']);

function assertHygiene(suite: GeneratedTestSuite, baseUrl: string): void {
  for (const file of suite.files) {
    const specifiers = importSpecifiers(file.contents);
    expect(specifiers.length).toBeGreaterThan(0);
    for (const specifier of specifiers) {
      if (!ALLOWED_MODULES.has(specifier)) {
        throw new Error(`${file.path}: forbidden import '${specifier}'`);
      }
    }
    expect(file.contents).not.toContain('@clapp/gentests');
    expect(file.contents).not.toMatch(/\beval\s*\(/);
    expect(file.contents).not.toMatch(/new\s+Function\s*\(/);
    expect(file.contents).not.toMatch(/\brequire\s*\(/);
    expect(file.contents).not.toMatch(/process\.env/);
    // The ONLY http(s) origin anywhere in the file is the suite BASE_URL.
    for (const match of file.contents.matchAll(/https?:\/\/[^\s'"`)]+/g)) {
      expect(match[0]).toBe(baseUrl);
    }
  }
}

describe('generated-code hygiene — coverage suite', () => {
  test('imports only allowed modules, no eval, no network beyond baseUrl', () => {
    const suite = generateTestSuite(structuredClone(coveragePlanForHygiene()), {
      journeyRecords: [coverageRecordForHygiene()],
    });
    assertHygiene(suite, 'http://127.0.0.1:46231/');
  });

  test(
    'compiles strict-clean with tsc (0 errors)',
    async () => {
      const suite = generateTestSuite(coveragePlanForHygiene(), {
        journeyRecords: [coverageRecordForHygiene()],
      });
      const root = await makeScratchDir('hygiene-coverage');
      try {
        await writeSuite(suite, root);
        await writeFile(
          join(root, 'tsconfig.json'),
          `${JSON.stringify({ extends: baseConfigExtendsFrom(root), include: ['*.test.ts'] }, null, 2)}\n`,
          'utf8',
        );
        const result = await tscCompileSuite(root);
        expect(result.code).toBe(0);
        expect(result.output.trim()).toBe('');
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
    150_000,
  );
});

describe('generated-code hygiene — golden b01 suite', () => {
  test('imports only allowed modules, no eval, no network beyond baseUrl', async () => {
    const plan = await buildGoldenPlan();
    const records = await loadSeededB01Journeys();
    const suite = generateTestSuite(plan, { baseUrl: 'http://127.0.0.1:46230/', journeyRecords: records });
    assertHygiene(suite, 'http://127.0.0.1:46230/');
  });

  test(
    'compiles strict-clean with tsc (0 errors)',
    async () => {
      const plan = await buildGoldenPlan();
      const records = await loadSeededB01Journeys();
      const suite = generateTestSuite(plan, {
        baseUrl: 'http://127.0.0.1:46230/',
        journeyRecords: records,
      });
      const root = await makeScratchDir('hygiene-golden');
      try {
        await writeSuite(suite, root);
        await writeFile(
          join(root, 'tsconfig.json'),
          `${JSON.stringify({ extends: baseConfigExtendsFrom(root), include: ['*.test.ts'] }, null, 2)}\n`,
          'utf8',
        );
        const result = await tscCompileSuite(root);
        expect(result.code).toBe(0);
        expect(result.output.trim()).toBe('');
        // The suite's files are exactly what was written (byte-for-byte).
        for (const file of suite.files) {
          const onDisk = await readFile(join(root, file.path), 'utf8');
          expect(onDisk).toBe(file.contents);
        }
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
    150_000,
  );
});

// ---------------------------------------------------------------------------
// Coverage-plan fixtures (same shape as generate.test.ts; duplicated here
// deliberately so each test file is self-contained).
// ---------------------------------------------------------------------------

const pp = (rationale: string) => ({
  level: 'planned' as const,
  rationale,
  sourceIds: [],
  evidenceRefs: [],
});

function coveragePlanForHygiene() {
  return {
    planVersion: '0.1',
    application: {
      id: 'appsyn_coverage_fixture',
      name: 'Coverage fixture app',
      platform: 'web' as const,
      sourceModelId: 'app_coverage_fixture',
      entrypoints: ['/'],
    },
    routes: [
      { id: 'route_home', path: '/', pageId: 'page_home', provenance: pp('home route') },
      { id: 'route_contact', path: '/contact', pageId: 'page_contact', provenance: pp('contact route') },
    ],
    pages: [
      {
        id: 'page_home',
        routeId: 'route_home',
        title: 'Home',
        provenance: pp('home page'),
        elements: [
          {
            id: 'el_home_h1',
            kind: 'heading' as const,
            role: 'heading',
            name: 'Welcome',
            text: 'Welcome',
            level: 1,
            testId: 'home-heading',
            provenance: pp('heading'),
          },
          { id: 'el_home_text', kind: 'text' as const, text: 'Hello coverage world', provenance: pp('text') },
          {
            id: 'el_home_form',
            kind: 'form' as const,
            role: 'form',
            formId: 'form_newsletter',
            provenance: pp('form placement'),
          },
        ],
        forms: [
          {
            id: 'form_newsletter',
            action: '/contact',
            method: 'get' as const,
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
            provenance: pp('newsletter form'),
          },
        ],
      },
      {
        id: 'page_contact',
        routeId: 'route_contact',
        title: 'Contact',
        provenance: pp('contact page'),
        elements: [
          {
            id: 'el_contact_h1',
            kind: 'heading' as const,
            role: 'heading',
            name: 'Contact us',
            text: 'Contact us',
            level: 1,
            testId: 'contact-heading',
            provenance: pp('heading'),
          },
        ],
        forms: [],
      },
    ],
    navigation: [],
    storage: [],
    api: {
      endpoints: [
        { id: 'api_status', method: 'GET', urlPattern: '/api/status', sourceOperationIds: [], provenance: pp('mocked') },
        { id: 'api_missing', method: 'GET', urlPattern: '/api/missing', sourceOperationIds: [], provenance: pp('unmocked') },
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
        provenance: pp('acceptance with record'),
      },
      {
        id: 'acc_missing',
        journeyId: 'journey_99999999-8888-4777-8666-555555555555',
        purpose: 'Never supplied record',
        steps: ['navigate to /contact'],
        expectedRoute: '/contact',
        mustSeeElementIds: ['el_contact_h1'],
        sourceJourneyIds: ['journey_99999999-8888-4777-8666-555555555555'],
        provenance: pp('acceptance without record'),
      },
    ],
    server: { startCommand: 'bun run start', port: 46231, healthPath: '/' },
    assumptions: [],
    constraints: [],
  };
}

function coverageRecordForHygiene() {
  return {
    id: 'journey_11111111-2222-4333-8444-555555555555',
    name: 'Coverage welcome journey',
    targetId: 'bench/coverage',
    actions: [
      { type: 'navigate' as const, url: '/' },
      { type: 'assert-visible' as const, target: { testId: 'home-heading' } },
    ],
  };
}
