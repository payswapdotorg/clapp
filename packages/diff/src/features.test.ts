/**
 * @clapp/diff tests — the pure comparison basis (html-tree + page-features).
 *
 * Unit coverage for the parser and the feature extractor: entities, the
 * observe-shaped tree (element children only, own text merged), landmark
 * sequencing, targetable-surface extraction (aria-hidden exclusion,
 * placeholder-named textboxes, label-for field naming), and form
 * structure. These are the gears the killer acceptance runs on — small,
 * fast, and honest about the approximation limits.
 */

import { describe, expect, it } from 'bun:test';
import { ACTIONABLE_ROLES } from '@clapp/observe';
import { decodeEntities, parseHtmlToRawTree } from './html-tree';
import { extractPageFeatures, normalizeRoutePath } from './page-features';

const PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Test — Page</title>
  <link rel="stylesheet" href="x.css">
  <script src="x.js" defer></script>
</head>
<body>
  <a class="skip" href="#main">Skip to content</a>
  <header><a href="/" aria-label="Home sweet home" data-testid="logo">Logo</a></header>
  <nav aria-label="Main"><a href="/f.html" data-testid="nav-f">Features</a></nav>
  <main>
    <h1 data-testid="h1">Hello &amp; welcome</h1>
    <section aria-label="Cards">
      <article><h2>&copy; 2026</h2><img src="a.svg" alt="An illustration"></article>
    </section>
    <form action="/done.html" method="get" data-testid="the-form">
      <p>
        <label for="e">Email address</label>
        <input id="e" name="email" type="email" placeholder="you@example.com" data-testid="e">
      </p>
      <label for="t">Topic</label><select name="topic" id="t"><option value="a" selected>Alpha</option><option value="b">Beta</option></select>
      <button type="submit" data-testid="go">Send it</button>
    </form>
    <div aria-hidden="true"><a href="/hidden.html">Hidden link</a><span data-testid="hidden-tid">x</span></div>
  </main>
  <footer><nav aria-label="Footer"><a href="/">Home</a></nav></footer>
</body>
</html>`;

describe('html-tree — tolerant parsing to the observe shape', () => {
  it('decodes character references', () => {
    expect(decodeEntities('a &amp; b &copy; &#65; &#x42; &unknown;')).toBe('a & b © A B &unknown;');
    expect(decodeEntities('plain')).toBe('plain');
  });

  it('produces element-children-only trees with merged own text', () => {
    const tree = parseHtmlToRawTree(PAGE);
    expect(tree.tag).toBe('html');
    // Own text of the h1: the entity-decoded direct text, merged.
    const body = tree.children?.find((child) => child.tag === 'body');
    expect(body).toBeDefined();
    const main = body!.children?.find((child) => child.tag === 'main');
    expect(main).toBeDefined();
    const h1 = main!.children?.find((child) => child.tag === 'h1');
    expect(h1?.text).toBe('Hello & welcome');
    // Script content stays in the tree (normalizeDomTree drops it downstream).
    const head = tree.children?.find((child) => child.tag === 'head');
    expect(head?.children?.some((child) => child.tag === 'script')).toBe(true);
  });

  it('tolerates void elements, self-closing tags, and unclosed formatting', () => {
    const tree = parseHtmlToRawTree('<html><body><br><hr/><img src="x"><p>a<b>b</body></html>');
    const body = tree.children?.find((child) => child.tag === 'body');
    const tags = (body?.children ?? []).map((child) => child.tag);
    expect(tags).toEqual(['br', 'hr', 'img', 'p']);
  });
});

describe('page-features — the comparable extraction', () => {
  const features = extractPageFeatures(PAGE, 'http://127.0.0.1:1/index.html', ACTIONABLE_ROLES);

  it('extracts the title and ordered headings with decoded text', () => {
    expect(features.title).toBe('Test — Page');
    expect(features.headings).toEqual([
      { level: 1, text: 'Hello & welcome' },
      { level: 2, text: '© 2026' },
    ]);
  });

  it('collects the data-testid surface EXCLUDING aria-hidden subtrees', () => {
    expect(features.testIds).toContain('logo');
    expect(features.testIds).toContain('h1');
    expect(features.testIds).toContain('the-form');
    expect(features.testIds).not.toContain('hidden-tid');
  });

  it('sequences landmarks with explicit names only', () => {
    expect(features.landmarks).toEqual([
      { role: 'banner', name: '' },
      { role: 'navigation', name: 'Main' },
      { role: 'main', name: '' },
      { role: 'region', name: 'Cards' },
      { role: 'article', name: '' },
      { role: 'contentinfo', name: '' },
      { role: 'navigation', name: 'Footer' },
    ]);
  });

  it('extracts the journey-targetable surface (aria-hidden excluded, placeholder/aria-label names)', () => {
    expect(features.targetables).toContain('link::Skip to content');
    expect(features.targetables).toContain('link::Home sweet home');
    expect(features.targetables).toContain('link::Features');
    expect(features.targetables).toContain('link::Home');
    expect(features.targetables).toContain('img::An illustration');
    expect(features.targetables).toContain('textbox::you@example.com');
    expect(features.targetables).toContain('button::Send it');
    expect(features.targetables).toContain('combobox::Alpha Beta');
    expect(features.targetables).not.toContain('link::Hidden link');
    // The submit button inside a form is targetable; count-sensitive multiset.
    expect(features.targetables.filter((pair) => pair === 'button::Send it')).toHaveLength(1);
  });

  it('extracts form structure with label-for names, options, and resolved action paths', () => {
    expect(features.forms).toEqual([
      {
        actionPath: '/done.html',
        method: 'get',
        fields: [
          { name: 'email', type: 'email', label: 'Email address', testId: 'e' },
          {
            name: 'topic',
            type: 'select',
            label: 'Topic',
            options: [
              { value: 'a', label: 'Alpha' },
              { value: 'b', label: 'Beta' },
            ],
          },
        ],
      },
    ]);
  });

  it('normalizes route paths', () => {
    expect(normalizeRoutePath('http://127.0.0.1:2/features.html?x=1#frag')).toBe('/features.html');
    expect(normalizeRoutePath('/contact-success.html?name=Ada')).toBe('/contact-success.html');
    expect(normalizeRoutePath('relative.html')).toBe('/relative.html');
  });
});
