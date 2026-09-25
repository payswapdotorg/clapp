/**
 * saveBundle / loadBundle — filesystem persistence for sealed bundles.
 *
 * Layout under `dir` (designed to mirror the @clapp/store object layout):
 *
 * ```
 * <dir>/bundle.json                    pretty JSON { manifest, rootHash }
 * <dir>/blobs/<aa>/<bb>/<sha256>       byte-identical copies of every
 *                                      manifest artifact blob
 * ```
 *
 * - `blobs/` makes the saved directory a self-contained evidence export
 *   (archival/distribution copies; verification still runs against the
 *   original stores — a bundle-side verifier over these copies is future
 *   work, not implemented in v0).
 * - Write order: blobs first, `bundle.json` LAST — the bundle file is the
 *   commit marker; a crash mid-save leaves orphan blobs that no bundle
 *   references, never a bundle without its blobs.
 * - Write-once semantics like the store: re-saving identical content is an
 *   idempotent no-op; overwriting existing bytes with DIFFERENT content
 *   throws.
 * - `saveBundle` refuses to persist an internally-inconsistent bundle
 *   (rootHash ≠ sha256(canonicalJson(manifest))) — never seal garbage.
 * - `loadBundle` is mechanical: it parses and shape-checks the wrapper
 *   (throwing EvidencePersistenceError, message prefixed with the
 *   BUNDLE_MALFORMED code name, on unparseable files) but performs NO
 *   tamper detection — semantic verification is `verify`'s job. A tampered
 *   bundle.json still LOADS; verify() is what reports ROOT_HASH_MISMATCH.
 */

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ArtifactStore } from '@clapp/store';
import { hashCanonicalJson } from './canonical-json';
import type { EvidenceBundle, EvidenceManifest } from './bundle';
import { errorMessage, isRecordLike } from './inspect';
import { SHA256_HEX_RE } from './manifest-shape';

/** Thrown when a bundle cannot be saved to / loaded from disk. */
export class EvidencePersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvidencePersistenceError';
  }
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && (error as { code?: unknown }).code === 'ENOENT';
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

function blobPath(dir: string, sha256: string): string {
  return join(dir, 'blobs', sha256.slice(0, 2), sha256.slice(2, 4), sha256);
}

/** Atomic-ish write-once file: identical existing content is a no-op; divergence throws. */
async function writeFileOnce(path: string, bytes: Uint8Array): Promise<void> {
  let existing: Uint8Array | null = null;
  try {
    existing = await readFile(path);
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
  if (existing !== null) {
    if (!bytesEqual(existing, bytes)) {
      throw new EvidencePersistenceError(`refusing to overwrite ${path}: existing content differs (write-once export)`);
    }
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  // Temp sibling + rename so a crash mid-write can never leave a truncated
  // file at the final path (same discipline as @clapp/store's writeBlobOnce).
  const tmpPath = `${path}.tmp-${randomUUID()}`;
  try {
    await writeFile(tmpPath, bytes);
    await rename(tmpPath, path);
  } catch (error) {
    await rm(tmpPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

/**
 * Save `bundle` under `dir` (see module doc for the layout). `artifactStore`
 * is the store the bundle was built from — blobs are exported from it.
 */
export async function saveBundle(dir: string, bundle: EvidenceBundle, artifactStore: ArtifactStore): Promise<void> {
  if (typeof dir !== 'string' || dir.trim().length === 0) {
    throw new EvidencePersistenceError('saveBundle requires a non-empty directory');
  }
  const manifest: unknown = bundle?.manifest;
  if (!isRecordLike(manifest) || !Array.isArray(manifest['artifacts'])) {
    throw new EvidencePersistenceError('saveBundle requires a bundle with a manifest carrying an artifacts array');
  }

  // Internal consistency gate — never persist an unsealed/torn bundle.
  let actualRoot: string;
  try {
    actualRoot = await hashCanonicalJson(manifest);
  } catch (error) {
    throw new EvidencePersistenceError(
      `BUNDLE_MALFORMED: bundle.manifest is not canonical-JSON serializable: ${errorMessage(error)}`,
    );
  }
  if (actualRoot !== bundle.rootHash) {
    throw new EvidencePersistenceError(
      `refusing to save bundle: manifest hashes to ${actualRoot} but rootHash claims ${bundle.rootHash}`,
    );
  }

  // Blobs first (one per unique sha256 — several artifacts may share bytes).
  const exportedShas = new Set<string>();
  for (const record of bundle.manifest.artifacts) {
    if (exportedShas.has(record.sha256)) continue;
    exportedShas.add(record.sha256);
    let bytes: Uint8Array | null;
    try {
      bytes = await artifactStore.readBytes(record.id);
    } catch (error) {
      throw new EvidencePersistenceError(
        `artifact ${record.id} could not be read from the store: ${errorMessage(error)}`,
      );
    }
    if (bytes === null) {
      throw new EvidencePersistenceError(
        `artifact ${record.id} has no bytes in the store; cannot export blob ${record.sha256}`,
      );
    }
    await writeFileOnce(blobPath(dir, record.sha256), bytes);
  }

  // bundle.json LAST — the commit marker.
  const bundlePath = join(dir, 'bundle.json');
  const bundleText = `${JSON.stringify({ manifest: bundle.manifest, rootHash: bundle.rootHash }, null, 2)}\n`;
  await writeFileOnce(bundlePath, new TextEncoder().encode(bundleText));
}

/**
 * Load the bundle saved at `dir`. Mechanical parse + wrapper shape check
 * only; run `verify(loaded, stores)` for tamper detection.
 */
export async function loadBundle(dir: string): Promise<EvidenceBundle> {
  const bundlePath = join(dir, 'bundle.json');
  let text: string;
  try {
    text = await readFile(bundlePath, 'utf8');
  } catch (error) {
    throw new EvidencePersistenceError(`no bundle at ${bundlePath}: ${errorMessage(error)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new EvidencePersistenceError(`BUNDLE_MALFORMED: ${bundlePath} is not valid JSON: ${errorMessage(error)}`);
  }
  if (!isRecordLike(parsed)) {
    throw new EvidencePersistenceError(`BUNDLE_MALFORMED: ${bundlePath} must contain a JSON object`);
  }
  const manifest: unknown = parsed['manifest'];
  const rootHash: unknown = parsed['rootHash'];
  if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
    throw new EvidencePersistenceError(
      `BUNDLE_MALFORMED: ${bundlePath} must contain { manifest: object, rootHash: string }`,
    );
  }
  if (typeof rootHash !== 'string' || !SHA256_HEX_RE.test(rootHash)) {
    throw new EvidencePersistenceError(
      `BUNDLE_MALFORMED: ${bundlePath} rootHash must be 64 lowercase hex chars`,
    );
  }
  // Mechanical load only — deep validation and tamper detection are
  // verify()'s job.
  return { manifest: manifest as EvidenceManifest, rootHash };
}
