/**
 * @clapp/explore — zero-dependency HTML walker (CLAPP-022).
 *
 * The exploration policy enumerates candidates with its OWN parser and tree
 * walk — the frozen @clapp/journey applier deliberately does not expose its
 * internal minidom state, so enumeration through the public surface is
 * impossible by design. The walker only CHOOSES; the applier remains the
 * executor of record (every chosen target is verified first with an
 * assert-visible action executed through the applier).
 *
 * Honest scope (the same honesty bar as @clapp/journey's minidom shim — this
 * is NOT a full HTML5 parser):
 * - Parses the well-formed HTML subset the CLAPP corpora are authored in:
 *   explicit open/close tags, double/single/unquoted/boolean attributes,
 *   comments and doctype (skipped), void elements, self-closing tags,
 *   raw-text elements (script/style — their CONTENT is skipped by design and
 *   never exposed, matching what a dom capture serializes) and RCDATA
 *   elements (textarea/title — content is text, entities decoded).
 * - Lenient on malformed input: stray close tags are ignored, unclosed
 *   elements auto-close at EOF, unknown entities pass through literally.
 * - NOT handled, by design: implied tags (<tbody> synthesis, <p> auto-close
 *   recovery), <template>, foreign content, CDATA in HTML, <base href>
 *   resolution, external stylesheets (no layout engine, no CSS cascade).
 * - Two role vocabularies are mirrored deliberately, because the frozen
 *   packages compute roles for different consumers:
 *     · `roleForCapture` mirrors @clapp/observe's dom-semantics ROLE_TABLE
 *       naming (link/button/textbox/form/navigation/heading/...) — used for
 *       the actionable list, IR components, and the SerializedNode capture
 *       form, so exploration dom evidence matches observation-run evidence.
 *     · `journeyRole`/`journeyAccessibleName` mirror @clapp/journey's a11y
 *       approximation EXACTLY (including its documented simplifications),
 *       because TargetSelectors must resolve against the applier's own
 *       role/name computation. Where the two tables disagree (e.g.
 *       input[type=number] is `textbox` to the applier but `spinbutton` in
 *       the observe table), the actionable keeps both: `role` is the observe
 *       name and `target.role` is the journey name.
 * - The serialized capture form mirrors @clapp/observe's dom-serializer
 *   semantics: attribute allowlist + aria-/data- prefixes, input password
 *   values never serialized, script/style/noscript/template text dropped,
 *   own text whitespace-collapsed, depth/node caps with flagged truncation.
 */

import type { TargetSelector } from '@clapp/journey';
import type { SerializedNode } from '@clapp/observe';

// ---------------------------------------------------------------------------
// Node model
// ---------------------------------------------------------------------------

/** A text node (no tag, just decoded character data). */
export interface WalkerText {
  readonly nodeType: 'text';
  data: string;
}

/** An element node: lowercased tag, decoded attributes, document order. */
export interface WalkerElement {
  readonly nodeType: 'element';
  tag: string;
  /** Lowercased attribute names → decoded values (boolean attrs → ''). */
  attrs: Record<string, string>;
  children: Array<WalkerElement | WalkerText>;
  parent: WalkerElement | null;
}

/** Concatenated descendant text of an element, in tree order. */
export function textContent(element: WalkerElement): string {
  let out = '';
  for (const child of element.children) {
    out += child.nodeType === 'text' ? child.data : textContent(child);
  }
  return out;
}

/** Concatenated DIRECT text children (what a dom capture serializes as `text`). */
export function ownText(element: WalkerElement): string {
  let out = '';
  for (const child of element.children) {
    if (child.nodeType === 'text') out += child.data;
  }
  return out;
}

/** Depth-first pre-order walk of an element and all element descendants. */
export function* walkElements(element: WalkerElement): Generator<WalkerElement, void, void> {
  yield element;
  for (const child of element.children) {
    if (child.nodeType === 'element') {
      yield* walkElements(child);
    }
  }
}

/** Nearest ancestor-or-self with the given (lowercased) tag name. */
export function closest(element: WalkerElement, tagName: string): WalkerElement | null {
  const wanted = tagName.toLowerCase();
  let current: WalkerElement | null = element;
  while (current !== null) {
    if (current.tag === wanted) return current;
    current = current.parent;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Character references (same honest subset as the journey minidom)
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

function decodeEntities(input: string): string {
  if (!input.includes('&')) {
    return input;
  }
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      return codePointOr(Number.parseInt(body.slice(2), 16), whole);
    }
    if (body.startsWith('#')) {
      return codePointOr(Number.parseInt(body.slice(1), 10), whole);
    }
    return NAMED_ENTITIES[body] ?? whole;
  });
}

// ---------------------------------------------------------------------------
// Parser (tags, attributes, text — comments/doctype skipped by design)
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

/** Elements whose content is raw text: skipped by design, never exposed. */
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

/**
 * Parses HTML into a synthetic `#document` element (lenient; see module doc).
 * The parse is deterministic: identical input always yields the same tree.
 */
export function parseHtml(html: string): WalkerElement {
  const root: WalkerElement = {
    nodeType: 'element',
    tag: '#document',
    attrs: {},
    children: [],
    parent: null,
  };
  const stack: WalkerElement[] = [root];
  const parent = (): WalkerElement => stack[stack.length - 1] as WalkerElement;

  let i = 0;
  const len = html.length;
  while (i < len) {
    const lt = html.indexOf('<', i);
    if (lt === -1) {
      parent().children.push({ nodeType: 'text', data: decodeEntities(html.slice(i)) });
      break;
    }
    if (lt > i) {
      parent().children.push({ nodeType: 'text', data: decodeEntities(html.slice(i, lt)) });
    }
    // Comment: <!-- ... --> — skipped by design.
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      i = end === -1 ? len : end + 3;
      continue;
    }
    // Doctype or other markup declaration: <!DOCTYPE html> — skipped.
    if (html[lt + 1] === '!') {
      const end = html.indexOf('>', lt + 2);
      i = end === -1 ? len : end + 1;
      continue;
    }
    // Close tag: </name ...> — lenient (unmatched closes ignored).
    if (html[lt + 1] === '/') {
      const end = html.indexOf('>', lt + 2);
      const segment = end === -1 ? html.slice(lt + 2) : html.slice(lt + 2, end);
      const closeName = segment.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
      if (closeName !== '') {
        for (let depth = stack.length - 1; depth >= 1; depth -= 1) {
          const candidate = stack[depth];
          if (candidate !== undefined && candidate.tag === closeName) {
            stack.length = depth; // auto-close everything above the match
            break;
          }
        }
      }
      i = end === -1 ? len : end + 1;
      continue;
    }
    // Open tag (only when a letter follows '<'; otherwise literal text).
    if (/[a-zA-Z]/.test(html[lt + 1] ?? '')) {
      const scanned = scanOpenTag(html, lt);
      const element: WalkerElement = {
        nodeType: 'element',
        tag: scanned.tagName.toLowerCase(),
        attrs: {},
        children: [],
        parent: parent(),
      };
      for (const [name, value] of scanned.attributes) {
        element.attrs[name.toLowerCase()] = value;
      }
      parent().children.push(element);
      const isVoid = VOID_ELEMENTS.has(element.tag);
      const keepsChildren = !isVoid && !scanned.selfClosing;
      if (keepsChildren) {
        if (RAW_TEXT_ELEMENTS.has(element.tag) || RCDATA_ELEMENTS.has(element.tag)) {
          const closeMarker = `</${element.tag}`;
          const lowerFrom = html.toLowerCase();
          const closeAt = lowerFrom.indexOf(closeMarker, scanned.next);
          const rawEnd = closeAt === -1 ? len : closeAt;
          const raw = html.slice(scanned.next, rawEnd);
          if (raw !== '') {
            // script/style content is SKIPPED BY DESIGN (never exposed);
            // textarea/title content is text with entities decoded.
            if (RCDATA_ELEMENTS.has(element.tag)) {
              element.children.push({ nodeType: 'text', data: decodeEntities(raw) });
            }
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
    parent().children.push({ nodeType: 'text', data: '<' });
    i = lt + 1;
  }

  return root;
}

// ---------------------------------------------------------------------------
// Role tables — two deliberate mirrors (see module doc)
// ---------------------------------------------------------------------------

/**
 * observe ROLE_TABLE mirror (context-insensitive v0 mapping; explicit `role`
 * attributes are NOT consulted here — @clapp/observe's serializer computes
 * capture roles from its FILTERED attribute set, which drops `role`, so this
 * mirror does the same to stay shape-identical).
 */
const OBSERVE_ROLE_TABLE: Readonly<Record<string, string>> = {
  a: 'link',
  area: 'link',
  button: 'button',
  nav: 'navigation',
  main: 'main',
  aside: 'complementary',
  header: 'banner',
  footer: 'contentinfo',
  form: 'form',
  h1: 'heading',
  h2: 'heading',
  h3: 'heading',
  h4: 'heading',
  h5: 'heading',
  h6: 'heading',
  img: 'img',
  svg: 'img',
  figure: 'figure',
  figcaption: 'caption',
  ul: 'list',
  ol: 'list',
  dl: 'list',
  li: 'listitem',
  dt: 'term',
  dd: 'definition',
  table: 'table',
  thead: 'rowgroup',
  tbody: 'rowgroup',
  tfoot: 'rowgroup',
  tr: 'row',
  th: 'columnheader',
  td: 'cell',
  caption: 'caption',
  select: 'combobox',
  option: 'option',
  optgroup: 'group',
  textarea: 'textbox',
  label: 'label',
  fieldset: 'group',
  legend: 'legend',
  datalist: 'listbox',
  output: 'status',
  progress: 'progressbar',
  meter: 'meter',
  details: 'group',
  summary: 'disclosure',
  dialog: 'dialog',
  audio: 'audio',
  video: 'video',
  canvas: 'canvas',
  math: 'math',
  hr: 'separator',
  strong: 'strong',
  em: 'emphasis',
  mark: 'mark',
  abbr: 'abbreviation',
  code: 'code',
  pre: 'code',
  blockquote: 'blockquote',
  q: 'quote',
  time: 'time',
  address: 'group',
  search: 'search',
  article: 'article',
  section: 'region',
};

/** input[type] → observe-style implicit role (fallback: textbox). */
const OBSERVE_INPUT_TYPE_ROLES: Readonly<Record<string, string>> = {
  button: 'button',
  submit: 'button',
  reset: 'button',
  image: 'button',
  file: 'button',
  checkbox: 'checkbox',
  radio: 'radio',
  hidden: 'presentation',
  number: 'spinbutton',
  range: 'slider',
};

/** observe-style role for an element (explicit role attrs excluded — see above). */
export function roleForCapture(element: WalkerElement): string {
  const tag = element.tag;
  if (tag === 'input') {
    const type = (element.attrs['type'] ?? 'text').toLowerCase();
    return OBSERVE_INPUT_TYPE_ROLES[type] ?? 'textbox';
  }
  return OBSERVE_ROLE_TABLE[tag] ?? 'generic';
}

/**
 * @clapp/journey a11y mirror — input-type → role table. Where the journey
 * table has no entry the fallback is 'textbox' (text-like inputs are
 * fillable there); 'hidden' maps to 'none' (never matches a selector).
 */
const JOURNEY_INPUT_TYPE_ROLES: Readonly<Record<string, string>> = {
  hidden: 'none',
  submit: 'button',
  reset: 'button',
  button: 'button',
  image: 'button',
  checkbox: 'checkbox',
  radio: 'radio',
  range: 'slider',
  color: 'textbox',
  search: 'searchbox',
};

/** @clapp/journey implicitRole mirror (partial table; null = no implicit role). */
export function journeyImplicitRole(element: WalkerElement): string | null {
  switch (element.tag) {
    case 'a':
      return element.attrs['href'] !== undefined ? 'link' : null;
    case 'button':
    case 'summary':
      return 'button';
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6':
      return 'heading';
    case 'img':
      return 'img';
    case 'input': {
      const type = (element.attrs['type'] ?? 'text').toLowerCase();
      return JOURNEY_INPUT_TYPE_ROLES[type] ?? 'textbox';
    }
    case 'textarea':
      return 'textbox';
    case 'select':
      return 'combobox';
    case 'nav':
      return 'navigation';
    case 'form':
      return 'form';
    default:
      return null;
  }
}

/** @clapp/journey effectiveRole mirror: explicit `role` attr (trimmed, NOT
 * split on whitespace — v0 approximation) wins, else the implicit role. */
export function journeyRole(element: WalkerElement): string | null {
  const role = element.attrs['role'];
  if (role !== undefined && role.trim() !== '') {
    return role.trim().toLowerCase();
  }
  return journeyImplicitRole(element);
}

/** Collapses runs of whitespace (incl. U+00A0) and trims — the journey name
 * normalization (also used by the applier's exact-match name comparison). */
export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** Roles whose accessible name may come from text content (journey mirror). */
const NAME_FROM_CONTENT_ROLES = new Set([
  'link',
  'button',
  'heading',
  'listitem',
  'option',
  'cell',
  'columnheader',
  'rowheader',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'tab',
  'treeitem',
  'tooltip',
  'caption',
  'figcaption',
  'definition',
  'term',
  'note',
]);

/** Elements that can be named by an associated <label> (journey mirror). */
const LABELABLE_ELEMENTS = new Set(['input', 'select', 'textarea', 'output', 'meter', 'progress']);

function journeyLabelText(element: WalkerElement, root: WalkerElement): string | null {
  const id = element.attrs['id'];
  if (id !== undefined && id !== '') {
    for (const candidate of walkElements(root)) {
      if (candidate.tag === 'label' && candidate.attrs['for'] === id) {
        return textContent(candidate);
      }
    }
  }
  const enclosing = closest(element, 'label');
  return enclosing !== null ? textContent(enclosing) : null;
}

/**
 * @clapp/journey accessibleName mirror — the SIMPLIFIED priority order the
 * applier resolves names with (aria-label → alt for images → associated
 * label → text content for name-from-content roles → submit/reset/button
 * input value → placeholder → title). Returns null when no name derives.
 */
export function journeyAccessibleName(element: WalkerElement, root: WalkerElement): string | null {
  const ariaLabel = element.attrs['aria-label'];
  if (ariaLabel !== undefined && ariaLabel.trim() !== '') {
    return collapseWhitespace(ariaLabel);
  }
  const isImageInput = element.tag === 'input' && (element.attrs['type'] ?? '').toLowerCase() === 'image';
  if (element.tag === 'img' || isImageInput) {
    const alt = element.attrs['alt'];
    if (alt !== undefined && alt.trim() !== '') {
      return collapseWhitespace(alt);
    }
  }
  if (LABELABLE_ELEMENTS.has(element.tag)) {
    const label = journeyLabelText(element, root);
    if (label !== null && label.trim() !== '') {
      return collapseWhitespace(label);
    }
  }
  const role = journeyRole(element);
  if (role !== null && NAME_FROM_CONTENT_ROLES.has(role)) {
    const text = textContent(element);
    if (text.trim() !== '') {
      return collapseWhitespace(text);
    }
  }
  if (element.tag === 'input') {
    const type = (element.attrs['type'] ?? 'text').toLowerCase();
    if (type === 'submit' || type === 'reset' || type === 'button') {
      const value = element.attrs['value'];
      if (value !== undefined && value.trim() !== '') {
        return collapseWhitespace(value);
      }
    }
  }
  const placeholder = element.attrs['placeholder'];
  if (placeholder !== undefined && placeholder.trim() !== '') {
    return collapseWhitespace(placeholder);
  }
  const title = element.attrs['title'];
  if (title !== undefined && title.trim() !== '') {
    return collapseWhitespace(title);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Actionable enumeration
// ---------------------------------------------------------------------------

/**
 * Roles the walker lists as actionable — the compact interactive +
 * structural-anchor vocabulary (observe ROLE_TABLE naming). Deliberately NOT
 * listed: option (noise inside selects), listbox datalists, disclosure
 * (summary), img, and every other structural tag — the walk still contains
 * them in the serialized tree, they are just not actionable candidates.
 */
export const ACTIONABLE_CAPTURE_ROLES: ReadonlySet<string> = new Set([
  'link',
  'button',
  'textbox',
  'searchbox',
  'combobox',
  'checkbox',
  'radio',
  'slider',
  'spinbutton',
  'form',
  'navigation',
  'heading',
]);

/** One compact actionable element, in document order. */
export interface ActionableElement {
  /** Element path from <html>, e.g. "html>body>header>nav>a[2]" (1-based
   * same-tag sibling index, present only when ambiguous). */
  path: string;
  /** Lowercased tag name. */
  tag: string;
  /** observe ROLE_TABLE naming (dom-capture semantics). */
  role: string;
  /** The element's JOURNEY role (@clapp/journey a11y mirror) — what the
   *  frozen applier resolves it as; null when the journey table has no
   *  implicit role and no explicit role attribute. This is the act-class
   *  signal (textbox/searchbox are fillable, button is clickable), NOT the
   *  selector's role field (testId-anchored selectors carry none). */
  journeyRole: string | null;
  /** journey-style accessible name ('' when none derives). */
  name: string;
  /** data-testid when present. */
  testId?: string;
  /** Raw href for links (unresolved — callers resolve against the page URL). */
  href?: string;
  /** Owning form identity: the form's testId, else id, else path. */
  form?: string;
  /** input[type] value for input elements (absent for other tags). */
  inputType?: string;
  /**
   * Journey-compatible, unambiguous TargetSelector for this element
   * (role/name computed with the journey a11y mirror; `nth` added whenever
   * the selector would otherwise be ambiguous, mirroring the applier's
   * strict-mode resolution). ABSENT when the element cannot be targeted
   * through the frozen applier (no testId, no journey role, and no name) or
   * when it carries aria-hidden="true" (the applier never matches those).
   */
  target?: TargetSelector;
}

/** Result of walking one page of HTML. */
export interface WalkedPage {
  /** The full parse tree (synthetic #document root). */
  document: WalkerElement;
  /** Actionable elements in document order. */
  actionables: ActionableElement[];
  /** Walked elements keyed by their path (actionables' element lookup). */
  elementsByPath: Map<string, WalkerElement>;
  /** SerializedNode-shaped capture form (root = the <html> element). */
  serialized: DomCaptureTree;
}

/** The dom-capture payload form: { subkind, root, nodeCount, truncated }. */
export interface DomCaptureTree {
  subkind: 'dom-tree';
  root: SerializedNode;
  nodeCount: number;
  truncated: boolean;
}

/** Computes the path of an element ('html>body>...>tag[k]' — 1-based same-tag
 * sibling index, present only when ambiguous; '' for the #document root). */
export function elementPathOf(element: WalkerElement): string {
  if (element.parent === null || element.tag === '#document') return '';
  const parentPath = elementPathOf(element.parent);
  const sameTagSiblings = element.parent.children.filter(
    (child): child is WalkerElement => child.nodeType === 'element' && child.tag === element.tag,
  );
  const indexAmongSameTag = sameTagSiblings.indexOf(element);
  const ambiguous = sameTagSiblings.length > 1;
  const segment = ambiguous ? `${element.tag}[${indexAmongSameTag + 1}]` : element.tag;
  return parentPath === '' ? segment : `${parentPath}>${segment}`;
}

/** Identity of a form element for ActionableElement.form. */
function formIdentity(form: WalkerElement): string {
  const testId = form.attrs['data-testid'];
  if (testId !== undefined && testId !== '') return testId;
  const id = form.attrs['id'];
  if (id !== undefined && id !== '') return id;
  return elementPathOf(form);
}

interface SelectorCensus {
  /** testId → elements carrying it (pre-order). */
  byTestId: Map<string, WalkerElement[]>;
  /** journey role → elements with that role (pre-order). */
  byRole: Map<string, WalkerElement[]>;
  /** `${role}\u0000${name}` → elements (pre-order); role may be '' for name-only. */
  byRoleName: Map<string, WalkerElement[]>;
}

function censusKey(role: string | null, name: string): string {
  return `${role ?? ''}\u0000${name}`;
}

function buildCensus(document: WalkerElement): SelectorCensus {
  const byTestId = new Map<string, WalkerElement[]>();
  const byRole = new Map<string, WalkerElement[]>();
  const byRoleName = new Map<string, WalkerElement[]>();
  for (const element of walkElements(document)) {
    if (element.tag === '#document') continue;
    const testId = element.attrs['data-testid'];
    if (testId !== undefined) {
      const bucket = byTestId.get(testId);
      if (bucket !== undefined) bucket.push(element);
      else byTestId.set(testId, [element]);
    }
    const role = journeyRole(element);
    if (role !== null && role !== 'none') {
      const roleBucket = byRole.get(role);
      if (roleBucket !== undefined) roleBucket.push(element);
      else byRole.set(role, [element]);
      const name = journeyAccessibleName(element, document);
      if (name !== null) {
        const key = censusKey(role, name);
        const nameBucket = byRoleName.get(key);
        if (nameBucket !== undefined) nameBucket.push(element);
        else byRoleName.set(key, [element]);
      }
    }
  }
  return { byTestId, byRole, byRoleName };
}

/**
 * Builds an unambiguous TargetSelector for an element, mirroring the frozen
 * applier's resolution rules: candidates exclude aria-hidden="true" elements;
 * testId/role/name AND together; nth disambiguates among matches (0-based,
 * document pre-order); without nth, more than one match is an ambiguity
 * error the explorer would hit at probe time — so nth is added eagerly.
 * Returns undefined when no anchor exists at all.
 */
function buildSelector(
  element: WalkerElement,
  document: WalkerElement,
  census: SelectorCensus,
): TargetSelector | undefined {
  if (element.attrs['aria-hidden'] === 'true') return undefined;
  const testId = element.attrs['data-testid'];
  if (testId !== undefined) {
    const matches = (census.byTestId.get(testId) ?? []).filter(
      (candidate) => candidate.attrs['aria-hidden'] !== 'true',
    );
    const index = matches.indexOf(element);
    if (index === -1) return { testId };
    return matches.length === 1 ? { testId } : { testId, nth: index };
  }
  const role = journeyRole(element);
  const name = journeyAccessibleName(element, document);
  if (role === null && name === null) return undefined;
  if (name !== null) {
    const key = censusKey(role, name);
    const matches = (census.byRoleName.get(key) ?? []).filter(
      (candidate) => candidate.attrs['aria-hidden'] !== 'true',
    );
    const index = matches.indexOf(element);
    if (index === -1) {
      return role !== null ? { role, name } : { name };
    }
    const base: TargetSelector = role !== null ? { role, name } : { name };
    return matches.length === 1 ? base : { ...base, nth: index };
  }
  // role-only anchor (no name derives).
  const matches = (census.byRole.get(role as string) ?? []).filter(
    (candidate) => candidate.attrs['aria-hidden'] !== 'true',
  );
  const index = matches.indexOf(element);
  if (index === -1) return { role: role as string };
  return matches.length === 1 ? { role: role as string } : { role: role as string, nth: index };
}

/**
 * Walks one page of HTML: parses it, enumerates the compact actionable list,
 * and produces the SerializedNode-shaped capture form. Pure and
 * deterministic — identical input yields an identical result.
 */
export function walkHtml(html: string): WalkedPage {
  const document = parseHtml(html);
  const census = buildCensus(document);
  const actionables: ActionableElement[] = [];
  const elementsByPath = new Map<string, WalkerElement>();

  for (const element of walkElements(document)) {
    if (element.tag === '#document') continue;
    const captureRole = roleForCapture(element);
    if (!ACTIONABLE_CAPTURE_ROLES.has(captureRole)) continue;
    if (element.attrs['aria-hidden'] === 'true') continue; // untargetable by design
    const path = elementPathOf(element);
    elementsByPath.set(path, element);
    const name = journeyAccessibleName(element, document) ?? '';
    const actionable: ActionableElement = {
      path,
      tag: element.tag,
      role: captureRole,
      journeyRole: journeyRole(element),
      name,
    };
    const testId = element.attrs['data-testid'];
    if (testId !== undefined) actionable.testId = testId;
    if (element.tag === 'a') {
      const href = element.attrs['href'];
      if (href !== undefined && href !== '') actionable.href = href;
    }
    if (element.tag === 'input') {
      actionable.inputType = (element.attrs['type'] ?? 'text').toLowerCase();
    }
    const form = closest(element, 'form');
    if (form !== null && form !== element) {
      actionable.form = formIdentity(form);
    }
    if (element.tag === 'form') {
      actionable.form = formIdentity(element);
    }
    const target = buildSelector(element, document, census);
    if (target !== undefined) actionable.target = target;
    actionables.push(actionable);
  }

  return {
    document,
    actionables,
    elementsByPath,
    serialized: serializeForCapture(document),
  };
}

// ---------------------------------------------------------------------------
// SerializedNode capture form (mirrors @clapp/observe's dom-serializer)
// ---------------------------------------------------------------------------

/** Attributes kept in captures (plus aria- and data- prefixed attributes) —
 * the frozen observe allowlist, mirrored so exploration dom captures are
 * shape-identical to observation-run dom captures. */
export const CAPTURE_ATTR_ALLOWLIST: readonly string[] = [
  'id',
  'class',
  'name',
  'type',
  'href',
  'src',
  'alt',
  'title',
  'for',
  'placeholder',
  'value',
  'rel',
  'target',
  'lang',
  'dir',
  'disabled',
  'checked',
  'selected',
  'multiple',
  'rows',
  'cols',
];

export const CAPTURE_ATTR_PREFIXES: readonly string[] = ['aria-', 'data-'];

const CAPTURE_TEXT_SKIPPED_TAGS = new Set(['script', 'style', 'noscript', 'template']);

const CAPTURE_MAX_DEPTH = 48;
const CAPTURE_MAX_NODES = 20_000;

function filterCaptureAttrs(
  tag: string,
  attrs: Record<string, string>,
): Record<string, string> {
  const allowSet = new Set(CAPTURE_ATTR_ALLOWLIST);
  const out: Record<string, string> = {};
  for (const key of Object.keys(attrs)) {
    if (key === 'value' && tag === 'input' && (attrs['type'] ?? 'text').toLowerCase() === 'password') {
      continue; // password values are never serialized
    }
    const allowed = allowSet.has(key) || CAPTURE_ATTR_PREFIXES.some((prefix) => key.startsWith(prefix));
    if (allowed) out[key] = attrs[key] as string;
  }
  return out;
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Serializes the parse into the SerializedNode-shaped capture form, mirroring
 * observe's normalizeDomTree: filtered attribute subset, password values
 * dropped, script/style/noscript/template text dropped, own text collapsed,
 * roles annotated with the observe table, depth/node caps with flagged
 * truncation. The capture root is the <html> element.
 */
export function serializeForCapture(
  document: WalkerElement,
  options: { maxDepth?: number; maxNodes?: number } = {},
): DomCaptureTree {
  const maxDepth = options.maxDepth ?? CAPTURE_MAX_DEPTH;
  const maxNodes = options.maxNodes ?? CAPTURE_MAX_NODES;
  let nodeCount = 0;
  let truncated = false;

  const htmlElement = document.children.find(
    (child): child is WalkerElement => child.nodeType === 'element' && child.tag === 'html',
  );

  const convert = (element: WalkerElement, depth: number): SerializedNode | null => {
    if (nodeCount >= maxNodes) {
      truncated = true;
      return null;
    }
    nodeCount += 1;
    const attrs = filterCaptureAttrs(element.tag, element.attrs);
    const node: SerializedNode = { tag: element.tag, role: roleForCapture(element) };
    if (Object.keys(attrs).length > 0) {
      node.attrs = attrs;
    }
    if (!CAPTURE_TEXT_SKIPPED_TAGS.has(element.tag)) {
      const text = collapse(ownText(element));
      if (text !== '') node.text = text;
    }
    if (depth < maxDepth) {
      const children: SerializedNode[] = [];
      for (const child of element.children) {
        if (child.nodeType !== 'element') continue;
        const converted = convert(child, depth + 1);
        if (converted !== null) children.push(converted);
      }
      if (children.length > 0) node.children = children;
    } else if (element.children.some((child) => child.nodeType === 'element')) {
      truncated = true;
    }
    return node;
  };

  const root =
    (htmlElement !== undefined ? convert(htmlElement, 0) : null) ?? { tag: 'html', role: 'generic' };
  return { subkind: 'dom-tree', root, nodeCount, truncated };
}
