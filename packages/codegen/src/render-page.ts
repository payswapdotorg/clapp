/**
 * @clapp/codegen — HTML rendering for a PlannedPage (CLAPP-031).
 *
 * Renders a page's flat element list (document order) into well-formed,
 * deterministic semantic HTML. The b01 corpus (packages/journey/fixtures/
 * b01) is the architectural template: nav landmarks with aria-labels,
 * h1-h6 headings, links/buttons with accessible names, forms as
 * <form action method> with one label+control pair per field and a
 * <button type="submit">.
 *
 * STRUCTURE RULES (deterministic; documented for the planner):
 *
 * 1. LANDMARK CONTAINERS — a kind 'other' element whose role is one of
 *    banner / main / contentinfo / complementary / article / region opens
 *    the corresponding tag (<header> <main> <footer> <aside> <article>
 *    <section>) and absorbs every following element as a child until the
 *    next landmark container (or end of list). Landmarks cannot nest in
 *    v0.1 rendering (an inner landmark closes the outer one) — honest
 *    limitation: the flat plan list encodes order + landmarks, not a
 *    full tree.
 *
 * 2. NAVIGATION GROUPS — a kind 'navigation' element renders <nav> and
 *    absorbs the immediately following RUN of kind 'link' elements as its
 *    children (stops at the first non-link). Planners must not place
 *    non-nav links directly after a navigation element.
 *
 * 3. Everything else renders as a leaf at the current level.
 *
 * HONEST LIMITATIONS (also in the generated README):
 * - accessible names render via visible text or aria-label when the plan
 *   name differs from the text; kind 'text' elements render <p> with no
 *   aria-label (a paragraph has no name semantics).
 * - planned images carry alt text but no src in the contract; the renderer
 *   synthesizes a deterministic placeholder asset path (assets/<slug>.svg)
 *   served by the generated server.
 * - checkbox fields render unchecked (the plan carries no state).
 * - list items come from the element's text, one <li> per line.
 */

import type { PlannedElement, PlannedField, PlannedForm, PlannedPage } from './synthesis-contract';
import { collapseWhitespace, escapeAttr, escapeText, fieldDomId, imageAssetName, indent } from './util';

/** Landmark roles (kind 'other') → absorbing container tags. */
const LANDMARK_TAGS: Readonly<Record<string, string>> = {
  banner: 'header',
  main: 'main',
  contentinfo: 'footer',
  complementary: 'aside',
  article: 'article',
  region: 'section',
};

/** Implicit a11y roles of the tags this renderer emits (role-attr decision). */
const IMPLICIT_TAG_ROLES: Readonly<Record<string, string>> = {
  header: 'banner',
  main: 'main',
  footer: 'contentinfo',
  aside: 'complementary',
  article: 'article',
  section: 'region',
  nav: 'navigation',
  a: 'link',
  button: 'button',
  img: 'img',
  form: 'form',
  ul: 'list',
  p: 'paragraph',
  div: 'group',
};

/** Implicit roles of the input types this renderer emits. */
const IMPLICIT_INPUT_ROLES: Readonly<Record<string, string>> = {
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

const INPUT_TYPES_WITH_LABEL = new Set(['checkbox', 'radio']);

function requireLevel(element: PlannedElement): number {
  const level = element.level ?? 2;
  if (!Number.isInteger(level) || level < 1 || level > 6) {
    throw new TypeError(
      `codegen: element ${element.id} has invalid heading level ${String(element.level)} (must be an integer 1-6, or absent for the default 2)`,
    );
  }
  return level;
}

/** tag attribute helper: id, then name, then (optionally) type, then extras. */
function inputAttributes(field: PlannedField, domId: string, extra: string[] = [], includeType = true): string {
  const attrs = [`id="${escapeAttr(domId)}"`, `name="${escapeAttr(field.name)}"`];
  if (includeType) {
    attrs.push(`type="${escapeAttr(field.type)}"`);
  }
  attrs.push(...extra);
  if (field.required === true) {
    attrs.push('required');
  }
  if (field.testId !== undefined) {
    attrs.push(`data-testid="${escapeAttr(field.testId)}"`);
  }
  return attrs.join(' ');
}

/** Renders one label+control pair (or a bare control for hidden fields). */
function renderField(field: PlannedField, form: PlannedForm, depth: number): string[] {
  const lines: string[] = [];
  const pad = indent(depth);
  const domId = fieldDomId(form.id, field.name);

  if (field.type === 'hidden') {
    // Hidden inputs are invisible; a label pairing would be noise.
    lines.push(`${pad}<input ${inputAttributes(field, domId)}>`);
    return lines;
  }

  if (field.type === 'radio') {
    for (const [index, option] of (field.options ?? []).entries()) {
      const optionId = fieldDomId(form.id, field.name, option.value);
      const extra = [
        `value="${escapeAttr(option.value)}"`,
        ...(index === 0 ? ['checked'] : []),
      ];
      lines.push(`${pad}<p>`);
      lines.push(`${pad}  <input ${inputAttributes(field, optionId, extra)}>`);
      lines.push(`${pad}  <label for="${escapeAttr(optionId)}">${escapeText(option.label)}</label>`);
      lines.push(`${pad}</p>`);
    }
    return lines;
  }

  lines.push(`${pad}<p>`);
  lines.push(`${pad}  <label for="${escapeAttr(domId)}">${escapeText(field.label)}</label>`);

  if (field.type === 'select') {
    lines.push(`${pad}  <select ${inputAttributes(field, domId, [], false)}>`);
    for (const [index, option] of (field.options ?? []).entries()) {
      const selected = index === 0 ? ' selected' : '';
      lines.push(`${pad}    <option value="${escapeAttr(option.value)}"${selected}>${escapeText(option.label)}</option>`);
    }
    lines.push(`${pad}  </select>`);
  } else if (field.type === 'textarea') {
    const attrs = [`id="${escapeAttr(domId)}"`, `name="${escapeAttr(field.name)}"`];
    if (field.required === true) {
      attrs.push('required');
    }
    if (field.testId !== undefined) {
      attrs.push(`data-testid="${escapeAttr(field.testId)}"`);
    }
    lines.push(`${pad}  <textarea ${attrs.join(' ')}></textarea>`);
  } else if (INPUT_TYPES_WITH_LABEL.has(field.type)) {
    // checkbox: rendered unchecked — the plan contract carries no state.
    lines.push(`${pad}  <input ${inputAttributes(field, domId)}>`);
  } else {
    const extra = field.placeholder !== undefined ? [`placeholder="${escapeAttr(field.placeholder)}"`] : [];
    lines.push(`${pad}  <input ${inputAttributes(field, domId, extra)}>`);
  }

  lines.push(`${pad}</p>`);
  return lines;
}

/** Renders a kind 'form' element: the referenced PlannedForm in full. */
function renderFormElement(element: PlannedElement, form: PlannedForm, depth: number): string[] {
  const pad = indent(depth);
  const lines: string[] = [];
  const attrs = [`action="${escapeAttr(form.action)}"`, `method="${escapeAttr(form.method)}"`];
  if (element.testId !== undefined) {
    attrs.push(`data-testid="${escapeAttr(element.testId)}"`);
  }
  const role = roleAttr(element, 'form');
  lines.push(`${pad}<form ${attrs.join(' ')}${role}>`);
  for (const field of form.fields) {
    lines.push(...renderField(field, form, depth + 1));
  }
  const submitAttrs = ['type="submit"'];
  if (form.submitTestId !== undefined) {
    submitAttrs.push(`data-testid="${escapeAttr(form.submitTestId)}"`);
  }
  lines.push(`${pad}  <button ${submitAttrs.join(' ')}>${escapeText(form.submitLabel)}</button>`);
  lines.push(`${pad}</form>`);
  return lines;
}

/** Explicit role attribute when the planned role differs from the tag's implicit role. */
function roleAttr(element: PlannedElement, tag: string, inputType?: string): string {
  if (element.role === undefined) {
    return '';
  }
  const implicit =
    tag === 'input'
      ? (inputType !== undefined ? IMPLICIT_INPUT_ROLES[inputType.toLowerCase()] : undefined) ?? 'textbox'
      : IMPLICIT_TAG_ROLES[tag];
  if (element.role === implicit) {
    return '';
  }
  return ` role="${escapeAttr(element.role)}"`;
}

/** aria-label when a planned accessible name differs from the visible text. */
function ariaLabelAttr(element: PlannedElement): string {
  if (element.name === undefined) {
    return '';
  }
  if (element.text !== undefined && collapseWhitespace(element.name) === collapseWhitespace(element.text)) {
    return '';
  }
  return ` aria-label="${escapeAttr(element.name)}"`;
}

/** Renders a leaf element (everything except navigation/landmark containers). */
function renderLeaf(element: PlannedElement, form: PlannedForm | undefined, depth: number): string[] {
  const pad = indent(depth);
  const testIdAttr = element.testId !== undefined ? ` data-testid="${escapeAttr(element.testId)}"` : '';
  const text = escapeText(element.text ?? '');

  switch (element.kind) {
    case 'heading': {
      const level = requireLevel(element);
      const tag = `h${level}`;
      return [`${pad}<${tag}${testIdAttr}${ariaLabelAttr(element)}${roleAttr(element, tag)}>${text}</${tag}>`];
    }
    case 'text':
      return [`${pad}<p${roleAttr(element, 'p')}>${text}</p>`];
    case 'link': {
      const href = element.href !== undefined && element.href !== '' ? element.href : '#';
      return [
        `${pad}<a href="${escapeAttr(href)}"${ariaLabelAttr(element)}${testIdAttr}${roleAttr(element, 'a')}>${text}</a>`,
      ];
    }
    case 'button':
      return [
        `${pad}<button type="button"${ariaLabelAttr(element)}${testIdAttr}${roleAttr(element, 'button')}>${text}</button>`,
      ];
    case 'image': {
      const alt = element.alt ?? element.name ?? '';
      const src = `assets/${imageAssetName(element.alt ?? element.name ?? element.id)}`;
      return [
        `${pad}<img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}"${ariaLabelIfNamed(element)}${testIdAttr}${roleAttr(element, 'img')}>`,
      ];
    }
    case 'list': {
      const items = (element.text ?? '')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '');
      const lines = [`${pad}<ul${ariaLabelAttr(element)}${testIdAttr}${roleAttr(element, 'ul')}>`];
      for (const item of items) {
        lines.push(`${pad}  <li>${escapeText(item)}</li>`);
      }
      lines.push(`${pad}</ul>`);
      return lines;
    }
    case 'form': {
      if (form === undefined) {
        throw new TypeError(
          `codegen: element ${element.id} references formId ${String(element.formId)} which is not declared on page — the plan is malformed`,
        );
      }
      return renderFormElement(element, form, depth);
    }
    case 'other':
    case 'navigation':
    default: {
      // Non-landmark 'other' leaf: a plain container div (optional role/text).
      return [`${pad}<div${roleAttr(element, 'div')}${testIdAttr}>${text}</div>`];
    }
  }
}

/** images name via alt; aria-label only when an explicit name differs. */
function ariaLabelIfNamed(element: PlannedElement): string {
  if (element.name === undefined) {
    return '';
  }
  const alt = element.alt ?? '';
  if (collapseWhitespace(element.name) === collapseWhitespace(alt)) {
    return '';
  }
  return ` aria-label="${escapeAttr(element.name)}"`;
}

/** The landmark tag for an element, or null when it is not a landmark. */
function landmarkTagFor(element: PlannedElement): string | null {
  if (element.kind !== 'other' || element.role === undefined) {
    return null;
  }
  return LANDMARK_TAGS[element.role] ?? null;
}

/**
 * Renders one planned page to a complete HTML document (deterministic:
 * same page → byte-identical HTML). `storageScripts` are pre-rendered
 * inline <script> lines appended at the end of <body> (see storage.ts).
 */
export function renderPageHtml(page: PlannedPage, storageScripts: string[] = []): string {
  const formsById = new Map<string, PlannedForm>(page.forms.map((form) => [form.id, form]));

  const lines: string[] = [];
  let openLandmark: string | null = null;

  const closeLandmark = (): void => {
    if (openLandmark !== null) {
      lines.push(`${indent(1)}</${openLandmark}>`);
      openLandmark = null;
    }
  };

  let index = 0;
  while (index < page.elements.length) {
    const element: PlannedElement | undefined = page.elements[index];
    if (element === undefined) {
      break; // unreachable under the loop bound; keeps the checker honest
    }

    const landmarkTag = landmarkTagFor(element);
    if (landmarkTag !== null) {
      closeLandmark();
      const attrs = [landmarkTag + ariaLabelAttr(element)];
      if (element.testId !== undefined) {
        attrs.push(`data-testid="${escapeAttr(element.testId)}"`);
      }
      lines.push(`${indent(1)}<${attrs.join(' ')}${roleAttr(element, landmarkTag)}>`);
      if (element.text !== undefined && element.text !== '') {
        lines.push(`${indent(2)}<p>${escapeText(element.text)}</p>`);
      }
      openLandmark = landmarkTag;
      index += 1;
      continue;
    }

    if (element.kind === 'navigation') {
      const childDepth = openLandmark !== null ? 2 : 1;
      lines.push(`${indent(childDepth)}<nav${ariaLabelAttr(element)}${element.testId !== undefined ? ` data-testid="${escapeAttr(element.testId)}"` : ''}${roleAttr(element, 'nav')}>`);
      index += 1;
      // Absorb the following run of link elements as the nav's children.
      while (index < page.elements.length) {
        const candidate: PlannedElement | undefined = page.elements[index];
        if (candidate === undefined || candidate.kind !== 'link') {
          break;
        }
        lines.push(...renderLeaf(candidate, undefined, childDepth + 1));
        index += 1;
      }
      lines.push(`${indent(childDepth)}</nav>`);
      continue;
    }

    lines.push(...renderLeaf(element, element.formId !== undefined ? formsById.get(element.formId) : undefined, openLandmark !== null ? 2 : 1));
    index += 1;
  }
  closeLandmark();

  const body = ['<body>', ...lines, ...storageScripts.map((script) => `${indent(1)}${script}`), '</body>'];

  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="utf-8">',
    `  <title>${escapeText(page.title)}</title>`,
    '</head>',
    ...body,
    '</html>',
    '',
  ].join('\n');
}
