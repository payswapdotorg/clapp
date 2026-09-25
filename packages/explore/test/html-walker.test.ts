/**
 * CLAPP-022 test battery — the zero-dep HTML walker.
 *
 * Hand-checked expectations over hand-written fixture HTML (no snapshot
 * magic): parsing behavior, the compact actionable list (roles/names/
 * testIds/paths/hrefs/form identities), selector construction (including
 * ambiguity → nth), capture serialization semantics (attr allowlist,
 * password drop, script/style skip, own-text collapse, observe role table),
 * and — the alignment keystone — that every actionable the walker chooses
 * actually resolves through the REAL frozen applier's assert-visible.
 */

import { describe, expect, it } from 'bun:test';
import { createDomApplier } from '@clapp/journey';
import type { ActionApplier } from '@clapp/journey';
import {
  journeyAccessibleName,
  parseHtml,
  walkHtml,
  type ActionableElement,
} from '../src/html-walker';

const FIXTURE = `<!DOCTYPE html>
<html lang="en">
<head>
  <title>Walker fixture</title>
  <script>var ignored = '<div>never parsed</div>';</script>
  <style>body { color: red; }</style>
</head>
<body>
  <!-- comments are skipped by design -->
  <header>
    <nav aria-label="Main">
      <a href="/" data-testid="nav-home">Home</a>
      <a href="/pricing.html">Pricing &amp; Plans</a>
      <a href="https://external.example/page">External</a>
      <a href="#skip">Skip</a>
    </nav>
  </header>
  <main id="skip">
    <h1 data-testid="hero">Walker &amp; fixture</h1>
    <p>Some <strong>text</strong> here</p>
    <form action="/subscribe" method="get" id="sub-form">
      <label for="email">Email address</label>
      <input id="email" name="email" type="email" placeholder="you@example.com" data-testid="sub-email" required>
      <input type="password" name="pw" value="hunter2">
      <button type="button" data-testid="plain-btn">Just a button</button>
      <input type="submit" value="Join &quot;now&quot;">
    </form>
    <form action="/search" method="post">
      <input type="text" name="q" aria-label="Query">
      <button>Search</button>
    </form>
    <p>
      <button data-testid="dup-btn">Dup one</button>
      <button data-testid="dup-btn">Dup two</button>
    </p>
    <a href="/hidden.html" aria-hidden="true">Hidden link</a>
  </main>
  <footer>
    <a href="/docs/a">Docs</a>
    <a href="/docs/b">Docs</a>
  </footer>
</body>
</html>`;

function actionable(actionables: ActionableElement[], predicate: (a: ActionableElement) => boolean): ActionableElement {
  const found = actionables.find(predicate);
  if (found === undefined) {
    throw new Error('fixture assertion: expected actionable not found');
  }
  return found;
}

describe('html-walker — parsing (honest subset)', () => {
  it('skips comments, doctype, and script/style content by design', () => {
    const page = walkHtml(FIXTURE);
    const serialized = JSON.stringify(page.serialized.root);
    expect(serialized).not.toContain('never parsed');
    expect(serialized).not.toContain('color: red');
    // the script/style ELEMENTS exist in the tree (tag + role) — their TEXT
    // is what never serializes.
    expect(serialized).toContain('"tag":"script"');
    expect(serialized).toContain('"tag":"style"');
  });

  it('decodes entities in text and attribute values', () => {
    const page = walkHtml(FIXTURE);
    const pricing = actionable(page.actionables, (a) => a.testId === undefined && a.name === 'Pricing & Plans');
    expect(pricing.href).toBe('/pricing.html');
    const join = actionable(page.actionables, (a) => a.name === 'Join "now"');
    expect(join.role).toBe('button');
    expect(join.tag).toBe('input');
  });

  it('parses boolean attributes as empty strings and tolerates stray close tags', () => {
    const doc = parseHtml('<div><input required></div></span><p>x');
    const div = doc.children[0];
    expect(div?.nodeType).toBe('element');
    if (div?.nodeType !== 'element') return;
    const input = div.children[0];
    expect(input?.nodeType).toBe('element');
    if (input?.nodeType !== 'element') return;
    expect(input.attrs['required']).toBe('');
    // unclosed elements auto-close at EOF; stray close tags are ignored.
    const tail = doc.children[1];
    expect(tail?.nodeType).toBe('element');
    if (tail?.nodeType === 'element') {
      expect(tail.tag).toBe('p');
    }
  });

  it('treats textarea content as text (RCDATA), not markup', () => {
    const page = walkHtml('<html><body><textarea name="msg">&lt;b&gt;hi&lt;/b&gt;</textarea></body></html>');
    const box = actionable(page.actionables, (a) => a.tag === 'textarea');
    expect(box.name).toBe('');
    const element = page.elementsByPath.get(box.path);
    expect(element).toBeDefined();
    expect(element?.nodeType === 'element' ? JSON.stringify(element.children) : '').toContain('<b>hi</b>');
  });
});

describe('html-walker — the compact actionable list', () => {
  const page = walkHtml(FIXTURE);

  it('lists actionables with observe ROLE_TABLE roles and journey names', () => {
    const nav = actionable(page.actionables, (a) => a.role === 'navigation');
    expect(nav.name).toBe('Main'); // aria-label wins (journey naming mirror)
    expect(nav.tag).toBe('nav');

    const home = actionable(page.actionables, (a) => a.testId === 'nav-home');
    expect(home.role).toBe('link');
    expect(home.name).toBe('Home');
    expect(home.href).toBe('/');

    const hero = actionable(page.actionables, (a) => a.testId === 'hero');
    expect(hero.role).toBe('heading');
    expect(hero.name).toBe('Walker & fixture');
    expect(hero.tag).toBe('h1');
  });

  it('names labelable controls from associated labels (journey mirror)', () => {
    const email = actionable(page.actionables, (a) => a.testId === 'sub-email');
    expect(email.role).toBe('textbox');
    expect(email.name).toBe('Email address');
    expect(email.inputType).toBe('email');
    expect(email.form).toBe('sub-form'); // owning form identity = its id
  });

  it('derives submit-button names from value attributes and maps roles', () => {
    const join = actionable(page.actionables, (a) => a.name === 'Join "now"');
    expect(join.role).toBe('button'); // observe: input[type=submit] → button
    expect(join.inputType).toBe('submit');
    expect(join.form).toBe('sub-form');
    const search = actionable(page.actionables, (a) => a.name === 'Search');
    expect(search.role).toBe('button');
    expect(search.tag).toBe('button');
    expect(search.form).not.toBe('sub-form'); // belongs to the second form
  });

  it('excludes self-aria-hidden elements (the applier never matches them)', () => {
    expect(page.actionables.some((a) => a.name === 'Hidden link')).toBe(false);
  });

  it('does not list non-actionable roles (labels, paragraphs, images)', () => {
    const roles = new Set(page.actionables.map((a) => a.role));
    expect(roles.has('label')).toBe(false);
    expect(roles.has('img')).toBe(false);
    expect(roles.has('generic')).toBe(false);
  });

  it('computes document-order paths with 1-based same-tag indices when ambiguous', () => {
    const home = actionable(page.actionables, (a) => a.testId === 'nav-home');
    expect(home.path).toBe('html>body>header>nav>a[1]');
    const skip = actionable(page.actionables, (a) => a.name === 'Skip');
    expect(skip.path).toBe('html>body>header>nav>a[4]');
    const hero = actionable(page.actionables, (a) => a.testId === 'hero');
    expect(hero.path).toBe('html>body>main>h1');
    const form2 = actionable(
      page.actionables,
      (a) => a.role === 'form' && a.form === 'html>body>main>form[2]',
    );
    expect(form2.path).toBe('html>body>main>form[2]');
  });
});

describe('html-walker — TargetSelector construction', () => {
  const page = walkHtml(FIXTURE);

  it('prefers unique testIds', () => {
    const email = actionable(page.actionables, (a) => a.testId === 'sub-email');
    expect(email.target).toEqual({ testId: 'sub-email' });
    const plain = actionable(page.actionables, (a) => a.testId === 'plain-btn');
    expect(plain.target).toEqual({ testId: 'plain-btn' });
  });

  it('disambiguates duplicate testIds with nth (0-based, document order)', () => {
    const dups = page.actionables.filter((a) => a.testId === 'dup-btn');
    expect(dups).toHaveLength(2);
    expect(dups[0]?.target).toEqual({ testId: 'dup-btn', nth: 0 });
    expect(dups[1]?.target).toEqual({ testId: 'dup-btn', nth: 1 });
  });

  it('uses role+name anchors and adds nth when the name is ambiguous', () => {
    const docs = page.actionables.filter((a) => a.name === 'Docs');
    expect(docs).toHaveLength(2);
    expect(docs[0]?.target).toEqual({ role: 'link', name: 'Docs', nth: 0 });
    expect(docs[1]?.target).toEqual({ role: 'link', name: 'Docs', nth: 1 });
    const query = actionable(page.actionables, (a) => a.name === 'Query');
    expect(query.target).toEqual({ role: 'textbox', name: 'Query' });
  });

  it('falls back to role-only anchors (with nth) for unnamed elements', () => {
    // The password input derives no name; the two forms derive no names.
    const pw = actionable(page.actionables, (a) => a.inputType === 'password');
    expect(pw.name).toBe('');
    // Textboxes in document order: email (named), pw (unnamed), q (named).
    expect(pw.target).toEqual({ role: 'textbox', nth: 1 });
    const forms = page.actionables.filter((a) => a.role === 'form');
    expect(forms[0]?.target).toEqual({ role: 'form', nth: 0 });
    expect(forms[1]?.target).toEqual({ role: 'form', nth: 1 });
  });

  it('omits the target for elements with no anchor at all', () => {
    const bare = walkHtml(
      '<html><body><div data-role="nothing"><span>plain</span></div></body></html>',
    );
    // divs/spans never reach the actionable list (generic role) — and even
    // for listed roles, an element with no testId, no journey role and no
    // name cannot be targeted: an explicit role attr provides the anchor.
    expect(bare.actionables).toHaveLength(0);
  });
});

describe('html-walker — capture serialization (observe semantics)', () => {
  const page = walkHtml(FIXTURE);
  const { root, nodeCount, truncated } = page.serialized;

  it('produces the SerializedNode shape rooted at <html> with observe roles', () => {
    expect(root.tag).toBe('html');
    expect(root.role).toBe('generic'); // observe table: html → generic
    expect(root.attrs).toEqual({ lang: 'en' }); // allowlist keeps lang
    expect(nodeCount).toBeGreaterThan(20);
    expect(truncated).toBe(false);
    const head = root.children?.find((child) => child.tag === 'head');
    expect(head).toBeDefined();
    const body = root.children?.find((child) => child.tag === 'body');
    expect(body?.role).toBe('generic');
  });

  it('serializes only DIRECT text (own text), collapsed', () => {
    const main = root.children?.find((child) => child.tag === 'body')?.children?.find((child) => child.tag === 'main');
    expect(main).toBeDefined();
    const para = main?.children?.find((child) => child.tag === 'p');
    expect(para?.text).toBe('Some here'); // direct text only, whitespace-collapsed
    const strong = para?.children?.find((child) => child.tag === 'strong');
    expect(strong?.text).toBe('text');
    expect(strong?.role).toBe('strong'); // observe ROLE_TABLE naming
  });

  it('drops password values and filters attributes to the allowlist + aria-/data-', () => {
    const main = root.children?.find((child) => child.tag === 'body')?.children?.find((child) => child.tag === 'main');
    const form = main?.children?.find((child) => child.tag === 'form');
    // 'action' and 'method' are NOT in the frozen observe allowlist — only id
    // survives for this form.
    expect(form?.attrs).toEqual({ id: 'sub-form' });
    const email = form?.children?.find((child) => child.tag === 'input');
    expect(email?.attrs).toEqual({
      id: 'email',
      name: 'email',
      type: 'email',
      placeholder: 'you@example.com',
      'data-testid': 'sub-email',
    });
    const pw = form?.children?.find((child) => child.attrs?.['name'] === 'pw');
    expect(pw?.attrs).toEqual({ name: 'pw', type: 'password' }); // value dropped
  });

  it('never serializes script/style text but keeps the elements', () => {
    const head = root.children?.find((child) => child.tag === 'head');
    const script = head?.children?.find((child) => child.tag === 'script');
    expect(script).toBeDefined();
    expect(script?.text).toBeUndefined();
    expect(script?.children).toBeUndefined();
  });

  it('flags truncation honestly at the depth cap', () => {
    const deep = `<html><body>${'<div>'.repeat(60)}x${'</div>'.repeat(60)}</body></html>`;
    const serialized = walkHtml(deep).serialized;
    expect(serialized.truncated).toBe(true); // depth 48 cap flags truncation
  });
});

describe('html-walker — alignment with the frozen applier', () => {
  it('every actionable target resolves via the real applier assert-visible', async () => {
    const page = walkHtml(FIXTURE);
    const applier: ActionApplier = createDomApplier({
      baseUrl: 'http://walker.test/',
      fetchImpl: (async (input: URL | string | Request): Promise<Response> => {
        void input;
        return new Response(FIXTURE, { status: 200, headers: { 'content-type': 'text/html' } });
      }) as typeof fetch,
    });
    await applier.apply({ type: 'navigate', url: '/' });
    const withTargets = page.actionables.filter((a) => a.target !== undefined);
    expect(withTargets.length).toBeGreaterThan(12);
    for (const actionableElement of withTargets) {
      // Throws target-not-found/target-ambiguous/assert-visible-failed on
      // any walker/applier divergence — the keystone alignment check.
      await applier.apply({ type: 'assert-visible', target: actionableElement.target as NonNullable<typeof actionableElement.target> });
    }
  });

  it('journeyAccessibleName mirrors the documented priority order', () => {
    const doc = parseHtml(
      '<html><body><input id="a" aria-label="Aria wins" title="title"><input id="b" placeholder="ph"><input id="c"></body></html>',
    );
    const html = doc.children[0];
    if (html?.nodeType !== 'element' || html.tag !== 'html') throw new Error('fixture assertion: no html');
    const body = html.children[0];
    if (body?.nodeType !== 'element' || body.tag !== 'body') throw new Error('fixture assertion: no body');
    const inputs = body.children.filter(
      (child): child is import('../src/html-walker').WalkerElement => child.nodeType === 'element',
    );
    expect(inputs).toHaveLength(3);
    expect(journeyAccessibleName(inputs[0] as import('../src/html-walker').WalkerElement, doc)).toBe('Aria wins');
    expect(journeyAccessibleName(inputs[1] as import('../src/html-walker').WalkerElement, doc)).toBe('ph');
    expect(journeyAccessibleName(inputs[2] as import('../src/html-walker').WalkerElement, doc)).toBe(null);
  });
});
