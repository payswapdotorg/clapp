/**
 * @clapp/journey — a11y approximation for TargetSelector resolution.
 *
 * The journey contract resolves elements by role/name anchors, not brittle
 * XPath. This module computes, against a minidom tree:
 *
 * - `implicitRole` — a PARTIAL implicit-role table for common HTML
 *   elements (documented subset; unknown elements have no implicit role).
 * - `effectiveRole` — the explicit `role` attribute when present, else the
 *   implicit role. NOTE: multi-token `role` attribute values are NOT
 *   split (v0 approximation: the trimmed value must match exactly).
 * - `accessibleName` — a SIMPLIFIED accessible-name computation. It does
 *   NOT implement the full WAI-ARIA algorithm: no aria-labelledby
 *   traversal, no name-from-content for nested controls, no landmark
 *   scoping (a <footer> inside a <blockquote> still maps to contentinfo).
 *   Priority order: aria-label → alt (img / image input) → associated
 *   <label> (label[for] then enclosing label, for labelable form controls)
 *   → text content (name-from-content roles only) → value (submit/reset/
 *   button inputs) → placeholder → title.
 */

import type { MiniElement } from './minidom';

/** Roles whose accessible name may come from the element's text content. */
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

/** Elements that can be named by an associated <label>. */
const LABELABLE_ELEMENTS = new Set(['input', 'select', 'textarea', 'output', 'meter', 'progress']);

/** Input types → implicit roles (everything text-like falls back to textbox). */
const INPUT_TYPE_ROLES: Readonly<Record<string, string>> = {
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

/** Collapses runs of whitespace (incl. U+00A0) and trims — used for name matching. */
export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** Partial implicit-role table (see module doc — honest subset). */
export function implicitRole(element: MiniElement): string | null {
  switch (element.tagName) {
    case 'a':
      return element.hasAttribute('href') ? 'link' : null;
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
      const type = (element.getAttribute('type') ?? 'text').toLowerCase();
      return INPUT_TYPE_ROLES[type] ?? 'textbox';
    }
    case 'textarea':
      return 'textbox';
    case 'select':
      return 'combobox';
    case 'nav':
      return 'navigation';
    case 'main':
      return 'main';
    case 'form':
      return 'form';
    case 'ul':
    case 'ol':
      return 'list';
    case 'li':
      return 'listitem';
    case 'datalist':
      return 'listbox';
    case 'option':
      return 'option';
    case 'table':
      return 'table';
    case 'tr':
      return 'row';
    case 'td':
      return 'cell';
    case 'th':
      return 'columnheader';
    case 'thead':
    case 'tbody':
    case 'tfoot':
      return 'rowgroup';
    case 'header':
      return 'banner';
    case 'footer':
      return 'contentinfo';
    case 'aside':
      return 'complementary';
    case 'article':
      return 'article';
    case 'section':
      return 'region';
    case 'search':
      return 'search';
    case 'figure':
      return 'figure';
    case 'figcaption':
      return 'caption';
    case 'dialog':
      return 'dialog';
    case 'progress':
      return 'progressbar';
    case 'output':
      return 'status';
    case 'details':
      return 'group';
    default:
      return null;
  }
}

/** Explicit role attribute (trimmed) wins; otherwise the implicit role. */
export function effectiveRole(element: MiniElement): string | null {
  const role = element.getAttribute('role');
  if (role !== null && role.trim() !== '') {
    return role.trim().toLowerCase();
  }
  return implicitRole(element);
}

function labelText(element: MiniElement, treeRoot: MiniElement): string | null {
  const id = element.getAttribute('id');
  if (id !== null && id !== '') {
    for (const candidate of treeRoot.walk()) {
      if (candidate.tagName === 'label' && candidate.getAttribute('for') === id) {
        return candidate.textContent;
      }
    }
  }
  const enclosing = element.closest('label');
  return enclosing !== null ? enclosing.textContent : null;
}

/**
 * Simplified accessible name (see module doc for the honest priority order
 * and known omissions). Returns null when no name can be derived.
 */
export function accessibleName(element: MiniElement, treeRoot: MiniElement): string | null {
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel !== null && ariaLabel.trim() !== '') {
    return collapseWhitespace(ariaLabel);
  }
  const isImageInput =
    element.tagName === 'input' && (element.getAttribute('type') ?? '').toLowerCase() === 'image';
  if (element.tagName === 'img' || isImageInput) {
    const alt = element.getAttribute('alt');
    if (alt !== null && alt.trim() !== '') {
      return collapseWhitespace(alt);
    }
  }
  if (LABELABLE_ELEMENTS.has(element.tagName)) {
    const label = labelText(element, treeRoot);
    if (label !== null && label.trim() !== '') {
      return collapseWhitespace(label);
    }
  }
  const role = effectiveRole(element);
  if (role !== null && NAME_FROM_CONTENT_ROLES.has(role)) {
    const text = element.textContent;
    if (text.trim() !== '') {
      return collapseWhitespace(text);
    }
  }
  if (element.tagName === 'input') {
    const type = (element.getAttribute('type') ?? 'text').toLowerCase();
    if (type === 'submit' || type === 'reset' || type === 'button') {
      const value = element.getAttribute('value');
      if (value !== null && value.trim() !== '') {
        return collapseWhitespace(value);
      }
    }
  }
  const placeholder = element.getAttribute('placeholder');
  if (placeholder !== null && placeholder.trim() !== '') {
    return collapseWhitespace(placeholder);
  }
  const title = element.getAttribute('title');
  if (title !== null && title.trim() !== '') {
    return collapseWhitespace(title);
  }
  return null;
}
