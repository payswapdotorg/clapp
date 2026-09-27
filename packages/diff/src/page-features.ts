/**
 * @clapp/diff — page feature extraction (the semantic comparison basis).
 *
 * A captured page (HTML text + its URL) is compiled, through the SAME
 * vocabulary @clapp/observe uses for live captures, into a small set of
 * comparable structural features:
 *
 *   path        — the normalized route path the page was served from;
 *   title       — the <title> text;
 *   headings    — ordered { level, text } for h1..h6 (text = the observe
 *                 accessible-name approximation, i.e. collapsed subtree
 *                 text or aria-label — the journeys' name anchor);
 *   testIds     — the sorted set of data-testid values;
 *   landmarks   — the ordered { role, name } list for the landmark roles
 *                 (banner/main/contentinfo/complementary/article/region/
 *                 navigation; name = EXPLICIT aria-label only — unnamed
 *                 landmarks compare as { role, name: '' }); forms are NOT
 *                 landmarks here: they are compared as a dedicated group;
 *   targetables — the sorted multiset of `role::name` for elements whose
 *                 role is in @clapp/observe's ACTIONABLE_ROLES (plus img),
 *                 excluding aria-hidden subtrees and unnamed elements —
 *                 i.e. the journey-targetable surface;
 *   forms       — ordered { actionPath, method, fields } where each field
 *                 carries { name, type, label, testId?, options? }; the
 *                 label uses the label[for]/enclosing-label association
 *                 (the journey applier's naming vocabulary), which the
 *                 observe approximation deliberately does not implement —
 *                 both vocabularies are used where each is honest.
 *
 * Honest scope: this is a STRUCTURAL comparison basis, not a rendering
 * engine; nesting, styling, classes, and asset bytes are out of scope
 * (visual/network dimensions are @clapp/diffext, CLAPP-041).
 */

import {
  accessibleName,
  DEFAULT_ATTR_ALLOWLIST,
  normalizeDomTree,
  type SerializedNode,
} from '@clapp/observe';
import { parseHtmlToRawTree } from './html-tree';

/** Landmark roles compared in document order (see module doc). */
export const LANDMARK_ROLES: ReadonlySet<string> = new Set([
  'banner',
  'main',
  'contentinfo',
  'complementary',
  'article',
  'region',
  'navigation',
]);

const HEADING_TAGS: ReadonlyMap<string, number> = new Map([
  ['h1', 1],
  ['h2', 2],
  ['h3', 3],
  ['h4', 4],
  ['h5', 5],
  ['h6', 6],
]);

/** One ordered heading. */
export interface HeadingFeature {
  level: number;
  text: string;
}

/** One ordered landmark (name = explicit aria-label, else ''). */
export interface LandmarkFeature {
  role: string;
  name: string;
}

/** One form field as comparable structure. */
export interface FieldFeature {
  /** the input name attribute (forms submit by name). */
  name: string;
  /** input type attr, or 'select' / 'textarea'. */
  type: string;
  /** label[for] / enclosing-label text ('' when unnamed). */
  label: string;
  testId?: string;
  /** select options, in order. */
  options?: { value: string; label: string }[];
}

/** One form as comparable structure. */
export interface FormFeature {
  actionPath: string;
  method: string;
  fields: FieldFeature[];
}

/** The full comparable feature set of one captured page. */
export interface PageFeatures {
  path: string;
  title: string;
  headings: HeadingFeature[];
  testIds: string[];
  landmarks: LandmarkFeature[];
  targetables: string[];
  forms: FormFeature[];
}

/** Normalizes a URL to its comparable route path (leading slash, no query/hash/origin). */
export function normalizeRoutePath(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname.startsWith('/') ? parsed.pathname : `/${parsed.pathname}`;
  } catch {
    const trimmed = url.split('?')[0]?.split('#')[0] ?? url;
    return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  }
}

function isAriaHidden(node: SerializedNode): boolean {
  return node.attrs?.['aria-hidden'] === 'true';
}

interface WalkState {
  headings: HeadingFeature[];
  testIds: string[];
  landmarks: LandmarkFeature[];
  targetables: string[];
  forms: FormFeature[];
  title: string | null;
  labelsById: Map<string, string>;
  actionableRoles: ReadonlySet<string>;
}

function isTargetableRole(role: string, actionableRoles: ReadonlySet<string>): boolean {
  return actionableRoles.has(role) || role === 'img';
}

function fieldFeature(node: SerializedNode, state: WalkState, enclosingLabel: string): FieldFeature {
  const attrs = node.attrs ?? {};
  let type = 'text';
  if (node.tag === 'select') {
    type = 'select';
  } else if (node.tag === 'textarea') {
    type = 'textarea';
  } else {
    type = (attrs['type'] ?? 'text').toLowerCase();
  }
  const field: FieldFeature = {
    name: attrs['name'] ?? '',
    type,
    label: labelFor(node, state, enclosingLabel),
  };
  const testId = attrs['data-testid'];
  if (testId !== undefined) {
    field.testId = testId;
  }
  if (node.tag === 'select') {
    field.options = (node.children ?? [])
      .filter((child) => child.tag === 'option')
      .map((option) => ({
        value: option.attrs?.['value'] ?? option.text ?? '',
        label: option.text ?? '',
      }));
  }
  return field;
}

/** Label association: label[for] by id, else the nearest enclosing <label>. */
function labelFor(node: SerializedNode, state: WalkState, enclosingLabel: string): string {
  const id = node.attrs?.['id'];
  if (id !== undefined && id !== '') {
    const associated = state.labelsById.get(id);
    if (associated !== undefined && associated.trim() !== '') {
      return associated;
    }
  }
  return enclosingLabel.trim() !== '' ? enclosingLabel : '';
}

function visit(
  node: SerializedNode,
  state: WalkState,
  formStack: FormFeature[],
  enclosingLabel: string,
): void {
  if (isAriaHidden(node)) {
    return;
  }
  const attrs = node.attrs ?? {};
  const testId = attrs['data-testid'];
  if (testId !== undefined && testId !== '') {
    state.testIds.push(testId);
  }
  const childEnclosingLabel = node.tag === 'label' ? accessibleName(node) : enclosingLabel;

  if (node.tag === 'title' && state.title === null) {
    state.title = node.text ?? '';
  }

  const headingLevel = HEADING_TAGS.get(node.tag);
  if (headingLevel !== undefined) {
    state.headings.push({ level: headingLevel, text: accessibleName(node) });
  }

  if (node.role === 'form' && node.tag === 'form') {
    const action = attrs['action'] ?? '';
    const form: FormFeature = {
      actionPath: action === '' ? '' : action,
      method: (attrs['method'] ?? 'get').toLowerCase(),
      fields: [],
    };
    state.forms.push(form);
    formStack.push(form);
    for (const child of node.children ?? []) {
      visit(child, state, formStack, childEnclosingLabel);
    }
    formStack.pop();
    return;
  }

  if (LANDMARK_ROLES.has(node.role)) {
    const ariaLabel = attrs['aria-label']?.trim();
    state.landmarks.push({ role: node.role, name: ariaLabel === undefined || ariaLabel === '' ? '' : ariaLabel });
  }

  if (isTargetableRole(node.role, state.actionableRoles)) {
    const name = accessibleName(node);
    if (name !== '') {
      state.targetables.push(`${node.role}::${name}`);
    }
  }

  const enclosingForm = formStack[formStack.length - 1];
  if (
    enclosingForm !== undefined &&
    (node.tag === 'input' || node.tag === 'select' || node.tag === 'textarea')
  ) {
    enclosingForm.fields.push(fieldFeature(node, state, childEnclosingLabel));
  }

  for (const child of node.children ?? []) {
    visit(child, state, formStack, childEnclosingLabel);
  }
}

function collectLabels(node: SerializedNode, into: Map<string, string>): void {
  if (isAriaHidden(node)) {
    return;
  }
  if (node.tag === 'label') {
    const forAttr = node.attrs?.['for'];
    if (forAttr !== undefined && forAttr !== '' && !into.has(forAttr)) {
      into.set(forAttr, accessibleName(node));
    }
  }
  for (const child of node.children ?? []) {
    collectLabels(child, into);
  }
}

/**
 * The attribute allowlist for page capture normalization: the observe
 * default PLUS the form-submission attributes (action/method) the form
 * comparison needs — an explicit, documented extension of the frozen
 * serializer vocabulary, not a bypass (everything else is filtered exactly
 * as observe filters it).
 */
const PAGE_ATTR_ALLOWLIST: readonly string[] = [...DEFAULT_ATTR_ALLOWLIST, 'action', 'method'];

/**
 * Compiles a captured page's HTML + URL into its comparable feature set.
 * The actionable-role set is injected so the caller controls the exact
 * journey-targetable vocabulary (observe's ACTIONABLE_ROLES at runtime).
 */
export function extractPageFeatures(
  html: string,
  pageUrl: string,
  actionableRoles: ReadonlySet<string>,
): PageFeatures {
  const raw = parseHtmlToRawTree(html);
  const { root } = normalizeDomTree(raw, { attrAllowlist: PAGE_ATTR_ALLOWLIST });

  const state: WalkState = {
    headings: [],
    testIds: [],
    landmarks: [],
    targetables: [],
    forms: [],
    title: null,
    labelsById: new Map(),
    actionableRoles,
  };
  collectLabels(root, state.labelsById);
  visit(root, state, [], '');

  return {
    path: normalizeRoutePath(pageUrl),
    title: state.title ?? '',
    headings: state.headings,
    testIds: [...new Set(state.testIds)].sort(),
    landmarks: state.landmarks,
    targetables: [...state.targetables].sort(),
    forms: state.forms.map((form) => ({
      ...form,
      actionPath: form.actionPath === '' ? normalizeRoutePath(pageUrl) : normalizeRoutePath(new URL(form.actionPath, pageUrl).href),
    })),
  };
}
