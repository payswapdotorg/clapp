/**
 * @clapp/observe — DOM semantics: role table + target resolution.
 *
 * `TargetSelector` and `JourneyAction` come from the journey contract v0
 * (byte-identical mirror in ./journey-contract.ts; canonical owner
 * @clapp/journey) so recorded journeys resolve against the SAME selector
 * shape this package understands — no runtime dependency on the unbuilt
 * journey package.
 *
 * The ROLE_TABLE is a deliberately SIMPLIFIED, context-insensitive mapping
 * of tags/ARIA to semantic roles (a real a11y engine like Playwright's
 * computes context-sensitive roles: `header` is only `banner` at top level,
 * etc.). We own this simplification: it is deterministic, portable to any
 * serialized DOM (not just a live one), and good enough for role/name
 * anchoring. Fidelity gap documented in README "Known limitations".
 *
 * Target resolution contract: a selector resolves to a UNIQUE node —
 * multiple matches without an `nth` disambiguator are an error (ambiguous),
 * never a silent first-match. Name matching is EXACT against the collapsed
 * accessible name (subtree text or aria-label/alt/title/placeholder) — no
 * fuzzy containment, so resolution is deterministic by construction.
 */

import type { TargetSelector } from './journey-contract';
import type { SerializedNode } from './dom-serializer';

/** Tags with an implicit semantic role (context-insensitive v0 mapping). */
export const ROLE_TABLE: Readonly<Record<string, string>> = {
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

/** input[type] → implicit role (fallback for unknown types: textbox). */
const INPUT_TYPE_ROLES: Readonly<Record<string, string>> = {
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

/** Roles a user can operate — click/fill targets must resolve to these. */
export const ACTIONABLE_ROLES: ReadonlySet<string> = new Set([
  'button',
  'link',
  'textbox',
  'searchbox',
  'checkbox',
  'radio',
  'switch',
  'combobox',
  'listbox',
  'option',
  'slider',
  'spinbutton',
  'tab',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'treeitem',
  'scrollbar',
]);

export function isActionableRole(role: string): boolean {
  return ACTIONABLE_ROLES.has(role);
}

/** Minimal node shape role resolution needs (raw or serialized both fit). */
export interface SemanticsInput {
  tag: string;
  attrs?: Record<string, string>;
}

/**
 * Semantic role for a node: an explicit `role` attribute wins (first
 * whitespace token, lowercased — ARIA role lists), then input[type], then
 * the tag table, then 'generic'.
 */
export function roleFor(node: SemanticsInput): string {
  const explicit = node.attrs?.['role']?.trim();
  if (explicit !== undefined && explicit !== '') {
    const first = explicit.split(/\s+/)[0] ?? explicit;
    return first.toLowerCase();
  }
  const tag = node.tag.toLowerCase();
  if (tag === 'input') {
    const type = (node.attrs?.['type'] ?? 'text').toLowerCase();
    return INPUT_TYPE_ROLES[type] ?? 'textbox';
  }
  return ROLE_TABLE[tag] ?? 'generic';
}

/** Collapse runs of whitespace and trim — the text-normalization used for names. */
export function collapseText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

const SUBTREE_TEXT_CAP = 512;

/** Concatenated own + descendant text, whitespace-collapsed, capped. */
export function subtreeText(node: SerializedNode): string {
  let buffer = '';
  const visit = (current: SerializedNode): void => {
    if (buffer.length >= SUBTREE_TEXT_CAP) return;
    if (current.text !== undefined) buffer += current.text + ' ';
    for (const child of current.children ?? []) {
      visit(child);
      if (buffer.length >= SUBTREE_TEXT_CAP) return;
    }
  };
  visit(node);
  return collapseText(buffer.slice(0, SUBTREE_TEXT_CAP));
}

/**
 * Accessible-name approximation (v0): aria-label, else collapsed subtree
 * text, else alt, else title, else placeholder. Exact-match anchoring —
 * see module header.
 */
export function accessibleName(node: SerializedNode): string {
  const aria = node.attrs?.['aria-label']?.trim();
  if (aria !== undefined && aria !== '') return collapseText(aria);
  const text = subtreeText(node);
  if (text !== '') return text;
  const alt = node.attrs?.['alt']?.trim();
  if (alt !== undefined && alt !== '') return collapseText(alt);
  const title = node.attrs?.['title']?.trim();
  if (title !== undefined && title !== '') return collapseText(title);
  const placeholder = node.attrs?.['placeholder']?.trim();
  if (placeholder !== undefined && placeholder !== '') return collapseText(placeholder);
  return '';
}

/** A resolved, unique target: the child-index path from the tree root + a node summary. */
export interface ResolvedTarget {
  /** element-child indices from the serialized root (root itself = []) */
  path: number[];
  node: SerializedNode;
  role: string;
  name: string;
}

export type TargetResolution =
  | { ok: true; target: ResolvedTarget }
  | {
      ok: false;
      reason: 'invalid-selector' | 'no-match' | 'ambiguous' | 'not-actionable';
      message: string;
      matchCount?: number;
    };

export interface ResolveTargetOptions {
  /** require the resolved role to be actionable (click/fill targets); default false */
  requireActionable?: boolean;
}

/**
 * Resolves a selector to a UNIQUE node in a serialized tree.
 * All provided fields (role, name, testId) must match (AND). Multiple
 * matches without `nth` are ambiguous; `nth` indexes the match list.
 */
export function resolveTarget(
  root: SerializedNode,
  selector: TargetSelector,
  options: ResolveTargetOptions = {},
): TargetResolution {
  const hasRole = selector.role !== undefined && selector.role !== '';
  const hasName = selector.name !== undefined && selector.name !== '';
  const hasTestId = selector.testId !== undefined && selector.testId !== '';
  if (!hasRole && !hasName && !hasTestId) {
    return { ok: false, reason: 'invalid-selector', message: 'selector needs at least one of role/name/testId' };
  }
  if (selector.nth !== undefined && (!Number.isInteger(selector.nth) || selector.nth < 0)) {
    return { ok: false, reason: 'invalid-selector', message: 'nth must be a non-negative integer' };
  }

  const matches: Array<{ path: number[]; node: SerializedNode }> = [];
  const visit = (node: SerializedNode, path: number[]): void => {
    let matched = true;
    if (hasTestId && node.attrs?.['data-testid'] !== selector.testId) matched = false;
    if (matched && hasRole && roleFor(node) !== selector.role) matched = false;
    if (matched && hasName && accessibleName(node) !== selector.name) matched = false;
    if (matched) matches.push({ path, node });
    const children = node.children ?? [];
    for (let i = 0; i < children.length; i++) {
      visit(children[i]!, [...path, i]);
    }
  };
  visit(root, []);

  if (matches.length === 0) {
    return { ok: false, reason: 'no-match', message: describeSelector(selector), matchCount: 0 };
  }
  const chosen = selector.nth !== undefined ? matches[selector.nth] : matches[0];
  if (chosen === undefined) {
    return {
      ok: false,
      reason: 'no-match',
      message: `${describeSelector(selector)} matched ${matches.length} nodes; nth=${String(selector.nth)} is out of range`,
      matchCount: matches.length,
    };
  }
  if (selector.nth === undefined && matches.length > 1) {
    return {
      ok: false,
      reason: 'ambiguous',
      message: `${describeSelector(selector)} matched ${matches.length} nodes; add nth or a stricter selector`,
      matchCount: matches.length,
    };
  }
  const role = roleFor(chosen.node);
  if (options.requireActionable === true && !isActionableRole(role)) {
    return {
      ok: false,
      reason: 'not-actionable',
      message: `${describeSelector(selector)} resolved to role '${role}', which is not actionable`,
      matchCount: matches.length,
    };
  }
  return {
    ok: true,
    target: { path: chosen.path, node: chosen.node, role, name: accessibleName(chosen.node) },
  };
}

function describeSelector(selector: TargetSelector): string {
  const parts: string[] = [];
  if (selector.role !== undefined) parts.push(`role=${selector.role}`);
  if (selector.name !== undefined) parts.push(`name=${JSON.stringify(selector.name)}`);
  if (selector.testId !== undefined) parts.push(`testId=${selector.testId}`);
  if (selector.nth !== undefined) parts.push(`nth=${String(selector.nth)}`);
  return `selector(${parts.join(', ')})`;
}
