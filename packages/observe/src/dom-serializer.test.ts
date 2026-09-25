// CLAPP-010 unit tests — DOM subtree serialization.

import { describe, expect, test } from 'bun:test';
import { normalizeDomTree, type RawDomNode } from './dom-serializer';

describe('normalizeDomTree — structure', () => {
  test('serializes tag, role, collapsed text, filtered attrs, child order', () => {
    const raw: RawDomNode = {
      tag: 'div',
      attrs: { id: 'main', 'data-testid': 'root', 'aria-label': 'Main area', onclick: 'alert(1)', style: 'color: red' },
      text: '  Hello   world  ',
      children: [{ tag: 'button', attrs: { type: 'button' }, text: 'Go' }],
    };
    const result = normalizeDomTree(raw);
    expect(result.root).toEqual({
      tag: 'div',
      role: 'generic',
      text: 'Hello world',
      attrs: { id: 'main', 'data-testid': 'root', 'aria-label': 'Main area' },
      children: [{ tag: 'button', role: 'button', text: 'Go', attrs: { type: 'button' } }],
    });
    expect(result.nodeCount).toBe(2);
    expect(result.truncated).toBe(false);
  });

  test('script/style/noscript/template text is never serialized', () => {
    const raw: RawDomNode = {
      tag: 'div',
      children: [
        { tag: 'script', attrs: { src: '/app.js' }, text: 'secret-inline-code()' },
        { tag: 'style', text: 'body { color: red }' },
        { tag: 'span', text: 'visible' },
      ],
    };
    const result = normalizeDomTree(raw);
    expect(result.root.children?.[0]).toEqual({ tag: 'script', role: 'generic', attrs: { src: '/app.js' } });
    expect(result.root.children?.[1]).toEqual({ tag: 'style', role: 'generic' });
    expect(result.root.children?.[2]?.text).toBe('visible');
  });

  test('password input values are dropped, other values kept', () => {
    const raw: RawDomNode = {
      tag: 'form',
      children: [
        { tag: 'input', attrs: { type: 'password', value: 'hunter2' } },
        { tag: 'input', attrs: { type: 'text', value: 'ok' } },
      ],
    };
    const result = normalizeDomTree(raw);
    expect(result.root.children?.[0]?.attrs).toEqual({ type: 'password' });
    expect(result.root.children?.[1]?.attrs).toEqual({ type: 'text', value: 'ok' });
  });

  test('aria-* and data-* prefixes always pass the attr filter', () => {
    const raw: RawDomNode = { tag: 'div', attrs: { 'aria-expanded': 'true', 'data-custom-x': '1', forbidden: 'x' } };
    const result = normalizeDomTree(raw);
    expect(result.root.attrs).toEqual({ 'aria-expanded': 'true', 'data-custom-x': '1' });
  });

  test('custom allowlists replace the default subset', () => {
    const raw: RawDomNode = { tag: 'div', attrs: { id: 'x', custom: 'y' } };
    const result = normalizeDomTree(raw, { attrAllowlist: ['custom'], attrPrefixes: [] });
    expect(result.root.attrs).toEqual({ custom: 'y' });
  });
});

describe('normalizeDomTree — bounds and totality', () => {
  test('node cap truncates with an honest flag', () => {
    const raw: RawDomNode = {
      tag: 'div',
      children: Array.from({ length: 50 }, (_, i) => ({ tag: 'span', text: `n${i}` })),
    };
    const result = normalizeDomTree(raw, { maxNodes: 10 });
    expect(result.truncated).toBe(true);
    expect(result.nodeCount).toBe(10);
  });

  test('depth cap truncates deeper subtrees with an honest flag', () => {
    let deep: RawDomNode = { tag: 'section', text: 'bottom' };
    for (let i = 0; i < 30; i++) deep = { tag: 'div', children: [deep] };
    const result = normalizeDomTree(deep, { maxDepth: 5 });
    expect(result.truncated).toBe(true);
  });

  test('absent/malformed root yields a stable empty html node', () => {
    const result = normalizeDomTree(null);
    expect(result.root).toEqual({ tag: 'html', role: 'generic' });
    const malformed = normalizeDomTree({ tag: 42 } as unknown as RawDomNode);
    expect(malformed.root.tag).toBe('html');
  });

  test('empty text and childless nodes omit the optional fields', () => {
    const result = normalizeDomTree({ tag: 'br' });
    expect(result.root).toEqual({ tag: 'br', role: 'generic' });
  });
});
