/**
 * CLAPP-012 test battery — the bench-b01 fixture corpus and seeded journeys.
 *
 * B01 scope (docs/WEB_BENCHMARKS.md): navigation, responsive layout, forms,
 * links, media/assets — verified here by inventory, parseability, hygiene
 * (one h1, title, viewport, lang), link integrity, ZERO external network
 * references, and seeded-journey validity (including testId cross-checks).
 */

import { describe, expect, it } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseHtml } from './minidom';
import { createDomApplier, replayJourney } from './replayer';
import { resolveFixtureRoot, resolveSeededJourneysDir, startFixtureServer } from './fixtures/server';
import { validateJourney } from './validate';
import type { Journey } from './journey-contract';

const corpusRoot = resolveFixtureRoot();
const journeysRoot = resolveSeededJourneysDir();
const journeyFiles = readdirSync(journeysRoot)
  .filter((name) => name.endsWith('.json'))
  .sort();

const PAGES = [
  'index.html',
  'features.html',
  'pricing.html',
  'contact.html',
  'contact-success.html',
  'newsletter-success.html',
];

const ASSETS = [
  'assets/styles.css',
  'assets/app.js',
  'assets/logo.svg',
  'assets/hero.svg',
];

function readCorpus(relative: string): string {
  return readFileSync(join(corpusRoot, relative), 'utf8');
}

function pageElements(page: string): string[] {
  return [...parseHtml(readCorpus(page)).root.walk()].map((element) => element.tagName);
}

describe('corpus — inventory', () => {
  it('contains every expected page and asset', () => {
    for (const file of [...PAGES, ...ASSETS]) {
      expect(existsSync(join(corpusRoot, file))).toBe(true);
    }
    expect(PAGES.length).toBeGreaterThanOrEqual(4); // work item minimum
  });

  it('contains at least one SVG asset, one stylesheet, and one script', () => {
    const assets = readdirSync(join(corpusRoot, 'assets'));
    expect(assets.filter((file) => file.endsWith('.svg')).length).toBeGreaterThanOrEqual(1);
    expect(assets).toContain('styles.css');
    expect(assets).toContain('app.js');
  });

  it('holds only expected fixture entries (no stray files)', () => {
    const top = readdirSync(corpusRoot).sort();
    expect(top).toEqual(['assets', ...PAGES].sort());
  });
});

describe('corpus — HTML hygiene (every page)', () => {
  for (const page of PAGES) {
    it(`${page}: doctype, lang, title, viewport, exactly one h1`, () => {
      const raw = readCorpus(page);
      expect(raw.trimStart().toLowerCase().startsWith('<!doctype html>')).toBe(true);
      const doc = parseHtml(raw);
      const tags = pageElements(page);
      expect(tags.filter((tag) => tag === 'html')).toHaveLength(1);
      const html = [...doc.root.walk()].find((element) => element.tagName === 'html');
      expect(html?.getAttribute('lang')).toBe('en');
      const title = [...doc.root.walk()].find((element) => element.tagName === 'title');
      expect(title?.textContent.trim()).not.toBe('');
      const viewport = [...doc.root.walk()].find(
        (element) =>
          element.tagName === 'meta' && element.getAttribute('name') === 'viewport',
      );
      expect(viewport?.getAttribute('content')).toContain('width=device-width');
      expect(tags.filter((tag) => tag === 'h1')).toHaveLength(1);
      expect(tags).toContain('main');
    });

    it(`${page}: carries the shared header nav and footer`, () => {
      const raw = readCorpus(page);
      const doc = parseHtml(raw);
      const header = [...doc.root.walk()].find((element) => element.tagName === 'header');
      expect(header?.getAttribute('class')).toContain('site-header');
      const nav = [...doc.root.walk()].find(
        (element) => element.tagName === 'nav' && element.getAttribute('aria-label') === 'Main',
      );
      expect(nav).toBeDefined();
      const footer = [...doc.root.walk()].find((element) => element.tagName === 'footer');
      expect(footer?.getAttribute('class')).toContain('site-footer');
    });
  }

  it('styles.css implements responsive rules (@media) and uses system fonts', () => {
    const css = readCorpus('assets/styles.css');
    expect(css).toMatch(/@media\s*\(max-width:/);
    expect(css).toMatch(/@media\s*\(min-width:/);
    expect(css).toMatch(/grid-template-columns/);
    expect(css).toMatch(/system-ui/);
  });

  it('app.js is a self-contained progressive-enhancement script', () => {
    const js = readCorpus('assets/app.js');
    expect(js).not.toMatch(/\bimport\b/);
    expect(js).not.toMatch(/\bfetch\s*\(/);
    expect(js).toContain('nav-open');
  });

  it('SVG assets carry viewBox and no external references', () => {
    for (const svg of ['assets/logo.svg', 'assets/hero.svg']) {
      const content = readCorpus(svg);
      expect(content).toContain('<svg');
      expect(content).toContain('viewBox=');
    }
  });
});

describe('corpus — self-containment (zero external network references)', () => {
  const ALL_FILES = [...PAGES, ...ASSETS];

  it('no absolute http(s) URLs or protocol-relative refs anywhere (xmlns stripped)', () => {
    for (const file of ALL_FILES) {
      const stripped = readCorpus(file).replace(/\sxmlns(?::[\w-]+)?\s*=\s*"[^"]*"/g, '');
      expect(stripped).not.toMatch(/https?:\/\//i);
      expect(stripped).not.toMatch(/(?:src|href)\s*=\s*["']\s*(?:https?:)?\/\//i);
    }
  });

  it('the stylesheet has no @import and no external url(...) references', () => {
    const css = readCorpus('assets/styles.css');
    expect(css).not.toMatch(/@import/i);
    expect(css).not.toMatch(/url\(\s*["']?\s*(?:https?:)?\/\//i);
  });
});

describe('corpus — link integrity', () => {
  it('every internal href/src resolves to a file in the corpus', () => {
    for (const page of PAGES) {
      const doc = parseHtml(readCorpus(page));
      for (const element of doc.root.walk()) {
        const reference = element.getAttribute('href') ?? element.getAttribute('src');
        if (reference === null) continue;
        if (reference.startsWith('#') || reference.startsWith('mailto:')) continue;
        const clean = reference.split('?')[0]?.split('#')[0] ?? '';
        expect(clean).not.toBe('');
        const target = resolve(corpusRoot, join(dirname(page), clean));
        expect(existsSync(target)).toBe(true);
      }
    }
  });

  it('every navigate URL in every seeded journey resolves to a corpus file', () => {
    for (const file of readdirSync(journeysRoot).filter((name) => name.endsWith('.json'))) {
      const journey = JSON.parse(readFileSync(join(journeysRoot, file), 'utf8')) as Journey;
      for (const action of journey.actions) {
        if (action.type !== 'navigate') continue;
        const clean = action.url.split('?')[0]?.split('#')[0] ?? '';
        const target = resolve(corpusRoot, `.${clean === '' ? '/' : clean}`);
        expect(existsSync(target)).toBe(true);
      }
    }
  });
});

describe('seeded journeys', () => {
  it('at least three seeded journeys exist', () => {
    expect(journeyFiles.length).toBeGreaterThanOrEqual(3);
  });

  it('every seeded journey passes validateJourney', () => {
    for (const file of journeyFiles) {
      const journey: unknown = JSON.parse(readFileSync(join(journeysRoot, file), 'utf8'));
      expect(validateJourney(journey)).toBe(true);
    }
  });

  it('journeys target bench/b01-static, have unique ids, names, and a navigate action', () => {
    const ids = new Set<string>();
    const names = new Set<string>();
    for (const file of journeyFiles) {
      const journey = JSON.parse(readFileSync(join(journeysRoot, file), 'utf8')) as Journey;
      expect(journey.targetId).toBe('bench/b01-static');
      expect(journey.actions.some((action) => action.type === 'navigate')).toBe(true);
      expect(journey.actions.length).toBeGreaterThan(0);
      expect(ids.has(journey.id)).toBe(false);
      expect(names.has(journey.name)).toBe(false);
      ids.add(journey.id);
      names.add(journey.name);
    }
  });

  it('every testId referenced by a journey exists in the corpus', () => {
    const corpusTestIds = new Set<string>();
    for (const page of PAGES) {
      for (const element of parseHtml(readCorpus(page)).root.walk()) {
        const testId = element.getAttribute('data-testid');
        if (testId !== null) corpusTestIds.add(testId);
      }
    }
    const usedTestIds = new Set<string>();
    for (const file of journeyFiles) {
      const journey = JSON.parse(readFileSync(join(journeysRoot, file), 'utf8')) as Journey;
      for (const action of journey.actions) {
        if (action.type === 'click' || action.type === 'fill' || action.type === 'assert-visible') {
          if (action.target.testId !== undefined) usedTestIds.add(action.target.testId);
        }
      }
    }
    expect(corpusTestIds.size).toBeGreaterThan(0);
    for (const testId of usedTestIds) {
      expect(corpusTestIds.has(testId)).toBe(true);
    }
  });
});

describe('corpus + journeys — real-server smoke replay', () => {
  it('every seeded journey replays cleanly against the in-process fixture server', async () => {
    const server = await startFixtureServer({ root: corpusRoot });
    try {
      for (const file of journeyFiles) {
        const journey = JSON.parse(readFileSync(join(journeysRoot, file), 'utf8')) as Journey;
        const summary = await replayJourney(
          journey,
          createDomApplier({ baseUrl: server.url }),
        );
        expect(summary.actionsApplied).toBe(journey.actions.length);
      }
    } finally {
      await server.close();
    }
  }, 20_000);
});
