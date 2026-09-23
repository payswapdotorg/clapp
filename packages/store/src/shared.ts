// Internal module (NOT exported from the package root): hashing, id minting,
// input validation, corruption-aware disk parsers, canonical serialization
// and the pure behavior shared by the filesystem and in-memory stores.
// Keeping every rule here means the two implementations cannot drift apart.

import { createHash, randomUUID } from 'node:crypto';
import type {
  ArtifactId,
  ArtifactKind,
  ArtifactRecord,
  EvidenceKind,
  EvidenceRef,
  RunBudget,
  RunEvent,
  RunMeta,
  RunStatus,
} from '@clapp/core';
import type { PutArtifactInput } from './types';

export const RUN_STATUSES: readonly RunStatus[] = [
  'planned',
  'running',
  'completed',
  'failed',
  'cancelled',
] as const;

export const EVIDENCE_KINDS: readonly EvidenceKind[] = [
  'dom',
  'runtime',
  'network',
  'storage',
  'screenshot',
  'static',
  'user',
] as const;

const SAFE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const ISO_8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const STORAGE_KEY_RE = /^objects\/[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{64}$/;

// ---------------------------------------------------------------------------
// Error taxonomy (internal — the frozen public API exposes no error classes;
// every error below is an Error subclass with a descriptive message).
// ---------------------------------------------------------------------------

export class StoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StoreError';
  }
}

/** Caller passed something malformed (bad id, bad hash, non-JSON-safe payload...). */
export class InvalidInputError extends StoreError {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidInputError';
  }
}

/** Persisted state disagrees with itself (tampered blob, orphan index entry...). */
export class StoreIntegrityError extends StoreError {
  constructor(message: string) {
    super(message);
    this.name = 'StoreIntegrityError';
  }
}

export class UnknownRunError extends StoreError {
  constructor(message: string) {
    super(message);
    this.name = 'UnknownRunError';
  }
}

/** createRun called twice with different meta for the same run id. */
export class RunConflictError extends StoreError {
  constructor(message: string) {
    super(message);
    this.name = 'RunConflictError';
  }
}

export class NonMonotonicSeqError extends StoreError {
  constructor(message: string) {
    super(message);
    this.name = 'NonMonotonicSeqError';
  }
}

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function newArtifactId(): ArtifactId {
  return `art_${randomUUID()}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** Deterministic, opaque, store-owned key derived from the content hash. */
export function storageKeyFor(sha256: string): string {
  return `objects/${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}`;
}

export function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isRunStatus(value: unknown): value is RunStatus {
  return typeof value === 'string' && (RUN_STATUSES as readonly string[]).includes(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------------------
// Canonical / safe JSON serialization
// ---------------------------------------------------------------------------

function jsonSafetyReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
    throw new InvalidInputError(`values of type ${typeof value} are not JSON-serializable`);
  }
  return value;
}

/** Compact single-line JSON for JSONL appends; rejects non-JSON-safe values. */
export function stringifyJsonLine(value: unknown): string {
  let out: string | undefined;
  try {
    out = JSON.stringify(value, jsonSafetyReplacer);
  } catch (error) {
    throw new InvalidInputError(`value is not JSON-serializable: ${errorMessage(error)}`);
  }
  if (out === undefined) {
    throw new InvalidInputError('value is not JSON-serializable (top-level undefined)');
  }
  return out;
}

/** Pretty JSON for standalone .json files; rejects non-JSON-safe values. */
export function stringifyJsonPretty(value: unknown): string {
  let out: string | undefined;
  try {
    out = JSON.stringify(value, jsonSafetyReplacer, 2);
  } catch (error) {
    throw new InvalidInputError(`value is not JSON-serializable: ${errorMessage(error)}`);
  }
  if (out === undefined) {
    throw new InvalidInputError('value is not JSON-serializable (top-level undefined)');
  }
  return `${out}\n`;
}

/** Parse JSONL text into values, throwing StoreIntegrityError on malformed lines. */
export function parseJsonl(text: string, ctx: string): unknown[] {
  const values: unknown[] = [];
  for (const [index, line] of text.split('\n').entries()) {
    if (line.trim().length === 0) continue;
    try {
      values.push(JSON.parse(line));
    } catch (error) {
      throw new StoreIntegrityError(`${ctx}: malformed JSON at line ${index + 1}: ${errorMessage(error)}`);
    }
  }
  return values;
}

/** Key-order-insensitive stringify, used to compare structurally-equal metas. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortJsonKeys(value));
}

function sortJsonKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonKeys);
  if (isRecordLike(value)) {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortJsonKeys(value[key]);
    }
    return sorted;
  }
  return value;
}

/**
 * Deep copy via JSON round-trip. Only call on values already validated as
 * JSON-safe (stringifyJsonLine succeeded); the round trip is exactly what the
 * filesystem store persists, so both stores observe identical semantics.
 */
export function jsonClone<T>(value: T): T {
  return JSON.parse(stringifyJsonLine(value)) as T;
}

// ---------------------------------------------------------------------------
// Input validation (runtime guards — TS types are advisory at the boundary)
// ---------------------------------------------------------------------------

export function assertSafeId(id: unknown, what: string): void {
  if (typeof id !== 'string' || !SAFE_NAME_RE.test(id)) {
    throw new InvalidInputError(
      `invalid ${what} ${JSON.stringify(id)}: must match ${SAFE_NAME_RE} (ids are used as path segments)`,
    );
  }
}

export function assertSha256Hex(sha256: unknown, what: string): void {
  if (typeof sha256 !== 'string' || !SHA256_RE.test(sha256)) {
    throw new InvalidInputError(`invalid ${what}: expected 64-char lowercase hex sha256, got ${JSON.stringify(sha256)}`);
  }
}

export function assertIso8601(ts: unknown, what: string): void {
  if (typeof ts !== 'string' || !ISO_8601_RE.test(ts)) {
    throw new InvalidInputError(`${what} must be an ISO-8601 UTC timestamp, got ${JSON.stringify(ts)}`);
  }
}

function stringField(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new InvalidInputError(`field ${name} must be a non-empty string`);
  }
  return value;
}

function intField(value: unknown, name: string, min: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min) {
    throw new InvalidInputError(`field ${name} must be an integer >= ${min}`);
  }
  return value;
}

function numberField(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new InvalidInputError(`field ${name} must be a finite non-negative number`);
  }
  return value;
}

function boolField(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') {
    throw new InvalidInputError(`field ${name} must be a boolean`);
  }
  return value;
}

function isoField(value: unknown, name: string): string {
  if (typeof value !== 'string' || !ISO_8601_RE.test(value)) {
    throw new InvalidInputError(`field ${name} must be an ISO-8601 UTC timestamp`);
  }
  return value;
}

function shaField(value: unknown, name: string): string {
  if (typeof value !== 'string' || !SHA256_RE.test(value)) {
    throw new InvalidInputError(`field ${name} must be a 64-char lowercase hex sha256`);
  }
  return value;
}

export function validatePutInput(input: PutArtifactInput): void {
  if (!isRecordLike(input)) {
    throw new InvalidInputError('put() input must be an object');
  }
  assertSafeId(input.runId, 'runId');
  if (typeof input.kind !== 'string' || input.kind.length === 0) {
    throw new InvalidInputError('kind must be a non-empty string');
  }
  if (typeof input.mediaType !== 'string' || !input.mediaType.includes('/')) {
    throw new InvalidInputError(`mediaType must look like "type/subtype", got ${JSON.stringify(input.mediaType)}`);
  }
  if (!(input.bytes instanceof Uint8Array)) {
    throw new InvalidInputError('bytes must be a Uint8Array');
  }
  if (input.redacted !== undefined && typeof input.redacted !== 'boolean') {
    throw new InvalidInputError('redacted must be a boolean when provided');
  }
}

export function validateNewRunMeta(meta: RunMeta): void {
  if (!isRecordLike(meta)) {
    throw new InvalidInputError('run meta must be an object');
  }
  assertSafeId(meta.id, 'runId');
  stringField(meta.targetId, 'targetId');
  stringField(meta.kind, 'kind');
  if (!isRunStatus(meta.status)) {
    throw new InvalidInputError(`status must be one of ${RUN_STATUSES.join('|')}, got ${JSON.stringify(meta.status)}`);
  }
  assertIso8601(meta.startedAt, 'startedAt');
  if (meta.endedAt !== undefined) assertIso8601(meta.endedAt, 'endedAt');
  if (!isRecordLike(meta.environment)) {
    throw new InvalidInputError('environment must be a plain object');
  }
  if (meta.budget !== undefined) {
    if (!isRecordLike(meta.budget)) {
      throw new InvalidInputError('budget must be an object when provided');
    }
    numberField(meta.budget.maxDurationMs, 'budget.maxDurationMs');
    for (const key of ['maxMemoryMb', 'maxArtifacts', 'maxBytes'] as const) {
      const item: unknown = meta.budget[key];
      if (item !== undefined) numberField(item, `budget.${key}`);
    }
  }
  // Enforce JSON-serializability up front so both stores persist identically.
  stringifyJsonLine(meta);
}

export function validateRunEvent(event: RunEvent): void {
  if (!isRecordLike(event)) {
    throw new InvalidInputError('run event must be an object');
  }
  assertSafeId(event.runId, 'runId');
  if (typeof event.seq !== 'number' || !Number.isInteger(event.seq) || event.seq < 0) {
    throw new InvalidInputError(`seq must be a non-negative integer, got ${JSON.stringify(event.seq)}`);
  }
  assertIso8601(event.ts, 'event ts');
  stringField(event.kind, 'kind');
  if (event.evidenceRefs !== undefined) {
    if (!Array.isArray(event.evidenceRefs)) {
      throw new InvalidInputError('evidenceRefs must be an array when provided');
    }
    event.evidenceRefs.forEach((ref, i) => {
      parseEvidenceRef(ref, `evidenceRefs[${i}]`);
    });
  }
  // Enforce JSON-serializability up front so both stores persist identically.
  stringifyJsonLine(event);
}

export function validateStatusUpdate(status: RunStatus, endedAt?: string): void {
  if (!isRunStatus(status)) {
    throw new InvalidInputError(`status must be one of ${RUN_STATUSES.join('|')}, got ${JSON.stringify(status)}`);
  }
  if (endedAt !== undefined) assertIso8601(endedAt, 'endedAt');
}

function isEvidenceKind(value: unknown): value is EvidenceKind {
  return typeof value === 'string' && (EVIDENCE_KINDS as readonly string[]).includes(value);
}

function parseEvidenceRef(value: unknown, ctx: string): EvidenceRef {
  if (!isRecordLike(value)) {
    throw new InvalidInputError(`${ctx} must be an object`);
  }
  const evidenceId = stringField(value['evidenceId'], `${ctx}.evidenceId`);
  assertSafeId(evidenceId, `${ctx}.evidenceId`);
  const kindValue: unknown = value['kind'];
  if (!isEvidenceKind(kindValue)) {
    throw new InvalidInputError(`${ctx}.kind must be one of ${EVIDENCE_KINDS.join('|')}`);
  }
  return {
    evidenceId,
    kind: kindValue,
    sha256: shaField(value['sha256'], `${ctx}.sha256`),
  };
}

// ---------------------------------------------------------------------------
// Shared pure behavior
// ---------------------------------------------------------------------------

export function buildArtifactRecord(input: PutArtifactInput, sha256: string): ArtifactRecord {
  return {
    id: newArtifactId(),
    runId: input.runId,
    kind: input.kind,
    mediaType: input.mediaType,
    sizeBytes: input.bytes.byteLength,
    sha256,
    storageKey: storageKeyFor(sha256),
    redacted: input.redacted ?? false,
    createdAt: nowIso(),
  };
}

/**
 * Seq rule: the first event of a run must be seq 0 (the contract says
 * "0-based"); every later event must have a strictly greater seq. Duplicates
 * and out-of-order appends throw. Gaps are tolerated (still strictly
 * increasing) — documented in the package header.
 */
export function checkAppendableSeq(events: readonly RunEvent[], event: RunEvent): void {
  const last = events.at(-1);
  if (last === undefined) {
    if (event.seq !== 0) {
      throw new NonMonotonicSeqError(`first event for run ${event.runId} must have seq 0, got ${event.seq}`);
    }
    return;
  }
  if (event.seq <= last.seq) {
    throw new NonMonotonicSeqError(
      `non-monotonic seq for run ${event.runId}: got ${event.seq} after ${last.seq}; ` +
        'event logs are append-only and reject duplicate or out-of-order sequence numbers',
    );
  }
}

/** createRun on an existing id: identical meta → idempotent no-op; divergence → throw. */
export function assertCreateRunAllowed(existing: RunMeta, incoming: RunMeta): void {
  if (stableStringify(existing) !== stableStringify(incoming)) {
    throw new RunConflictError(
      `run ${incoming.id} already exists with different metadata; runs are immutable and are never silently overwritten`,
    );
  }
}

/** Only status and endedAt may change — this is the single place that rule lives. */
export function applyStatusUpdate(meta: RunMeta, status: RunStatus, endedAt?: string): RunMeta {
  const updated: RunMeta = { ...meta, status };
  if (endedAt !== undefined) updated.endedAt = endedAt;
  return updated;
}

// ---------------------------------------------------------------------------
// Disk parsers (corruption-aware: anything malformed is StoreIntegrityError)
// ---------------------------------------------------------------------------

function rethrowIntegrity<T>(fn: () => T, ctx: string): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof InvalidInputError) {
      throw new StoreIntegrityError(`${ctx}: ${error.message}`);
    }
    throw error;
  }
}

export function parseRunMetaFromDisk(value: unknown, ctx: string): RunMeta {
  return rethrowIntegrity(() => {
    if (!isRecordLike(value)) throw new InvalidInputError('expected a JSON object');
    const id = stringField(value['id'], 'id');
    assertSafeId(id, 'id');
    const statusValue: unknown = value['status'];
    if (!isRunStatus(statusValue)) {
      throw new InvalidInputError(`field status must be one of ${RUN_STATUSES.join('|')}`);
    }
    const environmentValue: unknown = value['environment'];
    if (!isRecordLike(environmentValue)) {
      throw new InvalidInputError('field environment must be a JSON object');
    }
    const meta: RunMeta = {
      id,
      targetId: stringField(value['targetId'], 'targetId'),
      kind: stringField(value['kind'], 'kind'),
      status: statusValue,
      startedAt: isoField(value['startedAt'], 'startedAt'),
      environment: environmentValue,
    };
    if (value['endedAt'] !== undefined) meta.endedAt = isoField(value['endedAt'], 'endedAt');
    if (value['budget'] !== undefined) meta.budget = parseRunBudget(value['budget']);
    return meta;
  }, ctx);
}

function parseRunBudget(value: unknown): RunBudget {
  if (!isRecordLike(value)) throw new InvalidInputError('field budget must be a JSON object');
  const budget: RunBudget = { maxDurationMs: numberField(value['maxDurationMs'], 'budget.maxDurationMs') };
  for (const key of ['maxMemoryMb', 'maxArtifacts', 'maxBytes'] as const) {
    const item: unknown = value[key];
    if (item !== undefined) budget[key] = numberField(item, `budget.${key}`);
  }
  return budget;
}

export function parseRunEventFromDisk(value: unknown, ctx: string): RunEvent {
  return rethrowIntegrity(() => {
    if (!isRecordLike(value)) throw new InvalidInputError('expected a JSON object');
    const runId = stringField(value['runId'], 'runId');
    assertSafeId(runId, 'runId');
    const event: RunEvent = {
      runId,
      seq: intField(value['seq'], 'seq', 0),
      ts: isoField(value['ts'], 'ts'),
      kind: stringField(value['kind'], 'kind'),
    };
    if (value['payload'] !== undefined) event.payload = value['payload'];
    if (value['evidenceRefs'] !== undefined) {
      if (!Array.isArray(value['evidenceRefs'])) {
        throw new InvalidInputError('field evidenceRefs must be an array');
      }
      event.evidenceRefs = value['evidenceRefs'].map((ref, i) => parseEvidenceRef(ref, `evidenceRefs[${i}]`));
    }
    return event;
  }, ctx);
}

export function parseArtifactRecordFromDisk(value: unknown, ctx: string): ArtifactRecord {
  return rethrowIntegrity(() => {
    if (!isRecordLike(value)) throw new InvalidInputError('expected a JSON object');
    const id = stringField(value['id'], 'id');
    assertSafeId(id, 'id');
    const runId = stringField(value['runId'], 'runId');
    assertSafeId(runId, 'runId');
    const storageKey = stringField(value['storageKey'], 'storageKey');
    if (!STORAGE_KEY_RE.test(storageKey)) {
      // Guards readBytes against records tampered to point outside rootDir.
      throw new InvalidInputError(`storageKey must match objects/<aa>/<bb>/<sha256>, got ${JSON.stringify(storageKey)}`);
    }
    return {
      id,
      runId,
      kind: stringField(value['kind'], 'kind'),
      mediaType: stringField(value['mediaType'], 'mediaType'),
      sizeBytes: intField(value['sizeBytes'], 'sizeBytes', 0),
      sha256: shaField(value['sha256'], 'sha256'),
      storageKey,
      redacted: boolField(value['redacted'], 'redacted'),
      createdAt: isoField(value['createdAt'], 'createdAt'),
    };
  }, ctx);
}

/** One line of the per-run append-only artifact manifest. */
export interface ManifestEntry {
  artifactId: ArtifactId;
  sha256: string;
  kind: ArtifactKind;
}

export function parseManifestEntry(value: unknown, ctx: string): ManifestEntry {
  return rethrowIntegrity(() => {
    if (!isRecordLike(value)) throw new InvalidInputError('expected a JSON object');
    const artifactId = stringField(value['artifactId'], 'artifactId');
    assertSafeId(artifactId, 'artifactId');
    return {
      artifactId,
      sha256: shaField(value['sha256'], 'sha256'),
      kind: stringField(value['kind'], 'kind'),
    };
  }, ctx);
}
