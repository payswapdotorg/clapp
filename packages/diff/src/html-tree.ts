/**
 * @clapp/diff — tolerant HTML → RawDomNode parser (the capture-side DOM shim).
 *
 * The paired runner captures page HTML as TEXT (the fetched document under
 * the `replayer-dom` driver; `page.content()` under `replayer-playwright`).
 * To compare pages with the SAME structural vocabulary @clapp/observe uses,
 * the text must become a `RawDomNode` tree (`{ tag, attrs, text, children }`)
 * that `normalizeDomTree` then compacts into role-annotated `SerializedNode`s.
 *
 * @clapp/journey's minidom is internal to that package (not exported), so
 * this module is @clapp/diff's own SMALL parser. Honest scope:
 * - Handles the constructs the CLAPP corpus and generated apps emit:
 *   doctype, comments, void elements, raw-text elements (script/style),
 *   double/single/unquoted/boolean attributes, and character references
 *   (numeric + the common named set — the b01 corpus uses `&copy;`).
 * - It is NOT a spec-grade HTML parser: exotic malformed input degrades to
 *   a best-effort tree rather than throwing, and text is whitespace-
 *   collapsed downstream by normalizeDomTree (own-text collapse), so this
 *   parser preserves text verbatim.
 * - Tags are lowercased; duplicate attributes keep the first occurrence
 *   (browser behavior); `<html>` is the returned root when present,
 *   otherwise a synthetic `html` root wraps the parsed children.
 */

import type { RawDomNode } from '@clapp/observe';

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

const RAW_TEXT_ELEMENTS = new Set(['script', 'style']);

/** Named character references worth decoding beyond the numeric forms. */
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
  copy: '\u00a9',
  reg: '\u00ae',
  trade: '\u2122',
  mdash: '\u2014',
  ndash: '\u2013',
  hellip: '\u2026',
  rsquo: '\u2019',
  lsquo: '\u2018',
  rdquo: '\u201d',
  ldquo: '\u201c',
  laquo: '\u00ab',
  raquo: '\u00bb',
  times: '\u00d7',
  divide: '\u00f7',
  middot: '\u00b7',
  bull: '\u2022',
  dagger: '\u2020',
  sect: '\u00a7',
  para: '\u00b6',
  deg: '\u00b0',
  plusmn: '\u00b1',
  frac12: '\u00bd',
  sup2: '\u00b2',
  sup3: '\u00b3',
  micro: '\u00b5',
};

/** Decodes `&name;`, `&#NNN;`, and `&#xHHH;` references (unknown names pass through verbatim). */
export function decodeEntities(value: string): string {
  if (!value.includes('&')) {
    return value;
  }
  return value.replace(/&([a-zA-Z][a-zA-Z0-9]*|#[0-9]+|#[xX][0-9a-fA-F]+);/g, (match, body: string) => {
    if (body.startsWith('#')) {
      const isHex = body[1] === 'x' || body[1] === 'X';
      const codePoint = isHex
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      if (Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff) {
        try {
          return String.fromCodePoint(codePoint);
        } catch {
          return match;
        }
      }
      return match;
    }
    const named = NAMED_ENTITIES[body];
    return named !== undefined ? named : match;
  });
}

interface OpenElement {
  node: RawDomNode;
  children: RawDomNode[];
}

function appendText(stack: OpenElement[], text: string): void {
  if (text === '') {
    return;
  }
  const top = stack[stack.length - 1];
  if (top === undefined) {
    return;
  }
  const siblings = top.children;
  const last = siblings[siblings.length - 1];
  if (last !== undefined && last.text !== undefined && last.children === undefined) {
    // Merge with a preceding pure-text node (keeps the tree compact).
    last.text += text;
    return;
  }
  siblings.push({ tag: '#text', attrs: undefined, text, children: undefined });
}

function createElement(tag: string, attrs: RawDomNode['attrs']): { node: RawDomNode; children: RawDomNode[] } {
  const children: RawDomNode[] = [];
  const node: RawDomNode = {
    tag,
    attrs,
    text: undefined,
    children,
  };
  return { node, children };
}

/**
 * Parses HTML text into a RawDomNode tree rooted at `<html>` (synthesized
 * when absent), in the shape @clapp/observe's in-page walker produces:
 * element children only, with the element's direct text merged into its
 * `text` field (internal `#text` nodes are folded away by the post-pass).
 */
export function parseHtmlToRawTree(html: string): RawDomNode {
  const syntheticRootChildren: RawDomNode[] = [];
  const stack: OpenElement[] = [{ node: { tag: '#root', children: syntheticRootChildren }, children: syntheticRootChildren }];
  let index = 0;
  const length = html.length;

  const topChildren = (): RawDomNode[] => {
    const top = stack[stack.length - 1];
    return top !== undefined ? top.children : syntheticRootChildren;
  };

  while (index < length) {
    const next = html.indexOf('<', index);
    if (next === -1) {
      appendText(stack, decodeEntities(html.slice(index)));
      break;
    }
    if (next > index) {
      appendText(stack, decodeEntities(html.slice(index, next)));
    }
    index = next;

    // Comments, doctype, CDATA-ish blocks: skip to the matching closer.
    if (html.startsWith('<!--', index)) {
      const end = html.indexOf('-->', index + 4);
      index = end === -1 ? length : end + 3;
      continue;
    }
    if (html.startsWith('<!', index) || html.startsWith('<?', index)) {
      const end = html.indexOf('>', index);
      index = end === -1 ? length : end + 1;
      continue;
    }

    // Closing tag.
    if (html.startsWith('</', index)) {
      const end = html.indexOf('>', index);
      const rawName = html.slice(index + 2, end === -1 ? length : end).trim().toLowerCase();
      index = end === -1 ? length : end + 1;
      if (rawName !== '') {
        for (let depth = stack.length - 1; depth >= 1; depth -= 1) {
          const frame = stack[depth];
          if (frame !== undefined && frame.node.tag === rawName) {
            stack.length = depth; // pop through the matching open tag
            break;
          }
        }
      }
      continue;
    }

    // Opening (or self-closing) tag.
    const tagEnd = findTagEnd(html, index);
    if (tagEnd === -1) {
      appendText(stack, decodeEntities(html.slice(index)));
      break;
    }
    const tagSource = html.slice(index, tagEnd);
    index = tagEnd;
    const parsed = parseTag(tagSource);
    if (parsed === null) {
      continue;
    }
    const { tag, attrs, selfClosing } = parsed;
    if (tag === '') {
      continue;
    }

    if (RAW_TEXT_ELEMENTS.has(tag) && !selfClosing) {
      // Raw-text element: consume verbatim until its closing tag.
      const closeMarker = `</${tag}`;
      const closeAt = html.toLowerCase().indexOf(closeMarker, index);
      const rawText = html.slice(index, closeAt === -1 ? length : closeAt);
      index = closeAt === -1 ? length : html.indexOf('>', closeAt) + 1;
      const element = createElement(tag, attrs);
      element.children.push({ tag: '#text', attrs: undefined, text: rawText, children: undefined });
      topChildren().push(element.node);
      continue;
    }

    const element = createElement(tag, attrs);
    topChildren().push(element.node);
    if (!selfClosing && !VOID_ELEMENTS.has(tag)) {
      stack.push({ node: element.node, children: element.children });
    }
  }

  // Unwind: attach every open element's accumulated children.
  while (stack.length > 1) {
    stack.pop();
  }

  const roots = syntheticRootChildren.filter(
    (child) => child.tag !== '#text' || (child.text ?? '').trim() !== '',
  );
  const htmlRoot = roots.find((child) => child.tag === 'html');
  if (htmlRoot !== undefined) {
    return mergeTextChildren(htmlRoot);
  }
  return mergeTextChildren({ tag: 'html', attrs: undefined, text: undefined, children: roots });
}

/**
 * Post-pass: folds `#text` children into their parent's `text` field
 * (verbatim concatenation in document order) so the tree matches the
 * observe walker's element-children-only shape. `#text` children of the
 * root itself are dropped into the root's text.
 */
function mergeTextChildren(node: RawDomNode): RawDomNode {
  const children: RawDomNode[] = [];
  let ownText = '';
  for (const child of node.children ?? []) {
    if (child.tag === '#text') {
      ownText += child.text ?? '';
      continue;
    }
    children.push(mergeTextChildren(child));
  }
  const merged: RawDomNode = { tag: node.tag, attrs: node.attrs, text: undefined, children };
  if (ownText !== '') {
    merged.text = ownText;
  }
  if (children.length === 0) {
    merged.children = undefined;
  }
  return merged;
}

/** Finds the index just past the '>' closing a tag that starts at `start`. */
function findTagEnd(html: string, start: number): number {
  let quote: string | null = null;
  for (let i = start; i < html.length; i += 1) {
    const char = html[i];
    if (quote !== null) {
      if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '>') {
      return i + 1;
    }
  }
  return -1;
}

interface ParsedTag {
  tag: string;
  attrs: Record<string, string> | undefined;
  selfClosing: boolean;
}

function parseTag(source: string): ParsedTag | null {
  if (!source.startsWith('<')) {
    return null;
  }
  let body = source.slice(1);
  if (body.endsWith('>')) {
    body = body.slice(0, -1);
  }
  let selfClosing = false;
  if (body.endsWith('/')) {
    selfClosing = true;
    body = body.slice(0, -1);
  }
  const nameMatch = /^[a-zA-Z][a-zA-Z0-9:-]*/.exec(body);
  if (nameMatch === null) {
    return null;
  }
  const tag = nameMatch[0].toLowerCase();
  const attrsText = body.slice(nameMatch[0].length);

  const attrs: Record<string, string> = {};
  const attrPattern = /([^\s=/>"']+)(?:\s*=\s*("([^"]*)"|'([^']*)'|[^\s>]*))?/g;
  let match: RegExpExecArray | null;
  while ((match = attrPattern.exec(attrsText)) !== null) {
    const name = match[1];
    if (name === undefined || name === '') {
      continue;
    }
    const lower = name.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(attrs, lower)) {
      continue; // first occurrence wins (browser behavior)
    }
    const value = match[3] ?? match[4] ?? match[2] ?? '';
    attrs[lower] = decodeEntities(value);
  }
  return {
    tag,
    attrs: Object.keys(attrs).length > 0 ? attrs : undefined,
    selfClosing,
  };
}
