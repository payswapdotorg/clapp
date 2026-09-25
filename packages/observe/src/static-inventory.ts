/**
 * @clapp/observe — static asset inventory (pure core).
 *
 * Merges two deterministic sources into one inventory payload:
 *  - DOM links (script[src], link[rel=stylesheet|manifest|icon|preload],
 *    img[src], source[srcset]) — gathered in-page by STATIC_LINKS_FN;
 *  - network response records (adds mimeType/sizeBytes where the server
 *    reported them).
 *
 * Dedup by URL (DOM wins — it is what the app actually referenced), sort
 * by URL, cap the list. Classification (script/stylesheet/image/font/
 * manifest/other) uses rel → resourceType → mimeType → URL extension,
 * in that precedence.
 */

import type { NetworkCapturePayload } from './logs/network';

export type StaticAssetCategory = 'script' | 'stylesheet' | 'image' | 'font' | 'manifest' | 'other';

export interface StaticAsset {
  url: string;
  category: StaticAssetCategory;
  source: 'dom' | 'network';
  mimeType?: string;
  sizeBytes?: number;
}

export interface DomAssetLinks {
  scripts: string[];
  stylesheets: string[];
  images: string[];
  manifests: string[];
  icons: string[];
  fonts: string[];
}

export interface StaticInventoryPayload {
  subkind: 'static-inventory';
  assets: StaticAsset[];
  total: number;
  truncated: boolean;
}

const MAX_ASSETS = 512;

const EXTENSION_CATEGORIES: Readonly<Record<string, StaticAssetCategory>> = {
  js: 'script',
  mjs: 'script',
  cjs: 'script',
  css: 'stylesheet',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  avif: 'image',
  svg: 'image',
  ico: 'image',
  woff: 'font',
  woff2: 'font',
  ttf: 'font',
  otf: 'font',
  eot: 'font',
  webmanifest: 'manifest',
  manifest: 'manifest',
};

const MIME_CATEGORIES: ReadonlyArray<readonly [RegExp, StaticAssetCategory]> = [
  [/^text\/(?:javascript|ecmascript)$/i, 'script'],
  [/^application\/(?:java|x-)?(?:javascript|ecmascript)$/i, 'script'],
  [/^text\/css$/i, 'stylesheet'],
  [/^image\//i, 'image'],
  [/^font\//i, 'font'],
  [/^application\/(?:font|x-font)/i, 'font'],
  [/^application\/manifest\+json$/i, 'manifest'],
];

export interface ClassificationHints {
  rel?: string;
  resourceType?: string;
  mimeType?: string;
}

/** Category for one asset URL, with rel/resourceType/mime precedence. */
export function classifyStaticAsset(url: string, hints: ClassificationHints = {}): StaticAssetCategory {
  const rel = hints.rel?.toLowerCase();
  if (rel === 'manifest') return 'manifest';
  if (rel === 'stylesheet') return 'stylesheet';
  if (rel === 'icon' || rel === 'apple-touch-icon' || rel === 'shortcut icon') return 'image';
  if (rel === 'preload' || rel === 'modulepreload' || rel === 'prefetch') {
    // preloads are only static-inventory-relevant when their type says font/script/style
    const as = hints.resourceType?.toLowerCase();
    if (as === 'font') return 'font';
    if (as === 'script') return 'script';
    if (as === 'style') return 'stylesheet';
  }

  const resourceType = hints.resourceType?.toLowerCase();
  if (resourceType === 'script') return 'script';
  if (resourceType === 'stylesheet') return 'stylesheet';
  if (resourceType === 'image') return 'image';
  if (resourceType === 'font') return 'font';
  if (resourceType === 'manifest') return 'manifest';

  const mime = hints.mimeType?.toLowerCase();
  if (mime !== undefined && mime !== '') {
    for (const [pattern, category] of MIME_CATEGORIES) {
      if (pattern.test(mime)) return category;
    }
  }

  // data: URLs carry their mime inline (data:image/png;base64,...)
  if (url.toLowerCase().startsWith('data:')) {
    const dataMime = url.slice(5).split(/[;,]/)[0]?.toLowerCase() ?? '';
    if (dataMime !== '') {
      for (const [pattern, category] of MIME_CATEGORIES) {
        if (pattern.test(dataMime)) return category;
      }
    }
    return 'other';
  }

  try {
    const pathname = new URL(url, 'http://inventory.invalid/').pathname;
    const extension = pathname.split('.').pop() ?? '';
    if (extension !== pathname && extension !== '') {
      return EXTENSION_CATEGORIES[extension.toLowerCase()] ?? 'other';
    }
  } catch {
    // unparseable URL — be total
  }
  return 'other';
}

export interface NetworkResponseLike {
  url: string;
  status: number;
  resourceType?: string;
  mimeType?: string;
  sizeBytes?: number;
}

/** Maps drained network response payloads to the light shape the inventory consumes. */
export function networkResponsesForInventory(payloads: readonly NetworkCapturePayload[]): NetworkResponseLike[] {
  const out: NetworkResponseLike[] = [];
  for (const payload of payloads) {
    if (payload.subkind !== 'response') continue;
    out.push({
      url: payload.url,
      status: payload.status,
      resourceType: payload.resourceType,
      mimeType: payload.mimeType,
      sizeBytes: payload.sizeBytes,
    });
  }
  return out;
}

function domLinksOf(links: DomAssetLinks | null | undefined): Array<[string, StaticAssetCategory]> {
  const safe: DomAssetLinks = {
    scripts: Array.isArray(links?.scripts) ? links.scripts : [],
    stylesheets: Array.isArray(links?.stylesheets) ? links.stylesheets : [],
    images: Array.isArray(links?.images) ? links.images : [],
    manifests: Array.isArray(links?.manifests) ? links.manifests : [],
    icons: Array.isArray(links?.icons) ? links.icons : [],
    fonts: Array.isArray(links?.fonts) ? links.fonts : [],
  };
  const pairs: Array<[string, StaticAssetCategory]> = [];
  for (const url of safe.scripts) pairs.push([url, 'script']);
  for (const url of safe.stylesheets) pairs.push([url, 'stylesheet']);
  for (const url of safe.images) pairs.push([url, 'image']);
  for (const url of safe.manifests) pairs.push([url, 'manifest']);
  for (const url of safe.icons) pairs.push([url, 'image']);
  for (const url of safe.fonts) pairs.push([url, 'font']);
  return pairs;
}

/**
 * Builds the static-inventory payload: DOM-referenced assets seeded first
 * (source 'dom'), network responses merged in (source 'network' for
 * URL-first sightings; mime/size enrichment for DOM-known URLs), dedup by
 * URL, sorted by URL, capped with an honest `truncated` flag.
 */
export function buildStaticInventory(
  links: DomAssetLinks | null | undefined,
  network: readonly NetworkResponseLike[],
): StaticInventoryPayload {
  const byUrl = new Map<string, StaticAsset>();

  for (const [url, category] of domLinksOf(links)) {
    if (url === '' || byUrl.has(url)) continue;
    if (byUrl.size >= MAX_ASSETS) break;
    byUrl.set(url, { url, category, source: 'dom' });
  }

  let truncated = byUrl.size >= MAX_ASSETS;
  for (const response of network) {
    if (byUrl.size >= MAX_ASSETS) {
      truncated = true;
      break;
    }
    const category = classifyStaticAsset(response.url, { resourceType: response.resourceType, mimeType: response.mimeType });
    if (category === 'other') continue; // dynamic data (xhr/fetch/json) is not a static asset
    const existing = byUrl.get(response.url);
    if (existing !== undefined) {
      existing.mimeType = response.mimeType ?? existing.mimeType;
      existing.sizeBytes = response.sizeBytes ?? existing.sizeBytes;
    } else {
      byUrl.set(response.url, {
        url: response.url,
        category,
        source: 'network',
        mimeType: response.mimeType,
        sizeBytes: response.sizeBytes,
      });
    }
  }

  const assets = [...byUrl.values()].sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));
  return { subkind: 'static-inventory', assets, total: assets.length, truncated };
}
