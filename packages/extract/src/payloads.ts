/**
 * @clapp/extract — capture payload interpretation vocabulary.
 *
 * The payload shapes consumed here are the @clapp/observe capture channel
 * payloads (CLAPP-010). Where @clapp/observe exports the type, we import it
 * TYPE-ONLY (runtime imports from @clapp/observe are forbidden for this
 * package); where it does not export a named payload type (dom-tree,
 * screenshot-png), the shape is declared locally exactly as observe's
 * runner emits it (see packages/observe/src/runner.ts runStep).
 *
 * Every guard is structural and total: malformed payloads never throw, they
 * report false so the capture-reader can skip the capture with an honest
 * warning (unknown is a valid value — but a malformed payload is not
 * silently reinterpreted either).
 */

import type {
  NetworkRequestFailedPayload,
  NetworkRequestPayload,
  NetworkResponsePayload,
  SerializedNode,
  StorageInventoryPayload,
  WebSocketFramePayload,
} from '@clapp/observe';

// 'dom' kind, subkind 'dom-tree' (shape as emitted by observe's runner).
export interface DomTreePayload {
  subkind: 'dom-tree';
  root: SerializedNode; // { tag, role, text?, attrs?, children? }
  nodeCount: number;
  truncated: boolean;
}

// 'screenshot' kind, subkind 'screenshot-png' (shape as emitted by observe's runner).
export interface ScreenshotPayload {
  subkind: 'screenshot-png';
  format: 'png';
  encoding: 'base64';
  data: string;
  byteLength: number;
}

/** The (kind, subkind) combinations this package's extractors consume. */
export const CONSUMED_KIND_SUBKINDS: readonly string[] = [
  'dom:dom-tree',
  'network:request',
  'network:response',
  'network:requestfailed',
  'network:ws-frame',
  'storage:storage-inventory',
  'screenshot:screenshot-png',
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

/** Recursively checks the serialized-node contract (tag + role strings). */
export function isSerializedNode(value: unknown): value is SerializedNode {
  if (!isPlainObject(value)) return false;
  if (!isString(value['tag']) || value['tag'] === '') return false;
  if (!isString(value['role'])) return false;
  if (value['text'] !== undefined && !isString(value['text'])) return false;
  if (value['attrs'] !== undefined) {
    const attrs = value['attrs'];
    if (!isPlainObject(attrs)) return false;
    for (const attrValue of Object.values(attrs)) {
      if (!isString(attrValue)) return false;
    }
  }
  if (value['children'] !== undefined) {
    if (!Array.isArray(value['children'])) return false;
    for (const child of value['children']) {
      if (!isSerializedNode(child)) return false;
    }
  }
  return true;
}

export function isDomTreePayload(value: unknown): value is DomTreePayload {
  if (!isPlainObject(value)) return false;
  if (value['subkind'] !== 'dom-tree') return false;
  if (!isSerializedNode(value['root'])) return false;
  if (typeof value['nodeCount'] !== 'number') return false;
  if (typeof value['truncated'] !== 'boolean') return false;
  return true;
}

function isHeadersMap(value: unknown): value is Record<string, string> {
  if (!isPlainObject(value)) return false;
  for (const headerValue of Object.values(value)) {
    if (!isString(headerValue)) return false;
  }
  return true;
}

export function isNetworkRequestPayload(value: unknown): value is NetworkRequestPayload {
  if (!isPlainObject(value)) return false;
  if (value['subkind'] !== 'request') return false;
  if (!isString(value['url'])) return false;
  if (!isString(value['method'])) return false;
  if (!isString(value['resourceType'])) return false;
  if (!isHeadersMap(value['headers'])) return false;
  if (value['postData'] !== undefined && !isString(value['postData'])) return false;
  return true;
}

export function isNetworkResponsePayload(value: unknown): value is NetworkResponsePayload {
  if (!isPlainObject(value)) return false;
  if (value['subkind'] !== 'response') return false;
  if (!isString(value['url'])) return false;
  if (!isString(value['method'])) return false;
  if (typeof value['status'] !== 'number') return false;
  if (!isString(value['resourceType'])) return false;
  if (!isHeadersMap(value['headers'])) return false;
  if (value['statusText'] !== undefined && !isString(value['statusText'])) return false;
  if (value['mimeType'] !== undefined && !isString(value['mimeType'])) return false;
  if (value['bodyPreview'] !== undefined && !isString(value['bodyPreview'])) return false;
  if (value['fromServiceWorker'] !== undefined && typeof value['fromServiceWorker'] !== 'boolean') return false;
  if (value['sizeBytes'] !== undefined && typeof value['sizeBytes'] !== 'number') return false;
  return true;
}

export function isNetworkRequestFailedPayload(value: unknown): value is NetworkRequestFailedPayload {
  if (!isPlainObject(value)) return false;
  if (value['subkind'] !== 'requestfailed') return false;
  if (!isString(value['url'])) return false;
  if (!isString(value['method'])) return false;
  if (value['resourceType'] !== undefined && !isString(value['resourceType'])) return false;
  if (value['errorText'] !== undefined && !isString(value['errorText'])) return false;
  return true;
}

export function isWebSocketFramePayload(value: unknown): value is WebSocketFramePayload {
  if (!isPlainObject(value)) return false;
  if (value['subkind'] !== 'ws-frame') return false;
  if (!isString(value['url'])) return false;
  if (value['direction'] !== 'sent' && value['direction'] !== 'received') return false;
  if (!isString(value['payload'])) return false;
  if (typeof value['byteLength'] !== 'number') return false;
  if (typeof value['isBinary'] !== 'boolean') return false;
  return true;
}

/**
 * Storage inventories: the six inventory lists must be arrays; ENTRY-level
 * shape is guarded defensively by the storage extractor (per-entry skips
 * with warnings, never fatal), because a single malformed entry must not
 * discard an otherwise-observed inventory.
 */
export function isStorageInventoryPayload(value: unknown): value is StorageInventoryPayload {
  if (!isPlainObject(value)) return false;
  if (value['subkind'] !== 'storage-inventory') return false;
  if (!isString(value['origin'])) return false;
  for (const key of ['localStorage', 'sessionStorage', 'cookies', 'serviceWorkers', 'caches', 'indexedDB']) {
    if (!Array.isArray(value[key])) return false;
  }
  return true;
}

export function isScreenshotPayload(value: unknown): value is ScreenshotPayload {
  if (!isPlainObject(value)) return false;
  if (value['subkind'] !== 'screenshot-png') return false;
  if (value['format'] !== 'png') return false;
  if (value['encoding'] !== 'base64') return false;
  if (!isString(value['data'])) return false;
  if (typeof value['byteLength'] !== 'number') return false;
  return true;
}
