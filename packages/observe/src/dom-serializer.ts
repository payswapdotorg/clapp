/**
 * @clapp/observe — DOM subtree serializer (pure core).
 *
 * Converts the RAW tree produced by the in-page walker (dom-kit
 * DOM_TREE_FN: tag + all attrs + own text + element children) into the
 * compact structured form capture records carry:
 *
 *   { tag, role, text?, attrs?, children? }
 *
 * - attr subset: a fixed allowlist plus `aria-*`/`data-*` prefixes (the
 *   raw dump crosses a trust boundary into the runner process — the
 *   SUBSET is what enters evidence, so unrelated attributes never even
 *   reach redaction);
 * - `input[type=password]` values are DROPPED (never serialized);
 * - script/style/noscript/template text content is never serialized;
 * - own text is whitespace-collapsed;
 * - roles are annotated from dom-semantics (explicit role attr wins);
 * - depth and node-count caps bound the payload (truncation is flagged,
 *   never silent);
 * - child order is document order (evidence, preserved).
 */

import { roleFor } from './dom-semantics';

/** Raw node shape returned by the in-page DOM walker. */
export interface RawDomNode {
  tag: string;
  attrs?: Record<string, string>;
  text?: string;
  children?: RawDomNode[];
}

/** Envelope returned by the in-page walker (bounds enforced in-page too). */
export interface DomTreeEnvelope {
  root: RawDomNode;
  truncated: boolean;
  nodeCount: number;
}

/** Compact, role-annotated node form used in capture payloads. */
export interface SerializedNode {
  tag: string;
  role: string;
  /** collapsed own text (direct text children only); absent when empty */
  text?: string;
  /** filtered attribute subset; absent when empty */
  attrs?: Record<string, string>;
  /** element children in document order; absent when empty */
  children?: SerializedNode[];
}

export interface DomSerializationOptions {
  /** max serialization depth (default 48) */
  maxDepth?: number;
  /** max serialized nodes (default 20_000) */
  maxNodes?: number;
  /** exact attribute names to keep (default DEFAULT_ATTR_ALLOWLIST) */
  attrAllowlist?: readonly string[];
  /** attribute prefixes to keep (default aria- and data-) */
  attrPrefixes?: readonly string[];
}

export interface DomSerializationResult {
  root: SerializedNode;
  nodeCount: number;
  truncated: boolean;
}

/** Attributes kept by default (plus aria- and data- prefixed attributes). */
export const DEFAULT_ATTR_ALLOWLIST: readonly string[] = [
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

export const DEFAULT_ATTR_PREFIXES: readonly string[] = ['aria-', 'data-'];

const TEXT_SKIPPED_TAGS = new Set(['script', 'style', 'noscript', 'template']);

const DEFAULT_MAX_DEPTH = 48;
const DEFAULT_MAX_NODES = 20_000;

/**
 * Normalizes a raw DOM tree into the compact serialized form.
 * Total over malformed input: an absent root yields an empty html node.
 */
export function normalizeDomTree(raw: RawDomNode | null | undefined, options: DomSerializationOptions = {}): DomSerializationResult {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxNodes = options.maxNodes ?? DEFAULT_MAX_NODES;
  const allowlist = new Set(options.attrAllowlist ?? DEFAULT_ATTR_ALLOWLIST);
  const prefixes = options.attrPrefixes ?? DEFAULT_ATTR_PREFIXES;

  let nodeCount = 0;
  let truncated = false;

  const walk = (node: RawDomNode | null | undefined, depth: number): SerializedNode | null => {
    if (node === null || node === undefined || typeof node !== 'object' || typeof node.tag !== 'string') {
      return null;
    }
    if (nodeCount >= maxNodes) {
      truncated = true;
      return null;
    }
    nodeCount++;

    const tag = node.tag.toLowerCase();
    const attrs = filterAttrs(tag, node.attrs ?? {}, allowlist, prefixes);
    const serialized: SerializedNode = { tag, role: roleFor({ tag, attrs }) };
    if (Object.keys(attrs).length > 0) {
      serialized.attrs = attrs;
    }

    if (!TEXT_SKIPPED_TAGS.has(tag)) {
      const text = collapse(node.text ?? '');
      if (text !== '') serialized.text = text;
    }

    if (depth < maxDepth) {
      const children: SerializedNode[] = [];
      for (const child of node.children ?? []) {
        const serializedChild = walk(child, depth + 1);
        if (serializedChild !== null) children.push(serializedChild);
      }
      if (children.length > 0) serialized.children = children;
    } else if ((node.children ?? []).length > 0) {
      truncated = true;
    }

    return serialized;
  };

  const root = walk(raw, 0) ?? { tag: 'html', role: 'generic' };
  return { root, nodeCount, truncated };
}

function filterAttrs(
  tag: string,
  attrs: Record<string, string>,
  allowlist: Set<string>,
  prefixes: readonly string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(attrs)) {
    if (tag === 'input' && key === 'value' && (attrs['type'] ?? 'text').toLowerCase() === 'password') {
      continue; // password values are never serialized
    }
    const allowed = allowlist.has(key) || prefixes.some((prefix) => key.startsWith(prefix));
    if (allowed) out[key] = attrs[key]!;
  }
  return out;
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
