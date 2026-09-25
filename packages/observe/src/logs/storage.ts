/**
 * @clapp/observe — storage log channel: localStorage, sessionStorage,
 * cookies, service workers, Cache Storage, IndexedDB.
 *
 * Storage is INVENTORIED at explicit capture steps (pull), not streamed:
 * same-tab writes fire no events the page can observe (storage events are
 * cross-tab only), so a deterministic snapshot-at-step is both the honest
 * and the replay-stable design. Service-worker REGISTRATION is also an
 * event (context 'serviceworker') → 'sw-registered' record.
 *
 * Cookie VALUES are wholesale-replaced per policy (session-shaped by
 * default); entry values keep a truncated, redacted preview for behavioral
 * fidelity (what the app stored, not the secret itself).
 */

import { scrubText, type RedactionPolicy } from '../redaction';
import { truncateText } from './network';

/** Raw snapshot shape produced by the in-page STORAGE_SNAPSHOT_FN script. */
export interface RawStorageSnapshot {
  origin?: string;
  localStorage?: Record<string, string>;
  sessionStorage?: Record<string, string>;
  serviceWorkers?: Array<{ scopeUrl?: string; scriptUrl?: string }>;
  caches?: Array<{ name?: string; urls?: string[] }>;
  indexedDB?: Array<{ name?: string; version?: number; objectStores?: Array<{ name?: string }> }>;
}

/** Structured cookie as gathered by the driver (context.cookies()). */
export interface DriverCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string;
}

export interface StorageEntryPreview {
  key: string;
  valuePreview: string;
  valueLength: number;
}

export interface CookieInventoryEntry {
  name: string;
  domain: string;
  path: string;
  /** always the redaction replacement when scrubCookieValues is active */
  value: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string;
}

export interface ServiceWorkerInventoryEntry {
  scopeUrl: string;
  scriptUrl: string;
}

export interface CacheInventoryEntry {
  name: string;
  urlCount: number;
  urls: string[];
}

export interface IndexedDbInventoryEntry {
  name: string;
  version?: number;
  objectStores: string[];
}

export interface StorageInventoryPayload {
  subkind: 'storage-inventory';
  origin: string;
  localStorage: StorageEntryPreview[];
  sessionStorage: StorageEntryPreview[];
  cookies: CookieInventoryEntry[];
  serviceWorkers: ServiceWorkerInventoryEntry[];
  caches: CacheInventoryEntry[];
  indexedDB: IndexedDbInventoryEntry[];
}

/** Event record: a service worker started controlling the observed origin. */
export interface ServiceWorkerRegisteredPayload {
  subkind: 'sw-registered';
  scriptUrl: string;
}

const PREVIEW_CHARS = 128;
const MAX_CACHE_URLS = 32;

function preview(value: string, policy: RedactionPolicy): string {
  return truncateText(scrubText(value, policy), PREVIEW_CHARS);
}

function entryList(raw: Record<string, string> | undefined, policy: RedactionPolicy): StorageEntryPreview[] {
  const out: StorageEntryPreview[] = [];
  for (const key of Object.keys(raw ?? {}).sort()) {
    const value = raw?.[key];
    if (typeof value !== 'string') continue;
    out.push({ key, valuePreview: preview(value, policy), valueLength: value.length });
  }
  return out;
}

function cookieList(cookies: readonly DriverCookie[] | undefined, policy: RedactionPolicy): CookieInventoryEntry[] {
  const out: CookieInventoryEntry[] = [];
  for (const cookie of cookies ?? []) {
    if (typeof cookie?.name !== 'string') continue;
    out.push({
      name: cookie.name,
      domain: typeof cookie.domain === 'string' ? cookie.domain : '',
      path: typeof cookie.path === 'string' ? cookie.path : '',
      value: policy.scrubCookieValues ? policy.replacement : scrubText(cookie.value ?? '', policy),
      expires: typeof cookie.expires === 'number' ? cookie.expires : undefined,
      httpOnly: cookie.httpOnly === true ? true : undefined,
      secure: cookie.secure === true ? true : undefined,
      sameSite: typeof cookie.sameSite === 'string' ? cookie.sameSite : undefined,
    });
  }
  return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : (a.domain + a.path).localeCompare(b.domain + b.path)));
}

function swList(raw: RawStorageSnapshot['serviceWorkers']): ServiceWorkerInventoryEntry[] {
  const out: ServiceWorkerInventoryEntry[] = [];
  for (const entry of raw ?? []) {
    if (typeof entry?.scopeUrl !== 'string' && typeof entry?.scriptUrl !== 'string') continue;
    out.push({ scopeUrl: entry.scopeUrl ?? '', scriptUrl: entry.scriptUrl ?? '' });
  }
  return out.sort((a, b) => (a.scopeUrl < b.scopeUrl ? -1 : a.scopeUrl > b.scopeUrl ? 1 : a.scriptUrl.localeCompare(b.scriptUrl)));
}

function cacheList(raw: RawStorageSnapshot['caches']): CacheInventoryEntry[] {
  const out: CacheInventoryEntry[] = [];
  for (const entry of raw ?? []) {
    const name = typeof entry?.name === 'string' ? entry.name : '';
    const urls = (Array.isArray(entry?.urls) ? entry.urls : []).filter((url): url is string => typeof url === 'string');
    out.push({ name, urlCount: urls.length, urls: [...new Set(urls)].sort().slice(0, MAX_CACHE_URLS) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function indexedDbList(raw: RawStorageSnapshot['indexedDB']): IndexedDbInventoryEntry[] {
  const out: IndexedDbInventoryEntry[] = [];
  for (const entry of raw ?? []) {
    if (typeof entry?.name !== 'string') continue;
    const stores = (Array.isArray(entry.objectStores) ? entry.objectStores : [])
      .map((store) => (typeof store?.name === 'string' ? store.name : ''))
      .filter((name) => name !== '')
      .sort();
    out.push({ name: entry.name, version: typeof entry.version === 'number' ? entry.version : undefined, objectStores: stores });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Builds the storage-inventory payload: every list sorted, every value
 * redacted+truncated, every field canonical-safe. Total over malformed
 * snapshots (bad entries are skipped, not thrown).
 */
export function buildStorageInventory(
  raw: RawStorageSnapshot,
  cookies: readonly DriverCookie[] | undefined,
  policy: RedactionPolicy,
): StorageInventoryPayload {
  return {
    subkind: 'storage-inventory',
    origin: typeof raw.origin === 'string' ? raw.origin : '',
    localStorage: entryList(raw.localStorage, policy),
    sessionStorage: entryList(raw.sessionStorage, policy),
    cookies: cookieList(cookies, policy),
    serviceWorkers: swList(raw.serviceWorkers),
    caches: cacheList(raw.caches),
    indexedDB: indexedDbList(raw.indexedDB),
  };
}

export interface StorageSummary {
  localStorageEntries: number;
  sessionStorageEntries: number;
  cookies: number;
  serviceWorkers: number;
  caches: number;
  cachedUrls: number;
  indexedDatabases: number;
}

/** Deterministic reducer over a storage inventory payload. */
export function reduceStorage(payload: StorageInventoryPayload): StorageSummary {
  return {
    localStorageEntries: payload.localStorage.length,
    sessionStorageEntries: payload.sessionStorage.length,
    cookies: payload.cookies.length,
    serviceWorkers: payload.serviceWorkers.length,
    caches: payload.caches.length,
    cachedUrls: payload.caches.reduce((total, cache) => total + cache.urlCount, 0),
    indexedDatabases: payload.indexedDB.length,
  };
}
