/**
 * CLAPP-012 test battery — the minidom HTML shim.
 *
 * The parser only promises the well-formed subset the fixture corpus is
 * authored in (see minidom.ts module doc); these tests pin that contract.
 */

import { describe, expect, it } from 'bun:test';
import { parseHtml } from './minidom';

function elementsOf(html: string, tagName: string): number {
  let count = 0;
  for (const element of parseHtml(html).root.walk()) {
    if (element.tagName === tagName) count += 1;
  }
  return count;
}

describe('minidom — structure', () => {
  it('parses nested elements, text, and preserves tree order', () => {
    const doc = parseHtml('<div><p>hello</p><p>world</p></div>');
    const div = doc.root.childNodes[0];
    expect(div?.nodeType).toBe(1);
    if (div?.nodeType !== 1) throw new Error('unreachable');
    expect(div.tagName).toBe('div');
    expect(div.childNodes).toHaveLength(2);
    expect(div.textContent).toBe('helloworld');
  });

  it('skips doctype and comments', () => {
    const doc = parseHtml('<!DOCTYPE html><!-- hi --><html><body>x</body></html>');
    const html = doc.root.childNodes[0];
    if (html?.nodeType !== 1) throw new Error('expected html element');
    expect(html.tagName).toBe('html');
    expect(elementsOf('<!-- c --><div></div>', 'div')).toBe(1);
  });

  it('treats stray < as text', () => {
    const doc = parseHtml('<p>1 < 2</p>');
    const p = doc.root.childNodes[0];
    if (p?.nodeType !== 1) throw new Error('unreachable');
    expect(p.textContent).toBe('1 < 2');
  });
});

describe('minidom — attributes', () => {
  it('parses double-quoted, single-quoted, unquoted, and boolean attributes', () => {
    const doc = parseHtml('<input type="text" data-a=\'v\' data-b=v data-flag>');
    const input = doc.root.childNodes[0];
    if (input?.nodeType !== 1) throw new Error('unreachable');
    expect(input.getAttribute('type')).toBe('text');
    expect(input.getAttribute('data-a')).toBe('v');
    expect(input.getAttribute('data-b')).toBe('v');
    expect(input.getAttribute('data-flag')).toBe('');
    expect(input.hasAttribute('data-flag')).toBe(true);
  });

  it('lowercases attribute and tag names', () => {
    const doc = parseHtml('<DIV DATA-X="1"></DIV>');
    const div = doc.root.childNodes[0];
    if (div?.nodeType !== 1) throw new Error('unreachable');
    expect(div.tagName).toBe('div');
    expect(div.getAttribute('data-x')).toBe('1');
  });

  it('keeps > inside quoted attribute values', () => {
    const doc = parseHtml('<p title="a > b">t</p>');
    const p = doc.root.childNodes[0];
    if (p?.nodeType !== 1) throw new Error('unreachable');
    expect(p.getAttribute('title')).toBe('a > b');
  });

  it('decodes entities in text and attribute values', () => {
    const doc = parseHtml('<p title="Tom &amp; Jerry">a &lt; b &amp; c &#65; &#x42;</p>');
    const p = doc.root.childNodes[0];
    if (p?.nodeType !== 1) throw new Error('unreachable');
    expect(p.getAttribute('title')).toBe('Tom & Jerry');
    expect(p.textContent).toBe('a < b & c A B');
  });

  it('passes unknown entities through literally', () => {
    const doc = parseHtml('<p>&nope;</p>');
    const p = doc.root.childNodes[0];
    if (p?.nodeType !== 1) throw new Error('unreachable');
    expect(p.textContent).toBe('&nope;');
  });
});

describe('minidom — void and raw-text elements', () => {
  it('void elements never swallow following content', () => {
    const html = '<img src="a.png"><p>after</p>';
    expect(elementsOf(html, 'img')).toBe(1);
    expect(elementsOf(html, 'p')).toBe(1);
  });

  it('self-closing syntax works for non-void elements too', () => {
    const html = '<div/><span>x</span>';
    expect(elementsOf(html, 'div')).toBe(1);
    expect(elementsOf(html, 'span')).toBe(1);
  });

  it('script/style content is raw text (markup inside is not parsed)', () => {
    const html = '<script>if (a < b) { x("</p>"); }</script><p>after</p>';
    expect(elementsOf(html, 'script')).toBe(1);
    expect(elementsOf(html, 'p')).toBe(1);
    const doc = parseHtml(html);
    const script = doc.root.childNodes[0];
    if (script?.nodeType !== 1) throw new Error('unreachable');
    expect(script.textContent).toContain('a < b');
  });

  it('textarea content is text and entity-decoded', () => {
    const doc = parseHtml('<textarea>a &amp; b</textarea>');
    const textarea = doc.root.childNodes[0];
    if (textarea?.nodeType !== 1) throw new Error('unreachable');
    expect(textarea.textContent).toBe('a & b');
  });
});

describe('minidom — lenient recovery', () => {
  it('auto-closes unclosed elements at EOF', () => {
    const doc = parseHtml('<div><p>unclosed');
    const div = doc.root.childNodes[0];
    if (div?.nodeType !== 1) throw new Error('unreachable');
    expect(div.textContent).toBe('unclosed');
  });

  it('ignores stray close tags', () => {
    const html = '</p><div>x</div></span>';
    expect(elementsOf(html, 'div')).toBe(1);
  });

  it('closes intermediate elements when an outer close arrives', () => {
    const html = '<ul><li>one<li>two</ul><p>after</p>';
    expect(elementsOf(html, 'li')).toBe(2);
    expect(elementsOf(html, 'p')).toBe(1);
  });
});

describe('minidom — element API', () => {
  it('closest() walks ancestors', () => {
    const doc = parseHtml('<form><p><button>b</button></p></form>');
    const button = [...doc.root.walk()].find((element) => element.tagName === 'button');
    expect(button?.closest('p')?.tagName).toBe('p');
    expect(button?.closest('form')?.tagName).toBe('form');
    expect(button?.closest('table')).toBeNull();
  });

  it('walk() is depth-first pre-order and includes the start element', () => {
    const doc = parseHtml('<a><b><c></c></b><d></d></a>');
    const root = doc.root.childNodes[0];
    if (root?.nodeType !== 1) throw new Error('unreachable');
    const order = [...root.walk()].map((element) => element.tagName);
    expect(order).toEqual(['a', 'b', 'c', 'd']);
  });

  it('setAttribute/replace text children support the fill semantics', () => {
    const doc = parseHtml('<input value="old"><textarea>old</textarea>');
    const input = [...doc.root.walk()].find((element) => element.tagName === 'input');
    const textarea = [...doc.root.walk()].find((element) => element.tagName === 'textarea');
    input?.setAttribute('value', 'new');
    textarea?.childNodes.splice(0, textarea.childNodes.length);
    textarea?.appendText('new text');
    expect(input?.getAttribute('value')).toBe('new');
    expect(textarea?.textContent).toBe('new text');
  });
});
