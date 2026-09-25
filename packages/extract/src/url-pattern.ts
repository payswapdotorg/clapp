/**
 * @clapp/extract — URL → route / urlPattern normalization.
 *
 * Route semantics (work item, screens-extractor):
 *   - route = URL PATH only: query string and fragment stripped;
 *   - trailing-slash-insensitive: '/pricing/' and '/pricing' are the same
 *     route ('/' itself stays '/');
 *   - absolute URLs are parsed with the URL parser; a URL that does not
 *     parse (never produced by Playwright, possible in hand-built bundles)
 *     falls back to treating the raw string as a path.
 *
 * urlPattern semantics (work item, api-extractor):
 *   - parameterize path segments that look like ids: all-digit or uuid v4
 *     segments become ':id';
 *   - strip the query from the pattern.
 */

const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DIGIT_SEGMENT = /^\d+$/;

function stripQueryAndFragment(raw: string): string {
  const withoutFragment = raw.split('#')[0] ?? raw;
  return withoutFragment.split('?')[0] ?? withoutFragment;
}

function collapseTrailingSlash(path: string): string {
  if (path.length > 1 && path.endsWith('/')) {
    return path.slice(0, -1);
  }
  return path;
}

/** URL → normalized route ('/pricing?x=1#f' → '/pricing'). */
export function normalizeRoute(url: string): string {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    path = stripQueryAndFragment(url);
    if (path !== '' && !path.startsWith('/')) {
      path = `/${path}`;
    }
  }
  return collapseTrailingSlash(path === '' ? '/' : path);
}

/** True when a path segment looks like an id (all digits or uuid v4). */
export function isIdSegment(segment: string): boolean {
  return DIGIT_SEGMENT.test(segment) || UUID_SEGMENT.test(segment);
}

/** Path with id-shaped segments replaced by ':id'. */
export function parameterizePath(path: string): string {
  const segments = path.split('/');
  const parameterized = segments.map((segment) => (segment === '' ? segment : isIdSegment(segment) ? ':id' : segment));
  return parameterized.join('/');
}

/** URL → parameterized route pattern ('/api/items/123?x=1' → '/api/items/:id'). */
export function urlPatternFrom(url: string): string {
  return parameterizePath(normalizeRoute(url));
}
