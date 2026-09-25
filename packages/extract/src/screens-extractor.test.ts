// CLAPP-021 unit — screens & components extractor: route grouping, dedupe,
// component vocabulary, screenshot attribution, honest warnings.

import { describe, expect, test } from 'bun:test';
import {
  SynthClock,
  docRequestCapture,
  domTreeCapture,
  el,
  extractFromSynth,
  pageTree,
  screenshotCapture,
  synthBundle,
} from './test-utils';

const clock = new SynthClock();

function navTree(extra: ReturnType<typeof el>[] = []): ReturnType<typeof pageTree> {
  return pageTree([
    el('a', 'link', { text: 'Home', attrs: { href: '/' } }),
    el('a', 'link', { text: 'Pricing', attrs: { href: '/pricing' } }),
    ...extra,
  ]);
}

describe('screens-extractor — route grouping', () => {
  test('dom-tree captures group under the current document route', async () => {
    const synth = await synthBundle([
      docRequestCapture('http://synth.test/', clock.next()),
      domTreeCapture(navTree(), clock.next()),
      docRequestCapture('http://synth.test/pricing.html', clock.next()),
      domTreeCapture(navTree([el('button', 'button', { text: 'Buy' })]), clock.next()),
    ]);
    const { model } = await extractFromSynth(synth);
    expect(model.screens.map((screen) => screen.route)).toEqual(['/', '/pricing.html']);
    expect(model.screens.every((screen) => screen.treeRef !== undefined)).toBe(true);
  });

  test('query strings and fragments are stripped; trailing slash is insensitive', async () => {
    const synth = await synthBundle([
      docRequestCapture('http://synth.test/pricing/?utm=1#section', clock.next()),
      domTreeCapture(navTree(), clock.next()),
      docRequestCapture('http://synth.test/pricing?x=2', clock.next()),
      domTreeCapture(navTree(), clock.next()),
    ]);
    const { model } = await extractFromSynth(synth);
    expect(model.screens.length).toBe(1);
    expect(model.screens[0]!.route).toBe('/pricing');
  });

  test('same route captured twice → ONE screen, first capture wins treeRef, components merge', async () => {
    const synth = await synthBundle([
      docRequestCapture('http://synth.test/', clock.next()),
      domTreeCapture(navTree(), clock.next()),
      docRequestCapture('http://synth.test/', clock.next()),
      domTreeCapture(
        navTree([el('button', 'button', { text: 'Buy' }), el('a', 'link', { text: 'Home', attrs: { href: '/' } })]),
        clock.next(),
      ),
    ]);
    const { model } = await extractFromSynth(synth);
    expect(model.screens.length).toBe(1);
    // components deduped by role+name+attrs signature: Home link appears in
    // both captures → ONE; Buy button only in the second → merged in.
    const links = model.components.filter((component) => component.properties['name'] === 'Home');
    expect(links.length).toBe(1);
    expect(model.components.some((component) => component.properties['name'] === 'Buy')).toBe(true);
    // the screen's provenance cites BOTH dom captures (both contributed)
    expect(model.screens[0]!.provenance.confidence.evidenceRefs.length).toBe(2);
    expect(model.screens[0]!.provenance.level).toBe('derived');
  });

  test('dom-tree before any document request → no screen, honest warning', async () => {
    const synth = await synthBundle([domTreeCapture(navTree(), clock.next())]);
    const { model, warnings } = await extractFromSynth(synth);
    expect(model.screens.length).toBe(0);
    expect(warnings.some((warning) => warning.includes('no preceding document request'))).toBe(true);
  });
});

describe('screens-extractor — components', () => {
  test('only actionable roles become components, with role-consistent events and properties', async () => {
    const synth = await synthBundle([
      docRequestCapture('http://synth.test/contact', clock.next()),
      domTreeCapture(
        pageTree([
          el('a', 'link', { text: 'Home', attrs: { href: '/' } }),
          el('button', 'button', { text: 'Submit' }),
          el('input', 'textbox', { attrs: { type: 'text', placeholder: 'Email', name: 'email' } }),
          el('input', 'checkbox', { attrs: { type: 'checkbox', name: 'optin' } }),
          el('form', 'form', { attrs: { name: 'contact' } }),
          el('select', 'combobox', { attrs: { name: 'topic' } }),
          el('textarea', 'textbox', { attrs: { name: 'message' } }),
          el('h1', 'heading', { text: 'Contact us' }),
          el('p', 'paragraph', { text: 'plain text is not a component' }),
          el('div', 'generic', { text: 'generic div' }),
        ]),
        clock.next(),
      ),
    ]);
    const { model } = await extractFromSynth(synth);
    const screen = model.screens[0]!;
    expect(model.components.length).toBe(7);
    expect(model.components.every((component) => component.screenId === screen.id)).toBe(true);
    const byName = new Map(model.components.map((component) => [String(component.properties['name']), component]));
    expect(byName.get('Home')!.role).toBe('link');
    expect(byName.get('Home')!.events).toEqual(['click']);
    expect(byName.get('Home')!.properties['attrs']).toEqual({ href: '/' });
    expect(byName.get('Submit')!.events).toEqual(['click']);
    expect(byName.get('Email')!.role).toBe('textbox'); // placeholder is the accessible-name fallback
    expect(byName.get('Email')!.events).toEqual(['click', 'focus', 'input']);
    expect(byName.get('Email')!.properties['attrs']).toEqual({ type: 'text', placeholder: 'Email', name: 'email' });
    // inputs without label text have empty names (honest v0 approximation,
    // mirroring observe's accessibleName) — identified by role instead
    const checkbox = model.components.find((component) => component.role === 'checkbox')!;
    expect(checkbox.properties['name']).toBe('');
    expect(checkbox.events).toEqual(['click', 'change']);
    expect(checkbox.properties['attrs']).toEqual({ type: 'checkbox', name: 'optin' });
    const form = model.components.find((component) => component.role === 'form')!;
    expect(form.events).toEqual(['submit']);
    expect(form.properties['attrs']).toEqual({ name: 'contact' });
    expect(model.components.find((component) => component.role === 'combobox')!.properties['tag']).toBe('select');
    expect(model.components.filter((component) => component.role === 'textbox').length).toBe(2); // input + textarea
    // heading/paragraph/generic never become components
    expect([...byName.keys()].includes('Contact us')).toBe(false);
    expect([...byName.keys()].includes('plain text is not a component')).toBe(false);
    // every component cites the dom evidence
    expect(model.components.every((component) => component.provenance.confidence.evidenceRefs.length === 1)).toBe(true);
    expect(model.components.every((component) => component.provenance.level === 'derived')).toBe(true);
  });

  test('components with identical role+name+attrs dedupe within a screen', async () => {
    const synth = await synthBundle([
      docRequestCapture('http://synth.test/', clock.next()),
      domTreeCapture(pageTree([el('button', 'button', { text: 'Buy' }), el('button', 'button', { text: 'Buy' })]), clock.next()),
    ]);
    const { model } = await extractFromSynth(synth);
    expect(model.components.length).toBe(1);
  });
});

describe('screens-extractor — screenshot attribution', () => {
  test('screenshot after the dom capture attaches as visualRef (first wins)', async () => {
    const synth = await synthBundle([
      docRequestCapture('http://synth.test/', clock.next()),
      domTreeCapture(navTree(), clock.next()),
      screenshotCapture(clock.next()),
      screenshotCapture(clock.next()),
    ]);
    const { model } = await extractFromSynth(synth);
    expect(model.screens[0]!.visualRef).toBeDefined();
    expect(model.screens[0]!.provenance.confidence.evidenceRefs.length).toBe(2); // dom + visual
  });

  test('screenshot BEFORE the dom capture attaches once the screen is minted', async () => {
    const synth = await synthBundle([
      docRequestCapture('http://synth.test/', clock.next()),
      screenshotCapture(clock.next()),
      domTreeCapture(navTree(), clock.next()),
    ]);
    const { model } = await extractFromSynth(synth);
    expect(model.screens[0]!.visualRef).toBeDefined();
  });

  test('a screenshot for a route with no dom capture stays uncited with a warning', async () => {
    const synth = await synthBundle([
      docRequestCapture('http://synth.test/', clock.next()),
      domTreeCapture(navTree(), clock.next()),
      docRequestCapture('http://synth.test/pricing', clock.next()),
      screenshotCapture(clock.next()),
    ]);
    const { model, warnings } = await extractFromSynth(synth);
    expect(model.screens.length).toBe(1);
    expect(model.screens[0]!.route).toBe('/');
    expect(model.screens[0]!.visualRef).toBeUndefined();
    expect(warnings.some((warning) => warning.includes('could not be attributed to a screen'))).toBe(true);
  });
});
