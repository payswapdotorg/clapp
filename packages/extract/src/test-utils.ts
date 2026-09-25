// Shared helpers for the colocated test battery (not a test file itself;
// not exported from the package index — same convention as the sibling
// packages' test-utils).
//
// Synthetic bundles are built the honest way: a REAL RecordingSession over
// MemoryStores records the fake captures (so canonical bytes, hashing,
// artifact persistence, and event emission all run through the landed
// @clapp/evidence code), then buildBundle seals the run. Extraction is
// wired with readArtifact = the MemoryArtifactStore itself.

import { MemoryArtifactStore, MemoryRunStore } from '@clapp/store';
import type { ArtifactStore, RunStore } from '@clapp/store';
import { RecordingSession, buildBundle, loadRunFromStores } from '@clapp/evidence';
import type { EvidenceBundle } from '@clapp/evidence';
import type { CaptureRecord } from '@clapp/evidence';
import type { EvidenceRef, RunId } from '@clapp/core';
import type { SerializedNode } from '@clapp/observe';
import type { ExtractionResult } from './extraction';
import { extractIrModel } from './extraction';

export interface SynthOptions {
  targetId?: string;
  environment?: Record<string, unknown>;
}

export interface SynthBundle {
  bundle: EvidenceBundle;
  artifactStore: ArtifactStore;
  runStore: RunStore;
  runId: RunId;
  refs: EvidenceRef[];
}

/** Record captures through a real RecordingSession and seal the bundle. */
export async function synthBundle(captures: readonly CaptureRecord[], options: SynthOptions = {}): Promise<SynthBundle> {
  const artifactStore = new MemoryArtifactStore();
  const runStore = new MemoryRunStore();
  const session = await RecordingSession.start({ runStore, artifactStore }, {
    targetId: options.targetId ?? 'bench/synth',
    environment: options.environment ?? { browser: 'synth-browser', os: 'synth-os' },
  });
  for (const capture of captures) {
    await session.record(capture);
  }
  await session.complete();
  const run = await loadRunFromStores({ runStore, artifactStore }, session.runId);
  if (run === null) {
    throw new Error('synthBundle: run vanished immediately after completion');
  }
  const bundle = await buildBundle(run);
  return { bundle, artifactStore, runStore, runId: session.runId, refs: [...session.refs] };
}

/** Extract from a synthetic bundle with the store wired as artifact reader. */
export async function extractFromSynth(synth: SynthBundle): Promise<ExtractionResult> {
  return extractIrModel({ bundle: synth.bundle, readArtifact: (id) => synth.artifactStore.readBytes(id) });
}

/** Deterministic UTC timestamps, strictly increasing, one per call. */
export class SynthClock {
  private n = 0;
  next(): string {
    const minutes = Math.floor(this.n / 60);
    const seconds = this.n % 60;
    this.n++;
    return `2026-09-25T10:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.000Z`;
  }
}

export function capture(kind: CaptureRecord['kind'], payload: unknown, ts: string, redacted = false): CaptureRecord {
  return { kind, ts, payload, redacted };
}

export function domTreeCapture(root: SerializedNode, ts: string, truncated = false): CaptureRecord {
  return capture('dom', { subkind: 'dom-tree', root, nodeCount: countNodes(root), truncated }, ts);
}

export function docRequestCapture(url: string, ts: string, headers: Record<string, string> = {}): CaptureRecord {
  return capture('network', { subkind: 'request', url, method: 'GET', resourceType: 'document', headers }, ts);
}

export function requestCapture(
  url: string,
  method: string,
  ts: string,
  options: { resourceType?: string; headers?: Record<string, string>; postData?: string } = {},
): CaptureRecord {
  const payload: Record<string, unknown> = {
    subkind: 'request',
    url,
    method,
    resourceType: options.resourceType ?? 'xhr',
    headers: options.headers ?? {},
  };
  if (options.postData !== undefined) {
    payload['postData'] = options.postData;
  }
  return capture('network', payload, ts);
}

export function responseCapture(
  url: string,
  method: string,
  status: number,
  ts: string,
  options: { bodyPreview?: string; mimeType?: string; resourceType?: string } = {},
): CaptureRecord {
  const payload: Record<string, unknown> = {
    subkind: 'response',
    url,
    method,
    status,
    resourceType: options.resourceType ?? 'xhr',
    headers: {},
  };
  if (options.mimeType !== undefined) payload['mimeType'] = options.mimeType;
  if (options.bodyPreview !== undefined) payload['bodyPreview'] = options.bodyPreview;
  return capture('network', payload, ts);
}

export function requestFailedCapture(url: string, method: string, ts: string, errorText = 'net::ERR_FAILED'): CaptureRecord {
  return capture('network', { subkind: 'requestfailed', url, method, resourceType: 'xhr', errorText }, ts);
}

export function wsFrameCapture(url: string, direction: 'sent' | 'received', payloadText: string, ts: string): CaptureRecord {
  return capture('network', { subkind: 'ws-frame', url, direction, payload: payloadText, byteLength: payloadText.length, isBinary: false }, ts);
}

export function storageInventoryCapture(
  ts: string,
  options: {
    localStorage?: Array<{ key: string; valuePreview: string }>;
    sessionStorage?: Array<{ key: string; valuePreview: string }>;
    cookies?: Array<{ name: string; value: string; domain?: string; path?: string }>;
    indexedDB?: Array<{ name: string; objectStores?: string[]; version?: number }>;
  } = {},
): CaptureRecord {
  return capture('storage', {
    subkind: 'storage-inventory',
    origin: 'http://synth.test',
    localStorage: (options.localStorage ?? []).map((entry) => ({ key: entry.key, valuePreview: entry.valuePreview, valueLength: entry.valuePreview.length })),
    sessionStorage: (options.sessionStorage ?? []).map((entry) => ({ key: entry.key, valuePreview: entry.valuePreview, valueLength: entry.valuePreview.length })),
    cookies: (options.cookies ?? []).map((cookie) => ({ name: cookie.name, domain: cookie.domain ?? 'synth.test', path: cookie.path ?? '/', value: cookie.value })),
    serviceWorkers: [],
    caches: [],
    indexedDB: (options.indexedDB ?? []).map((database) => ({
      name: database.name,
      ...(database.version !== undefined ? { version: database.version } : {}),
      objectStores: database.objectStores ?? [],
    })),
  }, ts);
}

export function screenshotCapture(ts: string, byteLength = 4096): CaptureRecord {
  return capture('screenshot', { subkind: 'screenshot-png', format: 'png', encoding: 'base64', data: 'a'.repeat(16), byteLength }, ts);
}

export function runtimeCapture(ts: string, text = 'fixture:log'): CaptureRecord {
  return capture('runtime', { subkind: 'console', level: 'log', text, args: [] }, ts);
}

/** Serialized-node helper: a minimal element. */
export function el(
  tag: string,
  role: string,
  options: { text?: string; attrs?: Record<string, string>; children?: SerializedNode[] } = {},
): SerializedNode {
  const node: SerializedNode = { tag, role };
  if (options.text !== undefined && options.text !== '') node.text = options.text;
  if (options.attrs !== undefined && Object.keys(options.attrs).length > 0) node.attrs = options.attrs;
  if (options.children !== undefined && options.children.length > 0) node.children = options.children;
  return node;
}

/** A minimal page tree: html > body > the given children. */
export function pageTree(children: SerializedNode[]): SerializedNode {
  return el('html', 'generic', { children: [el('body', 'generic', { children })] });
}

function countNodes(node: SerializedNode): number {
  let count = 1;
  for (const child of node.children ?? []) {
    count += countNodes(child);
  }
  return count;
}
