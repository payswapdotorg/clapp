/**
 * @clapp/codegen tests — structural battery (CLAPP-031).
 *
 * Render-level coverage: pages without forms, elements without testIds,
 * select/radio/checkbox/hidden fields, escaping, href fallbacks, list
 * rendering, landmark grouping, redirect transitions (no rendered
 * trigger), the GenerateOptions port override, and the defensive checks
 * generateApp throws on.
 */

import { describe, expect, it } from 'bun:test';
import { generateApp, renderPageHtml } from '../src/index';
import type { PlannedElement, PlannedPage } from '../src/synthesis-contract';
import { headingInit, makePlan, testRouteId } from './helpers/plans';

function generatedHtml(plan: ReturnType<typeof makePlan>, routeSlug: string): string {
  const app = generateApp(plan);
  const file = app.files.find((candidate) => candidate.path === `pages/${routeSlug}.html.ts`);
  if (file === undefined) {
    throw new Error(`no page module ${routeSlug}`);
  }
  return file.contents;
}

describe('structural — pages without forms', () => {
  it('renders no form and the README says so', () => {
    const plan = makePlan({ pages: [{ path: '/', title: 'Bare', elements: [headingInit('Just a heading')] }] });
    const app = generateApp(plan);
    const html = app.files.find((file) => file.path === 'pages/index.html.ts')?.contents ?? '';
    expect(html).not.toContain('<form');
    expect(html).not.toContain('<button');
    const readme = app.files.find((file) => file.path === 'README.md')?.contents ?? '';
    expect(readme).toContain('(no planned forms)');
  });
});

describe('structural — elements without testIds', () => {
  it('renders no data-testid attribute anywhere', () => {
    const plan = makePlan({
      pages: [
        {
          path: '/',
          title: 'Plain',
          elements: [
            { kind: 'heading', level: 1, text: 'Plain page' },
            { kind: 'text', text: 'No testids here.' },
            { kind: 'link', text: 'Go', href: '/' },
          ],
        },
      ],
    });
    const html = generatedHtml(plan, 'index');
    expect(html).not.toContain('data-testid');
    expect(html).toContain('<a href="/">Go</a>');
  });
});

describe('structural — field variants', () => {
  const formPlan = makePlan({
    pages: [
      {
        path: '/',
        title: 'Fields',
        elements: [
          headingInit('Fields'),
          { kind: 'form', formId: 'form_00000000-0000-4000-8000-000000000000' },
        ],
        forms: [
          {
            action: '/submit',
            method: 'post',
            fields: [
              { name: 'plan', type: 'select', label: 'Plan', options: [{ value: 'free', label: 'Free' }, { value: 'pro', label: 'Pro' }] },
              { name: 'tier', type: 'radio', label: 'Tier', options: [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }] },
              { name: 'agree', type: 'checkbox', label: 'I agree' },
              { name: 'ref', type: 'hidden', label: 'Ref' },
              { name: 'notes', type: 'textarea', label: 'Notes' },
            ],
            submitLabel: 'Go',
          },
        ],
      },
    ],
  });

  it('select renders its options with the first selected', () => {
    const html = generatedHtml(formPlan, 'index');
    expect(html).toContain('<select id="form_00000000-0000-4000-8000-000000000000-plan" name="plan">');
    expect(html).not.toContain('type="select"');
    expect(html).toContain('<option value="free" selected>Free</option>');
    expect(html).toContain('<option value="pro">Pro</option>');
  });

  it('radio renders one labeled input per option, first checked', () => {
    const html = generatedHtml(formPlan, 'index');
    expect(html).toContain('type="radio"');
    expect((html.match(/type="radio"/g) ?? []).length).toBe(2);
    expect(html).toContain('name="tier"');
    expect(html).toContain('value="a"');
    expect(html).toContain('value="b"');
    expect(html).toContain('<input id="form_00000000-0000-4000-8000-000000000000-tier-a" name="tier" type="radio" value="a" checked>');
    expect(html).toContain('<label for="form_00000000-0000-4000-8000-000000000000-tier-a">Alpha</label>');
  });

  it('checkbox renders unchecked, hidden renders bare, textarea renders closed', () => {
    const html = generatedHtml(formPlan, 'index');
    // The checkbox input carries no checked attribute (plan carries no state).
    expect(html).toContain('name="agree" type="checkbox">');
    expect(html).toMatch(/<input id="[^"]+" name="ref" type="hidden">/);
    expect(html).toContain('name="notes"');
    expect(html).toContain('></textarea>');
    // Hidden fields have no label pairing.
    expect(html).not.toContain('>Ref</label>');
  });
});

describe('structural — escaping and fallbacks', () => {
  it('escapes text and attribute content', () => {
    const plan = makePlan({
      pages: [
        {
          path: '/',
          title: 'A <b> "quoted" & title',
          elements: [
            { kind: 'heading', level: 2, text: '5 < 6 & "seven" > 4' },
            { kind: 'image', alt: 'An "alt" & <tag>' },
            { kind: 'link', name: 'Name with "quotes" & <angles>', text: 'Link', href: '/x?a=1&b=2' },
          ],
        },
      ],
    });
    const html = generatedHtml(plan, 'index');
    expect(html).toContain('<title>A &lt;b&gt; "quoted" &amp; title</title>');
    expect(html).toContain('<h2>5 &lt; 6 &amp; "seven" &gt; 4</h2>');
    expect(html).toContain('alt="An &quot;alt&quot; &amp; &lt;tag&gt;"');
    // Ampersands in attribute values are escaped (&amp;); minidom decodes
    // them back on parse, so hrefs round-trip unchanged.
    expect(html).toContain('href="/x?a=1&amp;b=2"');
    expect(html).toContain('aria-label="Name with &quot;quotes&quot; &amp; &lt;angles&gt;"');
  });

  it('falls back to href="#" for links without href, h2 for headings without level', () => {
    const plan = makePlan({
      pages: [{ path: '/', title: 'Fallbacks', elements: [{ kind: 'link', text: 'Dead end' }, { kind: 'heading', text: 'Untitled level' }] }],
    });
    const html = generatedHtml(plan, 'index');
    expect(html).toContain('<a href="#">Dead end</a>');
    expect(html).toContain('<h2>Untitled level</h2>');
  });

  it('renders one li per text line and skips empty lines', () => {
    const plan = makePlan({
      pages: [{ path: '/', title: 'Lists', elements: [{ kind: 'list', text: 'one\ntwo\n\nthree' }] }],
    });
    const html = generatedHtml(plan, 'index');
    expect((html.match(/<li>/g) ?? []).length).toBe(3);
    expect(html).toContain('<li>three</li>');
  });
});

describe('structural — landmark grouping and nav absorption', () => {
  it('groups elements into header/main/footer and nav children', () => {
    const prov = { level: 'planned' as const, rationale: 'r', sourceIds: [], evidenceRefs: [] };
    let seq = 0;
    const e = (init: Omit<PlannedElement, 'id' | 'provenance'>): PlannedElement => ({
      id: `el_00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`,
      ...init,
      provenance: prov,
    });
    const page: PlannedPage = {
      id: 'page_00000000-0000-4000-8000-000000000001',
      routeId: 'route_00000000-0000-4000-8000-000000000001',
      title: 'Structure',
      elements: [
        e({ kind: 'other', role: 'banner' }),
        e({ kind: 'link', text: 'Logo', href: '/' }),
        e({ kind: 'navigation', name: 'Main' }),
        e({ kind: 'link', text: 'A', href: '/a' }),
        e({ kind: 'link', text: 'B', href: '/b' }),
        e({ kind: 'text', text: 'Loose text between nav and main stops nav absorption.' }),
        e({ kind: 'other', role: 'main' }),
        e({ kind: 'heading', level: 1, text: 'Inside main' }),
        e({ kind: 'other', role: 'contentinfo' }),
        e({ kind: 'text', text: 'Footer text' }),
      ],
      forms: [],
      provenance: prov,
    };
    const html = renderPageHtml(page);
    const headerStart = html.indexOf('<header>');
    const navStart = html.indexOf('<nav aria-label="Main">');
    const linkA = html.indexOf('<a href="/a">A</a>');
    const linkB = html.indexOf('<a href="/b">B</a>');
    const navEnd = html.indexOf('</nav>');
    const mainStart = html.indexOf('<main>');
    const footerStart = html.indexOf('<footer>');
    expect(headerStart).toBeGreaterThan(-1);
    expect(navStart).toBeGreaterThan(headerStart);
    expect(linkA).toBeGreaterThan(navStart);
    expect(linkB).toBeGreaterThan(linkA);
    expect(navEnd).toBeGreaterThan(linkB);
    expect(html.indexOf('Loose text between')).toBeGreaterThan(navEnd);
    expect(mainStart).toBeGreaterThan(html.indexOf('Loose text between'));
    expect(html.indexOf('<h1>Inside main</h1>')).toBeGreaterThan(mainStart);
    expect(footerStart).toBeGreaterThan(mainStart);
    expect(html.indexOf('<p>Footer text</p>')).toBeGreaterThan(footerStart);
  });

  it('emits an explicit role attribute when the planned role differs from the implicit one', () => {
    const plan = makePlan({
      pages: [
        {
          path: '/',
          title: 'Roles',
          elements: [
            { kind: 'other', role: 'search', text: 'Search box' },
            { kind: 'text', role: 'status', text: 'Saved' },
          ],
        },
      ],
    });
    const html = generatedHtml(plan, 'index');
    expect(html).toContain('<div role="search">Search box</div>');
    expect(html).toContain('<p role="status">Saved</p>');
    // Landmarks map to their tags without an explicit role attribute.
    expect(html).not.toContain('role="contentinfo"');
  });
});

describe('structural — redirect transitions render no trigger', () => {
  const plan = makePlan({
    pages: [
      { path: '/', title: 'Home', elements: [headingInit('Home')] },
      { path: '/new', title: 'New', elements: [headingInit('New')] },
    ],
    bareRoutes: ['/old'],
    navigation: [
      {
        fromRouteId: testRouteId(2),
        toRouteId: testRouteId(1),
        trigger: { kind: 'redirect', reason: 'legacy URL retired' },
      },
      {
        fromRouteId: testRouteId(0),
        toRouteId: testRouteId(1),
        trigger: { kind: 'link', elementId: 'el_00000000-0000-4000-8000-0000000000e1' },
      },
    ],
  });

  it('renders no element, form or script for the redirect anywhere', () => {
    const app = generateApp(plan);
    for (const file of app.files) {
      if (file.path.endsWith('.html.ts')) {
        expect(file.contents).not.toContain('legacy URL retired');
        expect(file.contents).not.toContain('http-equiv');
        expect(file.contents).not.toContain('redirect');
      }
    }
  });

  it('serves the redirect from the pageless route and documents the rule', () => {
    const app = generateApp(plan);
    const server = app.files.find((file) => file.path === 'server.ts')?.contents ?? '';
    expect(server).toContain(`"/old": "/new"`);
    expect(server).not.toContain('"/old": route');
    const readme = app.files.find((file) => file.path === 'README.md')?.contents ?? '';
    expect(readme).toContain('`/old` → `/new`');
    expect(readme).toContain('308');
    // The pageless route is noted honestly.
    expect(readme).toContain('serves no page');
  });

  it('documents the page-wins case when a redirect leaves a routed page', () => {
    const pageWins = makePlan({
      pages: [
        { path: '/', title: 'Home', elements: [headingInit('Home')] },
        { path: '/moved', title: 'Moved', elements: [headingInit('Moved')] },
      ],
      navigation: [
        {
          fromRouteId: testRouteId(0),
          toRouteId: testRouteId(1),
          trigger: { kind: 'redirect', reason: 'home moved' },
        },
      ],
    });
    const app = generateApp(pageWins);
    const server = app.files.find((file) => file.path === 'server.ts')?.contents ?? '';
    expect(server).toContain('const redirects: Record<string, string> = {};');
    const readme = app.files.find((file) => file.path === 'README.md')?.contents ?? '';
    expect(readme).toContain('the page wins, no redirect is served');
  });
});

/** Index accessor without non-null assertions (lint-clean under strict TS). */
function at<T>(items: readonly T[], index: number, label: string): T {
  const value = items[index];
  if (value === undefined) {
    throw new Error(`structural test: missing ${label} at ${index}`);
  }
  return value;
}

describe('structural — GenerateOptions and defensive checks', () => {
  it('GenerateOptions.port overrides the planned port in manifest and server default', () => {
    const plan = makePlan({ port: 4700, pages: [{ path: '/', title: 'P', elements: [headingInit('P')] }] });
    const app = generateApp(plan, { port: 4799 });
    expect(app.manifest.port).toBe(4799);
    const server = app.files.find((file) => file.path === 'server.ts')?.contents ?? '';
    expect(server).toContain('const DEFAULT_PORT = 4799;');
    expect(app.manifest.port).not.toBe(4700);
  });

  it('throws on planVersion mismatch', () => {
    const plan = makePlan({ pages: [{ path: '/', title: 'P', elements: [headingInit('P')] }] });
    const wrong = { ...plan, planVersion: '0.2' };
    expect(() => generateApp(wrong)).toThrow(/does not equal PLAN_VERSION/);
  });

  it('throws on duplicate route paths', () => {
    const plan = makePlan({
      pages: [
        { path: '/', title: 'A', elements: [headingInit('A')] },
        { path: '/', title: 'B', elements: [headingInit('B')] },
      ],
    });
    expect(() => generateApp(plan)).toThrow(/duplicate route path/u);
  });

  it('throws on a page referencing an unknown route', () => {
    const plan = makePlan({ pages: [{ path: '/', title: 'A', elements: [headingInit('A')] }] });
    const firstPage = at(plan.pages, 0, 'page');
    const broken = { ...plan, pages: [{ ...firstPage, routeId: 'route_missing' }] };
    expect(() => generateApp(broken)).toThrow(/which is not declared in plan\.routes/);
  });

  it('throws on an element referencing a form missing from its page', () => {
    const plan = makePlan({
      pages: [
        {
          path: '/',
          title: 'A',
          elements: [{ kind: 'form', formId: 'form_missing' }],
        },
      ],
    });
    expect(() => generateApp(plan)).toThrow(/which is not declared on page/);
  });

  it('throws on invalid heading levels and ports', () => {
    const badLevel = makePlan({ pages: [{ path: '/', title: 'A', elements: [{ kind: 'heading', level: 7, text: 'X' }] }] });
    expect(() => generateApp(badLevel)).toThrow(/invalid heading level/u);
    const badPort = makePlan({ port: 99999, pages: [{ path: '/', title: 'A', elements: [headingInit('A')] }] });
    expect(() => generateApp(badPort)).toThrow(/between 0 and 65535/u);
  });

  it('throws on two pages claiming one route', () => {
    const plan = makePlan({ pages: [{ path: '/', title: 'A', elements: [headingInit('A')] }] });
    const firstPage = at(plan.pages, 0, 'page');
    const dup = { ...plan, pages: [...plan.pages, { ...firstPage, id: 'page_second' }] };
    expect(() => generateApp(dup)).toThrow(/claimed by both page/);
  });
});
