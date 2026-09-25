/**
 * @clapp/journey — minidom: a minimal, dependency-free HTML document model.
 *
 * This is the "own minimal DOM shim" option named by CLAPP-012: the DOM
 * action applier (replayer.ts) needs to parse fixture HTML and resolve
 * role/name/testId selectors against a document tree, and the package
 * deliberately carries ZERO runtime dependencies so it — and the b01
 * corpus it serves — remains fully self-contained inside a network-deny
 * execution profile.
 *
 * Honest scope (see README "Known limitations"):
 * - Parses the WELL-FORMED HTML subset the CLAPP fixture corpus is authored
 *   in: explicit open/close tags; double-, single-, unquoted and boolean
 *   attributes; comments; doctype; void elements; raw-text elements
 *   (script/style) and RCDATA elements (textarea/title); numeric and common
 *   named character references.
 * - It is NOT a full HTML5 parser: no implied tags (no <tbody> synthesis,
 *   no <p> auto-close recovery), no <template>, no foreign-content rules.
 *   Malformed input degrades LENIENTLY instead of throwing: stray close
 *   tags are ignored, unclosed elements auto-close at EOF, unknown entities
 *   pass through literally.
 * - No layout engine, no CSS cascade, no script execution. "Visibility" in
 *   the replayer is decided by the hidden attribute, inline
 *   display:none/visibility:hidden, and input[type=hidden] only.
 */

/** DOM nodeType constants (the only two this model needs). */
export const ELEMENT_NODE = 1;
export const TEXT_NODE = 3;

export interface MiniText {
  readonly nodeType: typeof TEXT_NODE;
  data: string;
}

export type MiniNode = MiniText | MiniElement;

export class MiniElement {
  readonly nodeType: typeof ELEMENT_NODE = ELEMENT_NODE;
  /** Lowercased tag name ('div', 'a', ...). */
  readonly tagName: string;
  /** Lowercased attribute names → decoded values (boolean attrs → ''). */
  readonly attributes = new Map<string, string>();
  readonly childNodes: MiniNode[] = [];
  parentNode: MiniElement | null = null;

  constructor(tagName: string) {
    this.tagName = tagName.toLowerCase();
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name.toLowerCase()) ?? null;
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name.toLowerCase());
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name.toLowerCase(), value);
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name.toLowerCase());
  }

  appendChild(node: MiniNode): MiniNode {
    if (node.nodeType === ELEMENT_NODE) {
      node.parentNode = this;
    }
    this.childNodes.push(node);
    return node;
  }

  appendText(data: string): MiniText {
    const text: MiniText = { nodeType: TEXT_NODE, data };
    this.childNodes.push(text);
    return text;
  }

  /** Concatenated descendant text, in tree order. */
  get textContent(): string {
    let out = '';
    for (const child of this.childNodes) {
      out += child.nodeType === TEXT_NODE ? child.data : child.textContent;
    }
    return out;
  }

  /** Depth-first pre-order walk of this element and all descendants. */
  *walk(): Generator<MiniElement, void, void> {
    yield this;
    for (const child of this.childNodes) {
      if (child.nodeType === ELEMENT_NODE) {
        yield* child.walk();
      }
    }
  }

  /** Nearest ancestor-or-self whose tag name matches (case-insensitive). */
  closest(tagName: string): MiniElement | null {
    const wanted = tagName.toLowerCase();
    if (this.tagName === wanted) {
      return this;
    }
    let current = this.parentNode;
    while (current !== null) {
      if (current.tagName === wanted) {
        return current;
      }
      current = current.parentNode;
    }
    return null;
  }

  /** Value of the `id` attribute, or ''. */
  get id(): string {
    return this.getAttribute('id') ?? '';
  }
}

/** A parsed document: a synthetic `#document` root element. */
export interface MiniDocument {
  readonly root: MiniElement;
}

// ---------------------------------------------------------------------------
// Character references
// ---------------------------------------------------------------------------

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0', // true non-breaking space (U+00A0)
  copy: '©',
  reg: '®',
  trade: '™',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  deg: '°',
  middot: '·',
  times: '×',
  bull: '•',
};

function decodeEntities(input: string): string {
  if (!input.includes('&')) {
    return input;
  }
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = Number.parseInt(body.slice(2), 16);
      return codePointOr(code, whole);
    }
    if (body.startsWith('#')) {
      const code = Number.parseInt(body.slice(1), 10);
      return codePointOr(code, whole);
    }
    return NAMED_ENTITIES[body] ?? whole;
  });
}

function codePointOr(code: number, fallback: string): string {
  if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) {
    return fallback;
  }
  try {
    return String.fromCodePoint(code);
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Tag scanning
// ---------------------------------------------------------------------------

const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

/** Elements whose content is raw text (no markup, no entity decoding). */
const RAW_TEXT_ELEMENTS = new Set(['script', 'style']);

/** Elements whose content is text with entities but no markup. */
const RCDATA_ELEMENTS = new Set(['textarea', 'title']);

function isTagNameChar(ch: string | undefined): boolean {
  if (ch === undefined) return false;
  return /[a-zA-Z0-9-]/.test(ch);
}

function isWhitespace(ch: string | undefined): boolean {
  if (ch === undefined) return false;
  return /\s/.test(ch);
}

interface ScannedOpenTag {
  tagName: string;
  attributes: Array<[string, string]>;
  selfClosing: boolean;
  /** Index just past the '>' of this tag. */
  next: number;
}

function scanOpenTag(html: string, start: number): ScannedOpenTag {
  // `start` points at '<'; the caller guarantees a letter follows.
  let i = start + 1;
  let tagName = '';
  while (isTagNameChar(html[i])) {
    tagName += html[i];
    i += 1;
  }
  const attributes: Array<[string, string]> = [];
  let selfClosing = false;

  for (;;) {
    while (isWhitespace(html[i])) i += 1;
    if (html[i] === undefined) {
      return { tagName, attributes, selfClosing, next: i };
    }
    if (html[i] === '>') {
      return { tagName, attributes, selfClosing, next: i + 1 };
    }
    if (html[i] === '/') {
      if (html[i + 1] === '>') {
        selfClosing = true;
        return { tagName, attributes, selfClosing, next: i + 2 };
      }
      i += 1; // stray '/' — tolerate
      continue;
    }
    // Attribute name.
    let name = '';
    while (html[i] !== undefined && !isWhitespace(html[i]) && html[i] !== '=' && html[i] !== '>' && html[i] !== '/') {
      name += html[i];
      i += 1;
    }
    if (name === '') {
      // Tolerate junk characters inside a tag.
      i += 1;
      continue;
    }
    while (isWhitespace(html[i])) i += 1;
    if (html[i] !== '=') {
      attributes.push([name, '']); // boolean attribute
      continue;
    }
    i += 1; // consume '='
    while (isWhitespace(html[i])) i += 1;
    const quote = html[i];
    if (quote === '"' || quote === "'") {
      i += 1;
      let value = '';
      while (html[i] !== undefined && html[i] !== quote) {
        value += html[i];
        i += 1;
      }
      i += 1; // closing quote (or EOF)
      attributes.push([name, decodeEntities(value)]);
    } else {
      let value = '';
      while (html[i] !== undefined && !isWhitespace(html[i]) && html[i] !== '>') {
        value += html[i];
        i += 1;
      }
      attributes.push([name, decodeEntities(value)]);
    }
  }
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/** Parses HTML into a MiniDocument (lenient; see module doc). */
export function parseHtml(html: string): MiniDocument {
  const root = new MiniElement('#document');
  const stack: MiniElement[] = [root];
  const parent = (): MiniElement => stack[stack.length - 1] as MiniElement;

  let i = 0;
  const len = html.length;
  while (i < len) {
    const lt = html.indexOf('<', i);
    if (lt === -1) {
      parent().appendText(decodeEntities(html.slice(i)));
      break;
    }
    if (lt > i) {
      parent().appendText(decodeEntities(html.slice(i, lt)));
    }
    // Comment: <!-- ... -->
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      i = end === -1 ? len : end + 3;
      continue;
    }
    // Doctype or other markup declaration: <!DOCTYPE html>, <![CDATA[...]>
    if (html[lt + 1] === '!') {
      const end = html.indexOf('>', lt + 2);
      i = end === -1 ? len : end + 1;
      continue;
    }
    // Close tag: </name ...>
    if (html[lt + 1] === '/') {
      const end = html.indexOf('>', lt + 2);
      const segment = end === -1 ? html.slice(lt + 2) : html.slice(lt + 2, end);
      const closeName = segment.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
      if (closeName !== '') {
        for (let depth = stack.length - 1; depth >= 1; depth -= 1) {
          const candidate = stack[depth] as MiniElement;
          if (candidate.tagName === closeName) {
            stack.length = depth; // auto-close everything above the match
            break;
          }
        }
        // Unmatched close tags are ignored (lenient).
      }
      i = end === -1 ? len : end + 1;
      continue;
    }
    // Open tag (only when a letter follows '<'; otherwise treat as text).
    if (/[a-zA-Z]/.test(html[lt + 1] ?? '')) {
      const scanned = scanOpenTag(html, lt);
      const element = new MiniElement(scanned.tagName);
      for (const [name, value] of scanned.attributes) {
        element.setAttribute(name, value);
      }
      parent().appendChild(element);
      const isVoid = VOID_ELEMENTS.has(element.tagName);
      const keepsChildren = !isVoid && !scanned.selfClosing;
      if (keepsChildren) {
        if (RAW_TEXT_ELEMENTS.has(element.tagName) || RCDATA_ELEMENTS.has(element.tagName)) {
          const closeMarker = `</${element.tagName}`;
          const lowerFrom = html.toLowerCase();
          const closeAt = lowerFrom.indexOf(closeMarker, scanned.next);
          const rawEnd = closeAt === -1 ? len : closeAt;
          const raw = html.slice(scanned.next, rawEnd);
          if (raw !== '') {
            element.appendText(RCDATA_ELEMENTS.has(element.tagName) ? decodeEntities(raw) : raw);
          }
          if (closeAt === -1) {
            i = len;
          } else {
            const gt = html.indexOf('>', closeAt);
            i = gt === -1 ? len : gt + 1;
          }
          continue;
        }
        stack.push(element);
      }
      i = scanned.next;
      continue;
    }
    // Stray '<' — treat as literal text.
    parent().appendText('<');
    i = lt + 1;
  }

  return { root };
}
