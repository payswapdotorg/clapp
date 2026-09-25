/**
 * CLAPP-032 test battery — acceptance extension correctness:
 *
 * An acceptance whose must-see element LACKS a testId generates the
 * role+name assert-visible (not a fabricated testId); the extended
 * journey (record actions + appended asserts) passes validateJourney and
 * REPLAYS against a live conforming server resolving that selector.
 * Elements with neither testId nor role produce an honest comment, and
 * testId wins over role+name when both are present.
 */

import { describe, expect, test } from 'bun:test';
import { createDomApplier, replayJourney, validateJourney } from '@clapp/journey';
import type { Journey, JourneyAction, TargetSelector } from '@clapp/journey';
import { createConformingServer } from './conforming-server';
import { mustSeeSelectorFor } from './generate';
import { generateTestSuite } from './generate';
import type { ConformingServerHandle } from './conforming-server';
import type { SynthesisPlan } from './synthesis-contract';

const pp = (rationale: string) => ({
  level: 'planned' as const,
  rationale,
  sourceIds: [],
  evidenceRefs: [],
});

// A minimal plan whose expected page has: a heading WITHOUT a testId (the
// role+name case), a link WITH a testId, and a plain text element with
// neither (the honest-gap case).
const extensionPlan: SynthesisPlan = {
  planVersion: '0.1',
  application: {
    id: 'appsyn_extension_fixture',
    name: 'Extension fixture',
    platform: 'web',
    sourceModelId: 'app_extension_fixture',
    entrypoints: ['/'],
  },
  routes: [{ id: 'route_home', path: '/', pageId: 'page_home', provenance: pp('route') }],
  pages: [
    {
      id: 'page_home',
      routeId: 'route_home',
      title: 'Welcome to the shop',
      provenance: pp('page'),
      elements: [
        {
          id: 'el_home_h1',
          kind: 'heading',
          role: 'heading',
          name: 'Welcome to the shop',
          text: 'Welcome to the shop',
          level: 1,
          provenance: pp('Heading WITHOUT a testid — must select by role+name.'),
        },
        {
          id: 'el_home_link',
          kind: 'link',
          role: 'link',
          name: 'Browse the catalogue',
          text: 'Browse the catalogue',
          href: '/',
          testId: 'shop-link',
          provenance: pp('Link WITH a testid — testId must win.'),
        },
        {
          id: 'el_home_plain',
          kind: 'text',
          text: 'Just a paragraph, no testid, no role.',
          provenance: pp('Neither testId nor role — honest gap.'),
        },
      ],
      forms: [],
    },
  ],
  navigation: [],
  storage: [],
  api: { endpoints: [], mocks: [] },
  acceptance: [
    {
      id: 'acc_extension',
      journeyId: 'journey_aaaaaaa1-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      purpose: 'Land on the shop home and see the heading',
      steps: ['navigate to /', 'assert the shop link is visible'],
      expectedRoute: '/',
      mustSeeElementIds: ['el_home_h1', 'el_home_link', 'el_home_plain'],
      sourceJourneyIds: ['journey_aaaaaaa1-bbbb-4ccc-8ddd-eeeeeeeeeeee'],
      provenance: pp('Acceptance exercising the role+name fallback.'),
    },
  ],
  server: { startCommand: 'bun run start', port: 46234, healthPath: '/' },
  assumptions: [],
  constraints: [],
};

const extensionRecord: Journey = {
  id: 'journey_aaaaaaa1-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  name: 'Extension fixture journey',
  targetId: 'bench/extension',
  actions: [
    { type: 'navigate', url: '/' },
    { type: 'assert-visible', target: { testId: 'shop-link' } },
  ],
};

describe('mustSeeSelectorFor — selector derivation', () => {
  test('testId wins when present', () => {
    const element = extensionPlan.pages[0]?.elements[1];
    if (element === undefined) throw new Error('fixture element missing');
    expect(mustSeeSelectorFor(element)).toEqual({ testId: 'shop-link' });
  });

  test('role+name when the testId is absent', () => {
    const element = extensionPlan.pages[0]?.elements[0];
    if (element === undefined) throw new Error('fixture element missing');
    expect(mustSeeSelectorFor(element)).toEqual({ role: 'heading', name: 'Welcome to the shop' });
  });

  test('role-only when neither testId nor name exist (single-element roles)', () => {
    expect(
      mustSeeSelectorFor({ id: 'el_x', kind: 'other', role: 'contentinfo', provenance: pp('footer') }),
    ).toEqual({ role: 'contentinfo' });
  });

  test('null when neither testId nor role exist (honest gap)', () => {
    const element = extensionPlan.pages[0]?.elements[2];
    if (element === undefined) throw new Error('fixture element missing');
    expect(mustSeeSelectorFor(element)).toBeNull();
  });
});

describe('acceptance extension — generated code and live replay', () => {
  test('the generated acceptance file carries the role+name assert-visible', () => {
    const suite = generateTestSuite(extensionPlan, { journeyRecords: [extensionRecord] });
    const acceptanceFile = suite.files
      .find((file) => file.path === 'acceptance.test.ts')
      ?.contents ?? '';
    expect(acceptanceFile).toContain('{"role":"heading","name":"Welcome to the shop"}, // el_home_h1');
    expect(acceptanceFile).toContain('{"testId":"shop-link"}, // el_home_link');
    expect(acceptanceFile).toContain('// must-see element el_home_plain has neither a testId nor a role:');
    expect(acceptanceFile).not.toContain('{"role":"link","name":"Browse the catalogue"}');
    expect(acceptanceFile).toContain('expect(finalUrl.pathname).toBe("/")');
  });

  test('the extended journey validates and replays against the conforming server', async () => {
    const server: ConformingServerHandle = await createConformingServer(extensionPlan, { port: 0 });
    try {
      // Same extension logic the generated test performs: record actions +
      // one assert-visible per derivable must-see selector.
      const selectors: TargetSelector[] = [
        { role: 'heading', name: 'Welcome to the shop' },
        { testId: 'shop-link' },
      ];
      const extended: Journey = {
        ...extensionRecord,
        actions: [
          ...extensionRecord.actions,
          ...selectors.map((target): JourneyAction => ({ type: 'assert-visible', target })),
        ],
      };
      expect(validateJourney(extended)).toBe(true);

      let lastFetchedUrl = '';
      const fetchEcho = (async (input: URL | string, init?: RequestInit): Promise<Response> => {
        const response = await fetch(input, init);
        lastFetchedUrl = response.url !== '' ? response.url : String(input);
        return response;
      }) as typeof fetch;

      const summary = await replayJourney(extended, createDomApplier({ baseUrl: server.url, fetchImpl: fetchEcho }));
      expect(summary.journeyId).toBe(extensionRecord.id);
      expect(summary.actionsApplied).toBe(extensionRecord.actions.length + selectors.length);
      const finalUrl = new URL(lastFetchedUrl === '' ? server.url : lastFetchedUrl);
      expect(finalUrl.pathname).toBe('/');
    } finally {
      await server.close();
    }
  });

  test('a non-conforming page FAILS the extended replay (the assert is real)', async () => {
    // Drop the heading from the page: the appended role+name assert-visible
    // must throw during replay — proving must-see verification is enforced,
    // not vacuous.
    const brokenPlan: SynthesisPlan = structuredClone(extensionPlan);
    const page = brokenPlan.pages[0];
    if (page === undefined) throw new Error('fixture page missing');
    page.elements = page.elements.filter((element) => element.id !== 'el_home_h1');
    const server = await createConformingServer(brokenPlan, { port: 0 });
    try {
      const extended: Journey = {
        ...extensionRecord,
        actions: [
          ...extensionRecord.actions,
          { type: 'assert-visible', target: { role: 'heading', name: 'Welcome to the shop' } },
        ],
      };
      expect(validateJourney(extended)).toBe(true);
      await expect(
        replayJourney(extended, createDomApplier({ baseUrl: server.url })),
      ).rejects.toThrow('No element matched selector');
    } finally {
      await server.close();
    }
  });
});
