/**
 * @clapp/extract — capture reader: manifest walk → parsed captures.
 *
 * Walks the sealed EvidenceManifest in EVENT ORDER (the recorder's
 * 'evidence.recorded' events, each carrying exactly one ref plus the
 * artifactId the artifact bytes live under), reads the artifact bytes via
 * the injected reader, re-hashes them against the ref's sha256 (extraction
 * cites evidence — if the bytes are not what the ref claims, citing them
 * would be dishonest, so the capture is skipped), UTF-8 decodes, JSON
 * parses, validates the CaptureRecord envelope, and dispatches by
 * (kind, subkind) onto the typed consumed-capture union.
 *
 * Degradation is NEVER fatal (work item): unreadable, tampered,
 * unparseable, envelope-invalid, and unknown-(kind,subkind) captures are
 * each SKIPPED with a precise warning and counted in capturesSkipped.
 * Unknown combos additionally produce one summary warning per combo (the
 * individual skips are counted, the message is deduped so a run with fifty
 * console records yields one warning, not fifty).
 *
 * Byte-identical repeats of the same evidenceId (legal in the event stream;
 * buildBundle dedupes only the manifest's evidence list) are processed
 * once — first occurrence wins.
 */

import { EVIDENCE_KINDS, sha256Hex } from '@clapp/core';
import type { ArtifactId, EvidenceRef } from '@clapp/core';
import type { EvidenceManifest } from '@clapp/evidence';
import type {
  NetworkRequestFailedPayload,
  NetworkRequestPayload,
  NetworkResponsePayload,
  StorageInventoryPayload,
  WebSocketFramePayload,
} from '@clapp/observe';
import type { DomTreePayload, ScreenshotPayload } from './payloads';
import {
  isDomTreePayload,
  isNetworkRequestFailedPayload,
  isNetworkRequestPayload,
  isNetworkResponsePayload,
  isScreenshotPayload,
  isStorageInventoryPayload,
  isWebSocketFramePayload,
} from './payloads';

/** Reads artifact bytes by artifact id; null when the artifact is unavailable. */
export type ReadArtifact = (id: ArtifactId) => Promise<Uint8Array | null>;

interface CaptureBase {
  /** position in the parsed-capture sequence (manifest event order). */
  index: number;
  ref: EvidenceRef;
}

export interface DomTreeCapture extends CaptureBase {
  kind: 'dom';
  subkind: 'dom-tree';
  payload: DomTreePayload;
}

export interface NetworkRequestCapture extends CaptureBase {
  kind: 'network';
  subkind: 'request';
  payload: NetworkRequestPayload;
}

export interface NetworkResponseCapture extends CaptureBase {
  kind: 'network';
  subkind: 'response';
  payload: NetworkResponsePayload;
}

export interface NetworkRequestFailedCapture extends CaptureBase {
  kind: 'network';
  subkind: 'requestfailed';
  payload: NetworkRequestFailedPayload;
}

export interface WebSocketFrameCapture extends CaptureBase {
  kind: 'network';
  subkind: 'ws-frame';
  payload: WebSocketFramePayload;
}

export interface StorageInventoryCapture extends CaptureBase {
  kind: 'storage';
  subkind: 'storage-inventory';
  payload: StorageInventoryPayload;
}

export interface ScreenshotCapture extends CaptureBase {
  kind: 'screenshot';
  subkind: 'screenshot-png';
  payload: ScreenshotPayload;
}

export type ConsumedCapture =
  | DomTreeCapture
  | NetworkRequestCapture
  | NetworkResponseCapture
  | NetworkRequestFailedCapture
  | WebSocketFrameCapture
  | StorageInventoryCapture
  | ScreenshotCapture;

export interface CaptureWalkStats {
  capturesParsed: number;
  capturesSkipped: number;
}

export interface CaptureWalk {
  /** parsed, hash-verified, dispatchable captures in event order. */
  captures: ConsumedCapture[];
  warnings: string[];
  stats: CaptureWalkStats;
}

/** Thrown when the bundle/manifest itself grossly violates the input contract. */
export class ManifestShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ManifestShapeError';
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Minimal structural validation of the sealed manifest (gross violations throw). */
export function assertManifestShape(manifest: EvidenceManifest): void {
  if (!isPlainObject(manifest)) {
    throw new ManifestShapeError('manifest must be an object');
  }
  if (!isPlainObject(manifest.run) || typeof manifest.run.id !== 'string') {
    throw new ManifestShapeError('manifest.run must be an object with a string id');
  }
  if (!Array.isArray(manifest.events)) {
    throw new ManifestShapeError('manifest.events must be an array');
  }
  if (!Array.isArray(manifest.evidence)) {
    throw new ManifestShapeError('manifest.evidence must be an array');
  }
  if (!Array.isArray(manifest.artifacts)) {
    throw new ManifestShapeError('manifest.artifacts must be an array');
  }
  for (const ref of manifest.evidence) {
    if (!isPlainObject(ref) || typeof ref.evidenceId !== 'string' || typeof ref.kind !== 'string' || typeof ref.sha256 !== 'string') {
      throw new ManifestShapeError(`manifest.evidence contains a malformed EvidenceRef: ${JSON.stringify(ref)}`);
    }
  }
}

interface PendingWarning {
  message: string;
  count: number;
}

export async function walkCaptures(manifest: EvidenceManifest, readArtifact: ReadArtifact): Promise<CaptureWalk> {
  const warnings: string[] = [];
  const comboWarning = new Map<string, PendingWarning>();
  const captures: ConsumedCapture[] = [];
  const seenEvidenceIds = new Set<string>();
  let capturesParsed = 0;
  let capturesSkipped = 0;

  const skip = (message: string): void => {
    capturesSkipped++;
    warnings.push(message);
  };

  for (const event of manifest.events) {
    if (!isPlainObject(event) || event.kind !== 'evidence.recorded') {
      continue;
    }
    const refs = Array.isArray(event.evidenceRefs) ? event.evidenceRefs : [];
    const artifactId = isPlainObject(event.payload) ? event.payload['artifactId'] : undefined;
    if (typeof artifactId !== 'string' || artifactId === '') {
      for (const ref of refs) {
        skip(`evidence.recorded event seq=${String(event.seq)} carries a ref without a readable artifactId — evidence ${describeRef(ref)} skipped`);
      }
      continue;
    }
    for (const ref of refs) {
      if (!isPlainObject(ref) || typeof ref.evidenceId !== 'string' || typeof ref.kind !== 'string' || typeof ref.sha256 !== 'string') {
        skip(`evidence.recorded event seq=${String(event.seq)} carries a malformed ref — skipped`);
        continue;
      }
      if (seenEvidenceIds.has(ref.evidenceId)) {
        continue; // byte-identical repeat: first occurrence already processed
      }
      seenEvidenceIds.add(ref.evidenceId);

      const bytes = await readArtifact(artifactId as ArtifactId);
      if (bytes === null) {
        skip(`artifact ${artifactId} behind evidence ${ref.evidenceId} could not be read (readArtifact returned null)`);
        continue;
      }
      const actualHash = await sha256Hex(bytes);
      if (actualHash !== ref.sha256) {
        skip(`artifact ${artifactId} bytes hash to ${actualHash.slice(0, 12)}…, not the ref's sha256 ${ref.sha256.slice(0, 12)}… — evidence ${ref.evidenceId} skipped (citing it would be dishonest)`);
        continue;
      }

      let decoded: string;
      try {
        decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch {
        skip(`artifact ${artifactId} behind evidence ${ref.evidenceId} is not valid UTF-8 — skipped`);
        continue;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(decoded);
      } catch {
        skip(`artifact ${artifactId} behind evidence ${ref.evidenceId} is not JSON — skipped`);
        continue;
      }

      if (!isPlainObject(parsed) || !('payload' in parsed)) {
        skip(`artifact ${artifactId} behind evidence ${ref.evidenceId} is not a CaptureRecord (kind/ts/payload/redacted) — skipped`);
        continue;
      }
      const record = parsed as Record<string, unknown>;
      const kind = record['kind'];
      if (typeof kind !== 'string' || !(EVIDENCE_KINDS as readonly string[]).includes(kind)) {
        skip(`CaptureRecord behind evidence ${ref.evidenceId} has kind ${JSON.stringify(kind)}, outside the core vocabulary — skipped`);
        continue;
      }
      if (typeof record['ts'] !== 'string' || Number.isNaN(Date.parse(record['ts']))) {
        skip(`CaptureRecord behind evidence ${ref.evidenceId} has an unparseable ts — skipped`);
        continue;
      }
      if (typeof record['redacted'] !== 'boolean') {
        skip(`CaptureRecord behind evidence ${ref.evidenceId} has a non-boolean redacted flag — skipped`);
        continue;
      }
      if (kind !== ref.kind) {
        skip(`CaptureRecord behind evidence ${ref.evidenceId} has kind '${kind}' but the ref claims '${ref.kind}' — skipped`);
        continue;
      }

      const dispatched = dispatch(ref, kind, record['payload']);
      if (dispatched === null) {
        const subkind = isPlainObject(record['payload']) && typeof record['payload']['subkind'] === 'string'
          ? record['payload']['subkind']
          : '(missing)';
        const combo = `${kind}:${subkind}`;
        const pending = comboWarning.get(combo);
        if (pending === undefined) {
          comboWarning.set(combo, { message: `captures with kind=${kind}, subkind=${subkind} are not consumed by any v0 extractor — cataloged but left uncited`, count: 1 });
        } else {
          pending.count++;
        }
        capturesSkipped++;
        continue;
      }

      const consumed: ConsumedCapture = { ...dispatched, index: captures.length };
      captures.push(consumed);
      capturesParsed++;
    }
  }

  for (const pending of comboWarning.values()) {
    warnings.push(`${pending.message} (${pending.count} occurrence${pending.count === 1 ? '' : 's'})`);
  }

  // Evidence listed in the manifest but never reachable through a
  // 'evidence.recorded' event: stays in the catalog, can never be cited.
  for (const ref of manifest.evidence) {
    if (!seenEvidenceIds.has(ref.evidenceId)) {
      warnings.push(`evidence ${ref.evidenceId} (kind ${ref.kind}) is listed in the manifest but not linked to any 'evidence.recorded' event — cataloged, left uncited`);
    }
  }

  return { captures, warnings, stats: { capturesParsed, capturesSkipped } };
}

function describeRef(ref: unknown): string {
  if (isPlainObject(ref) && typeof ref.evidenceId === 'string') {
    return ref.evidenceId;
  }
  return JSON.stringify(ref);
}

/** The consumed-capture union minus the walk-assigned index (distributive). */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type DispatchedCapture = DistributiveOmit<ConsumedCapture, 'index'>;

function dispatch(ref: EvidenceRef, kind: string, payload: unknown): DispatchedCapture | null {
  const base = { ref: { ...ref } };
  switch (kind) {
    case 'dom':
      if (isDomTreePayload(payload)) {
        return { ...base, kind: 'dom', subkind: 'dom-tree', payload };
      }
      return null;
    case 'network': {
      const subkind = isPlainObject(payload) ? payload['subkind'] : undefined;
      if (subkind === 'request' && isNetworkRequestPayload(payload)) {
        return { ...base, kind: 'network', subkind: 'request', payload };
      }
      if (subkind === 'response' && isNetworkResponsePayload(payload)) {
        return { ...base, kind: 'network', subkind: 'response', payload };
      }
      if (subkind === 'requestfailed' && isNetworkRequestFailedPayload(payload)) {
        return { ...base, kind: 'network', subkind: 'requestfailed', payload };
      }
      if (subkind === 'ws-frame' && isWebSocketFramePayload(payload)) {
        return { ...base, kind: 'network', subkind: 'ws-frame', payload };
      }
      return null;
    }
    case 'storage':
      if (isStorageInventoryPayload(payload)) {
        return { ...base, kind: 'storage', subkind: 'storage-inventory', payload };
      }
      return null;
    case 'screenshot':
      if (isScreenshotPayload(payload)) {
        return { ...base, kind: 'screenshot', subkind: 'screenshot-png', payload };
      }
      return null;
    default:
      return null;
  }
}
