// CLAPP-010 unit tests — DOM semantics: role table + target resolution.

import { describe, expect, test } from 'bun:test';
import {
  accessibleName,
  collapseText,
  isActionableRole,
  resolveTarget,
  roleFor,
  subtreeText,
} from './dom-semantics';
import { normalizeDomTree, type RawDomNode, type SerializedNode } from './dom-serializer';

function serialize(raw: RawDomNode): SerializedNode {
  return normalizeDomTree(raw).root;
}

describe('roleFor — ROLE_TABLE and precedence', () => {
  test('implicit roles from the tag table', () => {
    expect(roleFor({ tag: 'button' })).toBe('button');
    expect(roleFor({ tag: 'a' })).toBe('link');
    expect(roleFor({ tag: 'nav' })).toBe('navigation');
    expect(roleFor({ tag: 'h3' })).toBe('heading');
    expect(roleFor({ tag: 'li' })).toBe('listitem');
    expect(roleFor({ tag: 'table' })).toBe('table');
  });

  test('input roles come from the type attribute', () => {
    expect(roleFor({ tag: 'input', attrs: { type: 'checkbox' } })).toBe('checkbox');
    expect(roleFor({ tag: 'input', attrs: { type: 'radio' } })).toBe('radio');
    expect(roleFor({ tag: 'input', attrs: { type: 'submit' } })).toBe('button');
    expect(roleFor({ tag: 'input' })).toBe('textbox'); // default type=text
    expect(roleFor({ tag: 'input', attrs: { type: 'range' } })).toBe('slider');
  });

  test('explicit role attribute wins (first token of a role list)', () => {
    expect(roleFor({ tag: 'div', attrs: { role: 'switch' } })).toBe('switch');
    expect(roleFor({ tag: 'div', attrs: { role: 'switch checked' } })).toBe('switch');
    expect(roleFor({ tag: 'button', attrs: { role: 'link' } })).toBe('link');
  });

  test('unknown tags are generic', () => {
    expect(roleFor({ tag: 'custom-element' })).toBe('generic');
    expect(roleFor({ tag: 'div' })).toBe('generic');
  });
});

describe('isActionableRole', () => {
  test('interactive roles are actionable', () => {
    expect(isActionableRole('button')).toBe(true);
    expect(isActionableRole('link')).toBe(true);
    expect(isActionableRole('textbox')).toBe(true);
    expect(isActionableRole('combobox')).toBe(true);
  });

  test('non-interactive roles are not', () => {
    expect(isActionableRole('heading')).toBe(false);
    expect(isActionableRole('generic')).toBe(false);
    expect(isActionableRole('banner')).toBe(false);
  });
});

describe('accessibleName / subtreeText', () => {
  test('subtree text concatenates descendants and collapses whitespace', () => {
    const tree = serialize({
      tag: 'button',
      text: '  Go  ',
      children: [{ tag: 'span', text: '  faster  ' }],
    });
    expect(subtreeText(tree)).toBe('Go faster');
    expect(accessibleName(tree)).toBe('Go faster');
  });

  test('aria-label takes precedence over subtree text', () => {
    const tree = serialize({ tag: 'button', attrs: { 'aria-label': 'Confirm' }, text: 'ok' });
    expect(accessibleName(tree)).toBe('Confirm');
  });

  test('falls back to alt, then title, then placeholder', () => {
    expect(accessibleName(serialize({ tag: 'img', attrs: { alt: 'Logo' } }))).toBe('Logo');
    expect(accessibleName(serialize({ tag: 'div', attrs: { title: 'Tooltip' } }))).toBe('Tooltip');
    expect(accessibleName(serialize({ tag: 'input', attrs: { placeholder: 'Search…' } }))).toBe('Search…');
    expect(accessibleName(serialize({ tag: 'div' }))).toBe('');
  });

  test('collapseText handles all-whitespace', () => {
    expect(collapseText(' \n\t ')).toBe('');
  });
});

describe('resolveTarget — unique target resolution', () => {
  const page: RawDomNode = {
    tag: 'html',
    children: [
      {
        tag: 'body',
        children: [
          { tag: 'h1', text: 'Title' },
          { tag: 'button', attrs: { 'data-testid': 'load-data' }, text: 'Load data' },
          { tag: 'button', attrs: { 'data-testid': 'open-ws' }, text: 'Open socket' },
          {
            tag: 'div',
            children: [{ tag: 'button', text: 'Load data' }], // duplicate name, different place
          },
          { tag: 'input', attrs: { 'data-testid': 'note-input', type: 'text' } },
          { tag: 'a', attrs: { href: '/x' }, text: 'Read more' },
        ],
      },
    ],
  };
  const root = serialize(page);


  test('testId resolves to a unique node with its element path', () => {
    const resolution = resolveTarget(root, { testId: 'load-data' }, { requireActionable: true });
    expect(resolution.ok).toBe(true);
    if (resolution.ok) {
      // html → body(index 0) → button(index 1)
      expect(resolution.target.path).toEqual([0, 1]);
      expect(resolution.target.role).toBe('button');
      expect(resolution.target.name).toBe('Load data');
    }
  });

  test('role+name resolves uniquely', () => {
    const resolution = resolveTarget(root, { role: 'link', name: 'Read more' });
    expect(resolution.ok).toBe(true);
    if (resolution.ok) expect(resolution.target.path).toEqual([0, 5]);
  });

  test('duplicate names without nth are ambiguous (never silent first-match)', () => {
    const resolution = resolveTarget(root, { role: 'button', name: 'Load data' });
    expect(resolution.ok).toBe(false);
    if (!resolution.ok) {
      expect(resolution.reason).toBe('ambiguous');
      expect(resolution.matchCount).toBe(2);
    }
  });

  test('nth disambiguates duplicate matches', () => {
    const first = resolveTarget(root, { role: 'button', name: 'Load data', nth: 0 });
    const second = resolveTarget(root, { role: 'button', name: 'Load data', nth: 1 });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) expect(first.target.path).not.toEqual(second.target.path);
  });

  test('out-of-range nth is no-match with the match count reported', () => {
    const resolution = resolveTarget(root, { role: 'button', name: 'Load data', nth: 5 });
    expect(resolution.ok).toBe(false);
    if (!resolution.ok) {
      expect(resolution.reason).toBe('no-match');
      expect(resolution.matchCount).toBe(2);
    }
  });

  test('no match reports honestly', () => {
    const resolution = resolveTarget(root, { testId: 'does-not-exist' });
    expect(resolution.ok).toBe(false);
    if (!resolution.ok) expect(resolution.reason).toBe('no-match');
  });

  test('empty selectors and bad nth are invalid', () => {
    expect((resolveTarget(root, {}) as { reason: string }).reason).toBe('invalid-selector');
    expect((resolveTarget(root, { testId: 'x', nth: -1 }) as { reason: string }).reason).toBe('invalid-selector');
    expect((resolveTarget(root, { testId: 'x', nth: 1.5 }) as { reason: string }).reason).toBe('invalid-selector');
  });

  test('requireActionable rejects non-actionable targets', () => {
    const resolution = resolveTarget(root, { role: 'heading', name: 'Title' }, { requireActionable: true });
    expect(resolution.ok).toBe(false);
    if (!resolution.ok) expect(resolution.reason).toBe('not-actionable');
    // same selector fine when actionability is not required (assert-visible)
    expect(resolveTarget(root, { role: 'heading', name: 'Title' }).ok).toBe(true);
  });

  test('textbox role resolves for text inputs (fill targets)', () => {
    const resolution = resolveTarget(root, { role: 'textbox' }, { requireActionable: true });
    expect(resolution.ok).toBe(true);
    if (resolution.ok) expect(resolution.target.node.attrs?.['data-testid']).toBe('note-input');
  });
});
