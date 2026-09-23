// Shared helpers for the colocated test battery (not a test file itself).

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { RunEvent, RunEventKind, RunId, RunMeta } from '@clapp/core';
import { FsArtifactStore, FsRunStore, MemoryArtifactStore, MemoryRunStore } from './index';
import type { ArtifactStore, RunStore } from './types';

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

/** The parametrization axis for §5 test 8: memory + fs implementations. */
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
      const rootDir = await mkdtemp(join(tmpdir(), 'clapp-store-'));
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

export async function withTempRoot(fn: (rootDir: string) => Promise<void>): Promise<void> {
  const rootDir = await mkdtemp(join(tmpdir(), 'clapp-store-'));
  try {
    await fn(rootDir);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
}

export function newRunId(): RunId {
  return `run_${randomUUID()}`;
}

export function makeRunMeta(overrides?: Partial<RunMeta>): RunMeta {
  const base: RunMeta = {
    id: newRunId(),
    targetId: 'bench/b01-static',
    kind: 'observation',
    status: 'planned',
    startedAt: '2026-09-23T10:00:00.000Z',
    environment: { os: 'linux', engine: 'bun', viewport: '1280x720' },
  };
  return { ...base, ...(overrides ?? {}) };
}

export function runEvent(runId: RunId, seq: number, kind: RunEventKind, payload?: unknown): RunEvent {
  return {
    runId,
    seq,
    ts: '2026-09-23T10:00:01.000Z',
    kind,
    ...(payload !== undefined ? { payload } : {}),
  };
}

/** Deterministic pseudo-random bytes (LCG) — tests never depend on Math.random. */
export function fakeBytes(length: number, seed = 1): Uint8Array {
  const out = new Uint8Array(length);
  let x = seed >>> 0 || 1;
  for (let i = 0; i < length; i += 1) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    out[i] = (x >>> 24) & 0xff;
  }
  return out;
}
