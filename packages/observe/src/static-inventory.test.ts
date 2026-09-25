// CLAPP-010 unit tests — static asset inventory.

import { describe, expect, test } from 'bun:test';
import {
  buildStaticInventory,
  classifyStaticAsset,
  networkResponsesForInventory,
  type DomAssetLinks,
} from './static-inventory';
import type { NetworkCapturePayload } from './logs/network';

describe('classifyStaticAsset — precedence rel > resourceType > mime > extension', () => {
  test('rel hints win first', () => {
    expect(classifyStaticAsset('http://x/thing', { rel: 'manifest' })).toBe('manifest');
    expect(classifyStaticAsset('http://x/thing', { rel: 'stylesheet' })).toBe('stylesheet');
    expect(classifyStaticAsset('http://x/thing', { rel: 'icon' })).toBe('image');
  });

  test('resourceType classifies network-driven assets', () => {
    expect(classifyStaticAsset('http://x/thing', { resourceType: 'script' })).toBe('script');
    expect(classifyStaticAsset('http://x/thing', { resourceType: 'font' })).toBe('font');
    expect(classifyStaticAsset('http://x/thing', { resourceType: 'image' })).toBe('image');
  });

  test('mimeType classifies when rel and resourceType are absent', () => {
    expect(classifyStaticAsset('http://x/thing', { mimeType: 'text/css' })).toBe('stylesheet');
    expect(classifyStaticAsset('http://x/thing', { mimeType: 'application/manifest+json' })).toBe('manifest');
    expect(classifyStaticAsset('http://x/thing', { mimeType: 'image/svg+xml' })).toBe('image');
    expect(classifyStaticAsset('http://x/thing', { mimeType: 'font/woff2' })).toBe('font');
  });

  test('URL extension is the last resort', () => {
    expect(classifyStaticAsset('http://x/app.mjs')).toBe('script');
    expect(classifyStaticAsset('http://x/logo.woff2')).toBe('font');
    expect(classifyStaticAsset('http://x/site.webmanifest')).toBe('manifest');
    expect(classifyStaticAsset('http://x/photo.webp')).toBe('image');
    expect(classifyStaticAsset('http://x/no-extension')).toBe('other');
    expect(classifyStaticAsset('http://x/data.json')).toBe('other'); // JSON data is dynamic, not a static asset
  });

  test('relative and data: URLs do not crash classification', () => {
    expect(classifyStaticAsset('/static/app.js')).toBe('script');
    expect(classifyStaticAsset('data:image/png;base64,AAAA')).toBe('image');
  });
});

describe('networkResponsesForInventory', () => {
  test('maps response payloads only, preserving url/mime/size', () => {
    const payloads: NetworkCapturePayload[] = [
      { subkind: 'request', url: 'http://x/a.js', method: 'GET', resourceType: 'script', headers: {} },
      { subkind: 'response', url: 'http://x/a.js', method: 'GET', status: 200, resourceType: 'script', headers: {}, mimeType: 'text/javascript', sizeBytes: 10 },
      { subkind: 'ws-frame', url: 'ws://x/', direction: 'sent', payload: 'p', byteLength: 1, isBinary: false },
    ];
    expect(networkResponsesForInventory(payloads)).toEqual([
      { url: 'http://x/a.js', status: 200, resourceType: 'script', mimeType: 'text/javascript', sizeBytes: 10 },
    ]);
  });
});

describe('buildStaticInventory — merge, dedupe, sort, cap', () => {
  const links: DomAssetLinks = {
    scripts: ['http://x/app.js'],
    stylesheets: ['http://x/style.css'],
    images: ['http://x/logo.svg'],
    manifests: ['http://x/manifest.webmanifest'],
    icons: [],
    fonts: [],
  };

  test('DOM links seed the inventory with source=dom', () => {
    const payload = buildStaticInventory(links, []);
    expect(payload.subkind).toBe('static-inventory');
    expect(payload.assets.map((asset) => [asset.url, asset.category, asset.source])).toEqual([
      ['http://x/app.js', 'script', 'dom'],
      ['http://x/logo.svg', 'image', 'dom'],
      ['http://x/manifest.webmanifest', 'manifest', 'dom'],
      ['http://x/style.css', 'stylesheet', 'dom'],
    ]);
    expect(payload.total).toBe(4);
    expect(payload.truncated).toBe(false);
  });

  test('network responses enrich DOM-known URLs and add new ones', () => {
    const payload = buildStaticInventory(links, [
      { url: 'http://x/app.js', status: 200, resourceType: 'script', mimeType: 'text/javascript', sizeBytes: 1234 },
      { url: 'http://x/font.woff2', status: 200, resourceType: 'font', mimeType: 'font/woff2', sizeBytes: 99 },
      { url: 'http://x/api/data', status: 200, resourceType: 'fetch', mimeType: 'application/json' }, // dynamic → excluded
    ]);
    const app = payload.assets.find((asset) => asset.url === 'http://x/app.js');
    expect(app?.source).toBe('dom');
    expect(app?.mimeType).toBe('text/javascript');
    expect(app?.sizeBytes).toBe(1234);
    expect(payload.assets.find((asset) => asset.url === 'http://x/font.woff2')?.source).toBe('network');
    expect(payload.assets.some((asset) => asset.url === 'http://x/api/data')).toBe(false);
  });

  test('urls are deduped across sources and sorted', () => {
    // images REPLACED in the spread — logo.svg is no longer referenced
    const payload = buildStaticInventory(
      { ...links, images: ['http://x/b.png', 'http://x/a.png'] },
      [{ url: 'http://x/b.png', status: 200, resourceType: 'image', mimeType: 'image/png', sizeBytes: 5 }],
    );
    expect(payload.assets.map((asset) => asset.url)).toEqual([
      'http://x/a.png',
      'http://x/app.js',
      'http://x/b.png',
      'http://x/manifest.webmanifest',
      'http://x/style.css',
    ]);
  });

  test('asset cap triggers the honest truncated flag', () => {
    const manyLinks: DomAssetLinks = {
      scripts: Array.from({ length: 600 }, (_, i) => `http://x/s${i}.js`),
      stylesheets: [],
      images: [],
      manifests: [],
      icons: [],
      fonts: [],
    };
    const payload = buildStaticInventory(manyLinks, []);
    expect(payload.total).toBeLessThanOrEqual(512);
    expect(payload.truncated).toBe(true);
  });

  test('null links (driver failure) yields an empty inventory, not a crash', () => {
    const payload = buildStaticInventory(null, []);
    expect(payload.assets).toEqual([]);
    expect(payload.total).toBe(0);
  });
});
