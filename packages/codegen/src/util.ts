/**
 * @clapp/codegen — small deterministic helpers shared by the renderers.
 *
 * Everything here is pure: same input → same output, always. The codegen's
 * contract is byte-determinism (same plan → byte-identical file tree), so
 * no timestamps, no randomness, no locale-dependent casing.
 */

/** Escapes text content: the three characters HTML requires (& < >). */
export function escapeText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

/** Escapes a double-quoted attribute value (& < > "). */
export function escapeAttr(value: string): string {
  return escapeText(value).replaceAll('"', '&quot;');
}

/** Collapses runs of whitespace and trims (name-vs-text comparison). */
export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Lowercase slug: runs of non-alphanumerics → '-', trimmed. Used for
 * generated package names and synthesized asset file names.
 */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-+|-+$)/g, '');
}

/**
 * Sanitizes a single URL path segment for use in generated module paths:
 * lowercase, runs of characters unsafe in file names → '-', trimmed. A
 * trailing ".html" is stripped ("/features.html" → "features") so the
 * emitted page module reads `pages/features.html.ts`.
 */
export function slugSegment(segment: string): string {
  const base = segment.toLowerCase().endsWith('.html')
    ? segment.slice(0, -'.html'.length)
    : segment;
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-+|-+$)/g, '');
  return slug === '' ? '-' : slug;
}

/**
 * Computes the generated page-module path for a route path:
 * "/" → "pages/index.html.ts"; "/features.html" → "pages/features.html.ts";
 * "/docs/guide" → "pages/docs/guide.html.ts" (nested routes create nested
 * directories). Caller is responsible for deduplicating collisions.
 */
export function pageModulePath(routePath: string): string {
  const segments = routePath.split('/').filter((segment) => segment !== '');
  if (segments.length === 0) {
    return 'pages/index.html.ts';
  }
  return `pages/${segments.map(slugSegment).join('/')}.html.ts`;
}

/**
 * Deterministic module identifier for a page module path:
 * "pages/contact-success.html.ts" → "routeContactSuccess".
 */
export function pageModuleIdentifier(modulePath: string): string {
  const withoutPrefix = modulePath.startsWith('pages/') ? modulePath.slice('pages/'.length) : modulePath;
  const stem = withoutPrefix.endsWith('.html.ts') ? withoutPrefix.slice(0, -'.html.ts'.length) : withoutPrefix;
  const parts = stem.split('/').map(slugSegment).filter((part) => part !== '' && part !== '-');
  const pascal = parts
    .map((part) =>
      part
        .split('-')
        .filter((chunk) => chunk !== '')
        .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
        .join(''),
    )
    .join('');
  return `route${pascal === '' ? 'Index' : pascal}`;
}

/**
 * Deterministic DOM id for a form field (label[for] ↔ input#id pairing):
 * "{formId}-{fieldName}", plus "-{optionValue}" for radio options so every
 * radio input of a group gets its own label. Form ids are plan-unique and
 * field names are unique within a form, so the result is page-unique.
 */
export function fieldDomId(formId: string, fieldName: string, optionValue?: string): string {
  return optionValue === undefined ? `${formId}-${fieldName}` : `${formId}-${fieldName}-${optionValue}`;
}

/**
 * Synthesized asset file name for a planned image. The plan contract
 * carries alt text but no src; the codegen renders every image with a
 * deterministic placeholder SVG served by the generated server
 * (documented in the generated README).
 */
export function imageAssetName(altText: string): string {
  const slug = slugify(altText);
  return `${slug === '' ? 'image' : slug}.svg`;
}

/** Indentation for the HTML renderer (two spaces per depth level). */
export function indent(depth: number): string {
  return '  '.repeat(Math.max(0, depth));
}

/**
 * Deterministic placeholder SVG served for a planned image's synthesized
 * asset path (the plan contract carries alt text, not sources). The alt
 * text is embedded as <title> + visible label, so real browsers show a
 * meaningful, accessible placeholder.
 */
export function imageAssetSvg(altText: string): string {
  const esc = altText
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 280" role="img">' +
    `<title>${esc}</title>` +
    '<rect width="480" height="280" fill="#f5f5f4"/>' +
    '<rect x="16" y="16" width="448" height="248" fill="none" stroke="#d6d3d1" stroke-width="2"/>' +
    '<text x="240" y="148" text-anchor="middle" font-family="system-ui, sans-serif" font-size="18" fill="#57534e">' +
    esc +
    '</text></svg>'
  );
}
