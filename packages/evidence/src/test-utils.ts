// Shared helpers for the colocated test battery (not a test file itself).
// Mirrors the @clapp/store test-utils convention: the parametrization axis
// is the store implementation pair (memory + fs).

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sha256Hex } from '@clapp/core';
import type { EvidenceRef, RunId } from '@clapp/core';
import { FsArtifactStore, FsRunStore, MemoryArtifactStore, MemoryRunStore } from '@clapp/store';
import type { ArtifactStore, RunStore } from '@clapp/store';
import type { EvidenceBundle, EvidenceManifest } from './bundle';
import { canonicalJson } from './canonical-json';
import type { CaptureRecord } from './capture-contract';
import { RecordingSession } from './recording-session';

export interface StorePair {
  artifactStore: ArtifactStore;
  runStore: RunStore;
  rootDir?: string;
}

export interface StoreImpl {
  name: string;
  make: () => Promise<StorePair>;
  cleanup: (pair: StorePair) => Promise<void>;
}

export const storeImplementations: StoreImpl[] = [
  {
    name: 'MemoryArtifactStore + MemoryRunStore',
    make: async () => ({
      artifactStore: new MemoryArtifactStore(),
      runStore: new MemoryRunStore(),
    }),
    cleanup: async () => {},
  },
  {
    name: 'FsArtifactStore + FsRunStore',
    make: async () => {
      const rootDir = await mkdtemp(join(tmpdir(), 'clapp-evidence-'));
      return {
        artifactStore: new FsArtifactStore(rootDir),
        runStore: new FsRunStore(rootDir),
        rootDir,
      };
    },
    cleanup: async (pair) => {
      if (pair.rootDir !== undefined) {
        await rm(pair.rootDir, { recursive: true, force: true });
      }
    },
  },
];

export async function withPair(impl: StoreImpl, fn: (pair: StorePair) => Promise<void>): Promise<void> {
  const pair = await impl.make();
  try {
    await fn(pair);
  } finally {
    await impl.cleanup(pair);
  }
}

export async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'clapp-evidence-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Deterministic capture fixture (payloads are plain canonical-JSON data). */
export function captureFixture(overrides?: Partial<CaptureRecord>): CaptureRecord {
  const base: CaptureRecord = {
    kind: 'dom',
    ts: '2026-09-25T10:00:00.000Z',
    payload: { title: 'Home', headings: ['CLAPP', 'Evidence'] },
    redacted: false,
  };
  return { ...base, ...(overrides ?? {}) };
}

/**
 * Fake credential-shaped string assembled at runtime from fragments —
 * fixtures never carry secret-shaped literals (program constitution).
 */
export function fakeSecret(label: string, n: number): string {
  return [label, 'fixture', 'cred', String(n).padStart(3, '0')].join('-');
}

/** Re-seal a manifest with a fresh rootHash — the honest attacker's helper. */
export async function reseal(manifest: EvidenceManifest): Promise<EvidenceBundle> {
  return { manifest, rootHash: await sha256Hex(canonicalJson(manifest)) };
}

/** Deep-clone a manifest (JSON round-trip; manifests are JSON-safe by construction). */
export function cloneManifest(manifest: EvidenceManifest): EvidenceManifest {
  return JSON.parse(JSON.stringify(manifest)) as EvidenceManifest;
}

/** Tamper with a copy of the bundle's manifest and re-seal the rootHash. */
export async function tampered(
  bundle: EvidenceBundle,
  mutate: (manifest: EvidenceManifest) => void,
): Promise<EvidenceBundle> {
  const manifest = cloneManifest(bundle.manifest);
  mutate(manifest);
  return reseal(manifest);
}

/**
 * Standard scenario: a session recording 3 distinct captures plus 1
 * byte-identical duplicate (idempotent dedupe), then completed.
 * Yields 5 events, 3 evidence refs, 3 artifacts.
 */
export async function recordedScenario(
  stores: StorePair,
): Promise<{ runId: RunId; refs: EvidenceRef[]; duplicate: EvidenceRef }> {
  const session = await RecordingSession.start(stores, { targetId: 'bench/b01-static' });
  const first = await session.record(captureFixture());
  const second = await session.record(
    captureFixture({
      kind: 'network',
      ts: '2026-09-25T10:00:01.000Z',
      payload: { requests: [{ url: 'https://example.test/x', status: 200 }] },
      redacted: true,
    }),
  );
  const third = await session.record(
    captureFixture({
      kind: 'runtime',
      ts: '2026-09-25T10:00:02.000Z',
      payload: { console: ['loaded'] },
    }),
  );
  const duplicate = await session.record(captureFixture());
  await session.complete();
  return { runId: session.runId, refs: [first, second, third], duplicate };
}
