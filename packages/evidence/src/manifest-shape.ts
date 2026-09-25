/**
 * Internal shared shape validators (NOT exported from the package root).
 *
 * These validate the JSON shapes that ride inside an EvidenceBundle manifest
 * (RunMeta, RunEvent, EvidenceRef, ArtifactRecord) and the manifest itself.
 * They are total — never throw — and report every violation they observe,
 * mirroring the style of @clapp/core's `validateRunEvent`.
 *
 * Used by `buildBundle` (as honest preconditions: a run that does not
 * conform cannot be sealed into a manifest) and by `verify` (as the
 * MANIFEST_MALFORMED phase). Keeping one copy means the builder and the
 * verifier can never disagree about what a well-formed manifest is.
 */

import { EVIDENCE_KINDS, RUN_STATUSES, validateRunEvent } from '@clapp/core';
import type { ArtifactRecord, EvidenceRef, RunBudget, RunEvent, RunMeta } from '@clapp/core';
import { isRecordLike, preview } from './inspect';
import type { EvidenceManifest } from './bundle';

/** 64-char lowercase hex sha256. */
export const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

/** ISO-8601 timestamp with timezone (mirrors the @clapp/store regex). */
export const ISO_8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/** Opaque object-store key of the shape both shipped stores produce. */
export const STORAGE_KEY_RE = /^objects\/[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{64}$/;

const RUN_STATUS_SET = new Set<string>(RUN_STATUSES);
const EVIDENCE_KIND_SET = new Set<string>(EVIDENCE_KINDS);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** Structural violations of a RunMeta-shaped value. */
export function runMetaViolations(value: unknown): string[] {
  if (!isRecordLike(value)) {
    return [`run must be an object, observed ${preview(value)}`];
  }
  const meta = value as Partial<RunMeta>;
  const out: string[] = [];

  if (!isNonEmptyString(meta.id)) out.push(`run.id must be a non-empty string, observed ${preview(meta.id)}`);
  if (!isNonEmptyString(meta.targetId)) {
    out.push(`run.targetId must be a non-empty string, observed ${preview(meta.targetId)}`);
  }
  if (!isNonEmptyString(meta.kind)) out.push(`run.kind must be a non-empty string, observed ${preview(meta.kind)}`);
  if (typeof meta.status !== 'string' || !RUN_STATUS_SET.has(meta.status)) {
    out.push(`run.status must be one of ${RUN_STATUSES.join('|')}, observed ${preview(meta.status)}`);
  }
  if (typeof meta.startedAt !== 'string' || !ISO_8601_RE.test(meta.startedAt)) {
    out.push(`run.startedAt must be an ISO-8601 timestamp, observed ${preview(meta.startedAt)}`);
  }
  if (meta.endedAt !== undefined && (typeof meta.endedAt !== 'string' || !ISO_8601_RE.test(meta.endedAt))) {
    out.push(`run.endedAt must be an ISO-8601 timestamp when present, observed ${preview(meta.endedAt)}`);
  }
  if (!isRecordLike(meta.environment)) {
    out.push(`run.environment must be an object, observed ${preview(meta.environment)}`);
  }
  out.push(...budgetViolations(meta.budget, 'run.budget'));
  return out;
}

function budgetViolations(budget: unknown, label: string): string[] {
  if (budget === undefined) return [];
  if (!isRecordLike(budget)) return [`${label} must be an object when present, observed ${preview(budget)}`];
  const record = budget as Partial<RunBudget>;
  const out: string[] = [];
  const required: [key: string, value: unknown][] = [['maxDurationMs', record.maxDurationMs]];
  const optional: [key: string, value: unknown][] = [
    ['maxMemoryMb', record.maxMemoryMb],
    ['maxArtifacts', record.maxArtifacts],
    ['maxBytes', record.maxBytes],
  ];
  for (const [key, value] of required) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      out.push(`${label}.${key} must be a finite non-negative number, observed ${preview(value)}`);
    }
  }
  for (const [key, value] of optional) {
    if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) {
      out.push(`${label}.${key} must be a finite non-negative number when present, observed ${preview(value)}`);
    }
  }
  return out;
}

/** Structural violations of an EvidenceRef-shaped value. */
export function evidenceRefViolations(value: unknown): string[] {
  if (!isRecordLike(value)) {
    return [`evidence ref must be an object, observed ${preview(value)}`];
  }
  const ref = value as Partial<EvidenceRef>;
  const out: string[] = [];
  if (!isNonEmptyString(ref.evidenceId)) {
    out.push(`evidenceId must be a non-empty string, observed ${preview(ref.evidenceId)}`);
  }
  if (typeof ref.kind !== 'string' || !EVIDENCE_KIND_SET.has(ref.kind)) {
    out.push(`kind must be one of ${EVIDENCE_KINDS.join('|')}, observed ${preview(ref.kind)}`);
  }
  if (typeof ref.sha256 !== 'string' || !SHA256_HEX_RE.test(ref.sha256)) {
    out.push(`sha256 must be 64 lowercase hex chars, observed ${preview(ref.sha256)}`);
  }
  return out;
}

/** Structural violations of an ArtifactRecord-shaped value. */
export function artifactRecordViolations(value: unknown): string[] {
  if (!isRecordLike(value)) {
    return [`artifact record must be an object, observed ${preview(value)}`];
  }
  const record = value as Partial<ArtifactRecord>;
  const out: string[] = [];
  if (!isNonEmptyString(record.id)) out.push(`id must be a non-empty string, observed ${preview(record.id)}`);
  if (!isNonEmptyString(record.runId)) {
    out.push(`runId must be a non-empty string, observed ${preview(record.runId)}`);
  }
  if (!isNonEmptyString(record.kind)) out.push(`kind must be a non-empty string, observed ${preview(record.kind)}`);
  if (typeof record.mediaType !== 'string' || !record.mediaType.includes('/')) {
    out.push(`mediaType must look like "type/subtype", observed ${preview(record.mediaType)}`);
  }
  if (typeof record.sizeBytes !== 'number' || !Number.isInteger(record.sizeBytes) || record.sizeBytes < 0) {
    out.push(`sizeBytes must be an integer >= 0, observed ${preview(record.sizeBytes)}`);
  }
  if (typeof record.sha256 !== 'string' || !SHA256_HEX_RE.test(record.sha256)) {
    out.push(`sha256 must be 64 lowercase hex chars, observed ${preview(record.sha256)}`);
  }
  if (typeof record.storageKey !== 'string' || !STORAGE_KEY_RE.test(record.storageKey)) {
    out.push(`storageKey must match objects/<aa>/<bb>/<sha256>, observed ${preview(record.storageKey)}`);
  }
  if (typeof record.redacted !== 'boolean') {
    out.push(`redacted must be a boolean, observed ${preview(record.redacted)}`);
  }
  if (typeof record.createdAt !== 'string' || !ISO_8601_RE.test(record.createdAt)) {
    out.push(`createdAt must be an ISO-8601 timestamp, observed ${preview(record.createdAt)}`);
  }
  return out;
}

/**
 * Structural violations of an EvidenceBundle manifest. Event-stream
 * ordering/monotonicity and manifest-vs-store agreement are NOT checked
 * here — they belong to `verify`'s EVENT_SEQ_INVALID / EVENT_MISSING /
 * MANIFEST_HASH_MISMATCH phases.
 */
export function manifestViolations(value: unknown): string[] {
  if (!isRecordLike(value)) {
    return [`manifest must be an object, observed ${preview(value)}`];
  }
  const manifest = value as Partial<EvidenceManifest>;
  const out: string[] = [];

  if (manifest.schemaVersion !== 1) {
    out.push(`schemaVersion must be 1, observed ${preview(manifest.schemaVersion)}`);
  }
  out.push(...runMetaViolations(manifest.run).map((violation) => `run: ${violation}`));

  if (!Array.isArray(manifest.events)) {
    out.push(`events must be an array, observed ${preview(manifest.events)}`);
  } else {
    manifest.events.forEach((event, index) => {
      for (const violation of validateRunEvent(event as RunEvent)) {
        out.push(`events[${index}]: ${violation}`);
      }
    });
  }

  if (!Array.isArray(manifest.artifacts)) {
    out.push(`artifacts must be an array, observed ${preview(manifest.artifacts)}`);
  } else {
    manifest.artifacts.forEach((record, index) => {
      for (const violation of artifactRecordViolations(record)) {
        out.push(`artifacts[${index}]: ${violation}`);
      }
    });
    const ids = new Set<string>();
    for (const record of manifest.artifacts) {
      if (isRecordLike(record) && isNonEmptyString(record['id'])) {
        const id = record['id'];
        if (ids.has(id)) out.push(`artifacts: duplicate artifact id ${preview(id)}`);
        ids.add(id);
      }
    }
  }

  if (!Array.isArray(manifest.evidence)) {
    out.push(`evidence must be an array, observed ${preview(manifest.evidence)}`);
  } else {
    manifest.evidence.forEach((ref, index) => {
      for (const violation of evidenceRefViolations(ref)) {
        out.push(`evidence[${index}]: ${violation}`);
      }
    });
    const evidenceIds = new Set<string>();
    for (const ref of manifest.evidence) {
      if (isRecordLike(ref) && isNonEmptyString(ref['evidenceId'])) {
        const evidenceId = ref['evidenceId'];
        if (evidenceIds.has(evidenceId)) {
          out.push(`evidence: duplicate evidenceId ${preview(evidenceId)}`);
        }
        evidenceIds.add(evidenceId);
      }
    }
  }

  return out;
}
