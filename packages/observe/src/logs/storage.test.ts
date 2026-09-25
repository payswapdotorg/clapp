// CLAPP-010 unit tests — storage log channel (inventory build + reduce).

import { describe, expect, test } from 'bun:test';
import { defaultRedactionPolicy } from '../redaction';
import {
  buildStorageInventory,
  reduceStorage,
  type DriverCookie,
  type RawStorageSnapshot,
} from './storage';

const replacement = defaultRedactionPolicy().replacement;

// runtime-assembled fake secret (never a whole literal)
const fakeSessionToken = ['sess_', 'a9f3', 'c27d81', 'e5b04a'].join('');

describe('buildStorageInventory', () => {
  const snapshot: RawStorageSnapshot = {
    origin: 'http://127.0.0.1:8080',
    localStorage: {
      'fixture:theme': 'dark',
      'fixture:settings': '{"size":"md"}',
    },
    sessionStorage: { 'fixture:flag': 'on' },
    serviceWorkers: [{ scopeUrl: 'http://127.0.0.1:8080/', scriptUrl: 'http://127.0.0.1:8080/sw.js' }],
    caches: [{ name: 'cache-b', urls: ['http://x/2', 'http://x/1', 'http://x/1'] }, { name: 'cache-a', urls: [] }],
    indexedDB: [{ name: 'db-b', version: 2, objectStores: [{ name: 's2' }, { name: 's1' }] }, { name: 'db-a', objectStores: [] }],
  };
  const cookies: DriverCookie[] = [
    { name: 'zeta', value: 'plain', domain: '127.0.0.1', path: '/' },
    { name: 'alpha', value: fakeSessionToken, domain: '127.0.0.1', path: '/', httpOnly: true, secure: false, sameSite: 'Lax', expires: -1 },
  ];

  test('every list is sorted deterministically', () => {
    const payload = buildStorageInventory(snapshot, cookies, defaultRedactionPolicy());
    expect(payload.subkind).toBe('storage-inventory');
    expect(payload.origin).toBe('http://127.0.0.1:8080');
    expect(payload.localStorage.map((entry) => entry.key)).toEqual(['fixture:settings', 'fixture:theme']);
    expect(payload.cookies.map((entry) => entry.name)).toEqual(['alpha', 'zeta']);
    expect(payload.caches.map((entry) => entry.name)).toEqual(['cache-a', 'cache-b']);
    expect(payload.indexedDB.map((entry) => entry.name)).toEqual(['db-a', 'db-b']);
    expect(payload.indexedDB[1]?.objectStores).toEqual(['s1', 's2']);
  });

  test('cookie values are wholesale-replaced by policy (names kept)', () => {
    const payload = buildStorageInventory(snapshot, cookies, defaultRedactionPolicy());
    expect(payload.cookies.every((entry) => entry.value === replacement)).toBe(true);
    expect(payload.cookies.some((entry) => entry.value.includes('sess'))).toBe(false);
  });

  test('scrubCookieValues=false keeps values (then only pattern-scrubbing applies)', () => {
    const policy = { ...defaultRedactionPolicy(), scrubCookieValues: false };
    const payload = buildStorageInventory(snapshot, cookies, policy);
    // 'zeta' holds a plainly benign value: verbatim either way
    expect(payload.cookies.find((entry) => entry.name === 'zeta')?.value).toBe('plain');
  });

  test('cache urls are deduped, sorted, capped', () => {
    const payload = buildStorageInventory(snapshot, cookies, defaultRedactionPolicy());
    expect(payload.caches.find((entry) => entry.name === 'cache-b')?.urls).toEqual(['http://x/1', 'http://x/2']);
    expect(payload.caches.find((entry) => entry.name === 'cache-b')?.urlCount).toBe(3);
  });

  test('entry previews are truncated to the preview cap', () => {
    const long = 'v'.repeat(500);
    const payload = buildStorageInventory(
      { localStorage: { big: long } },
      [],
      defaultRedactionPolicy(),
    );
    const preview = payload.localStorage[0]?.valuePreview ?? '';
    expect(preview.startsWith('vvvv')).toBe(true);
    expect(preview.length).toBeLessThanOrEqual(128 + 40); // cap + truncation marker
  });

  test('malformed entries are skipped, not thrown', () => {
    const payload = buildStorageInventory(
      {
        localStorage: { ok: 'fine' },
        serviceWorkers: [{}, { scopeUrl: 'x' }],
        caches: [{ urls: 'not-an-array' as unknown as string[] }],
        indexedDB: [{ name: 42 as unknown as string }],
      },
      [{ name: 7, value: 'x', domain: '', path: '' } as unknown as DriverCookie],
      defaultRedactionPolicy(),
    );
    expect(payload.localStorage).toEqual([{ key: 'ok', valuePreview: 'fine', valueLength: 4 }]);
    expect(payload.serviceWorkers).toEqual([{ scopeUrl: 'x', scriptUrl: '' }]);
    expect(payload.caches).toEqual([{ name: '', urlCount: 0, urls: [] }]);
    expect(payload.indexedDB).toEqual([]);
    expect(payload.cookies).toEqual([]);
  });
});

describe('reduceStorage', () => {
  test('summary counts', () => {
    const payload = buildStorageInventory(
      {
        localStorage: { a: '1', b: '2' },
        sessionStorage: { c: '3' },
        serviceWorkers: [{ scopeUrl: 's', scriptUrl: 'w' }],
        caches: [{ name: 'x', urls: ['u1', 'u2'] }],
      },
      [{ name: 'k', value: 'v', domain: 'd', path: '/' }],
      defaultRedactionPolicy(),
    );
    expect(reduceStorage(payload)).toEqual({
      localStorageEntries: 2,
      sessionStorageEntries: 1,
      cookies: 1,
      serviceWorkers: 1,
      caches: 1,
      cachedUrls: 2,
      indexedDatabases: 0,
    });
  });
});
