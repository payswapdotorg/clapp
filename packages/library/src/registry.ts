/**
 * @clapp/library — the package registry (CLAPP-055, the W2 registry lane —
 * the last open P5 checkbox).
 *
 * An in-memory, deterministic, fail-closed store of package records AT
 * their CURRENT stage: 'candidate' (the extraction record contract's
 * minted stage) or 'replayed' (the promotion record contract's stage).
 * The registry never promotes and never demotes — promotion stays
 * test-gated (CLAPP-054) — and it never overwrites: the
 * (manifest.id, manifest.version) pair is an IMMUTABLE key
 * (docs/WORKER_HANDOFFS.md acceptance; docs/LEARNING_AND_LIBRARY.md §5
 * "the library must never silently overwrite a package").
 *
 * Discipline (binding, this lane's packet):
 * - No clock: registeredAt is CALLER-injected per registration (RFC3339,
 *   validated with the frozen package-contract helper — the registry reads
 *   no clock; there is no clock to read).
 * - No randomness, no network, no filesystem.
 * - Fail closed (the §8 contamination guard): every rejection is a
 *   collected, field-named error in a { ok: false, errors } result —
 *   results, never exceptions; a rejected admission stores nothing.
 * - Determinism: the same set of registrations produces the same snapshot
 *   in ANY input order (records are canonically sorted before hashing).
 *
 * Query-handle policy: register and get return the stored record itself —
 * the manifest is stored VERBATIM (the caller's own object, never
 * rewritten), so the caller holds an alias by construction; list returns
 * DEEP COPIES, the one channel this contract seals (the caller can never
 * mutate registry state through a listing).
 *
 * In-memory v0.1: persistence is a later, tech-lead-declared lane; this
 * module stores nothing outside its closure.
 */

import { sha256Hex } from '@clapp/core';
import { canonicalJson } from '@clapp/observe';

import { isObject, isRfc3339, preview, validatePackageManifest } from './package-contract';
import type { PackageManifest } from './package-contract';
import { PROMOTION_VERSION } from './promotion';
import type { PackagePromotionRecord } from './promotion';
import type { PackageCandidate, PackageStage } from './record';

// ---- the registry contract v0.1 ---------------------------------------------------

/** The registry's contract version (bumps only via a tech-lead declaration wave). */
export const REGISTRY_VERSION = '0.1';

/** The registry's snapshotted record: a manifest + its CURRENT stage. */
export interface RegistryRecord {
  /** VERBATIM as registered — immutable once registered (never rewritten). */
  manifest: PackageManifest;
  /** 'candidate' (extraction) or 'replayed' (promotion) — the landed stages. */
  stage: PackageStage | 'replayed';
  /** RFC3339 — caller-injected per registration; the registry reads no clock. */
  registeredAt: string;
  /** The registering work item's identity, taken from the input's own context. */
  registeredBy: string;
}

/** Fail-closed registration: a result, never an exception. */
export type RegistryResult =
  | { ok: true; record: RegistryRecord }
  | { ok: false; errors: string[] };

/** A registry over RegistryRecords: put/get/list, deterministic, fail-closed. */
export interface PackageRegistry {
  register(input: unknown, options: unknown): Promise<RegistryResult>;
  get(id: unknown, version: unknown): RegistryRecord | null;
  list(filter?: { stage?: string }): RegistryRecord[];
  size(): number;
  entries(): number;
  snapshot(): Promise<string>;
}

/**
 * The snapshot digest prefix — THIS lane's frozen proposal in the
 * `pkg_` / `cgraph_` / `rq_` prefix discipline.
 */
const SNAPSHOT_PREFIX = 'creg_';

/** The candidate-shaped admission slice (the record.ts contract). */
type CandidateAdmission = Pick<PackageCandidate, 'manifest' | 'extractionContext'> & {
  stage?: PackageCandidate['stage'];
};

/** The promotion-shaped admission slice (the promotion.ts contract). */
type PromotionAdmission = Pick<
  PackagePromotionRecord,
  'promotionVersion' | 'manifest' | 'stage' | 'promotionContext'
>;

// ---- internal helpers -------------------------------------------------------------

/** Plain-value deep copy (manifests are JSON-shaped; no class instances). */
function deepCopyValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => deepCopyValue(item));
  }
  if (isObject(value)) {
    const copy: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      copy[key] = deepCopyValue(value[key]);
    }
    return copy;
  }
  return value;
}

/** The defensive copy a listing hands out — never aliases stored state. */
function copyRecord(record: RegistryRecord): RegistryRecord {
  return {
    manifest: deepCopyValue(record.manifest) as PackageManifest,
    stage: record.stage,
    registeredAt: record.registeredAt,
    registeredBy: record.registeredBy,
  };
}

// ---- the registry ------------------------------------------------------------------

/**
 * Builds an EMPTY registry. All state is private to the closure; the only
 * mutation is the admission of a not-yet-present (id, version) key.
 */
export function createRegistry(): PackageRegistry {
  /** manifest.id → manifest.version → the stored record (immutable slots). */
  const byId = new Map<string, Map<string, RegistryRecord>>();
  let count = 0; // measured — +1 per admitted record, never decremented

  /** All stored records in canonical (id, version) order. */
  const canonicalRecords = (): RegistryRecord[] => {
    const records: RegistryRecord[] = [];
    for (const versions of byId.values()) {
      for (const record of versions.values()) {
        records.push(record);
      }
    }
    records.sort((left, right) => {
      if (left.manifest.id !== right.manifest.id) {
        return left.manifest.id < right.manifest.id ? -1 : 1;
      }
      if (left.manifest.version !== right.manifest.version) {
        return left.manifest.version < right.manifest.version ? -1 : 1;
      }
      return 0; // unreachable: (id, version) keys are unique
    });
    return records;
  };

  /** options.registeredAt — caller-injected, RFC3339, or a named error. */
  const readRegisteredAt = (options: unknown, errors: string[]): string | null => {
    if (!isObject(options)) {
      errors.push(`options: expected an object { registeredAt }, got ${preview(options)}`);
      return null;
    }
    const registeredAt = options['registeredAt'];
    if (!isRfc3339(registeredAt)) {
      errors.push(
        `options.registeredAt: expected an RFC3339 date-time string (caller-injected — the registry never reads a clock), got ${preview(registeredAt)}`,
      );
      return null;
    }
    return registeredAt;
  };

  /** The frozen admission gate: the manifest must pass validatePackageManifest. */
  const readManifest = (manifest: unknown, errors: string[]): PackageManifest | null => {
    const check = validatePackageManifest(manifest);
    if (!check.ok) {
      for (const error of check.errors) {
        errors.push(`input.manifest: ${error}`);
      }
      return null;
    }
    // VERBATIM: the input's own manifest object is the stored one.
    return manifest as PackageManifest;
  };

  /** Candidate shape: stage 'candidate' when present; identity from the context. */
  const validateCandidate = (
    input: Record<string, unknown>,
    errors: string[],
  ): CandidateAdmission | null => {
    let valid = true;

    const stage = input['stage'];
    if (stage !== undefined && stage !== 'candidate') {
      errors.push(
        `stage: expected "candidate" for a candidate-shaped registration, got ${preview(stage)}`,
      );
      valid = false;
    }

    const extractionContext = input['extractionContext'];
    if (!isObject(extractionContext)) {
      errors.push(
        `extractionContext: expected an object (the registeredBy source), got ${preview(extractionContext)}`,
      );
      valid = false;
    } else {
      const extractedBy = extractionContext['extractedBy'];
      if (typeof extractedBy !== 'string' || extractedBy.length === 0) {
        errors.push(
          `extractionContext.extractedBy: expected a non-empty string (the registeredBy source), got ${preview(extractedBy)}`,
        );
        valid = false;
      }
    }

    return valid ? (input as unknown as CandidateAdmission) : null;
  };

  /** Promotion shape: the frozen PackagePromotionRecord admission rules. */
  const validatePromotion = (
    input: Record<string, unknown>,
    errors: string[],
  ): PromotionAdmission | null => {
    let valid = true;

    const promotionVersion = input['promotionVersion'];
    if (promotionVersion !== PROMOTION_VERSION) {
      errors.push(
        `promotionVersion: expected "${PROMOTION_VERSION}" (PROMOTION_VERSION), got ${preview(promotionVersion)}`,
      );
      valid = false;
    }

    const stage = input['stage'];
    if (stage !== 'replayed') {
      errors.push(
        `stage: expected "replayed" for a promotion-shaped registration, got ${preview(stage)}`,
      );
      valid = false;
    }

    const promotionContext = input['promotionContext'];
    if (!isObject(promotionContext)) {
      errors.push(
        `promotionContext: expected an object (promotedAt + promotedBy), got ${preview(promotionContext)}`,
      );
      valid = false;
    } else {
      const promotedAt = promotionContext['promotedAt'];
      if (!isRfc3339(promotedAt)) {
        errors.push(
          `promotionContext.promotedAt: expected an RFC3339 date-time string, got ${preview(promotedAt)}`,
        );
        valid = false;
      }
      const promotedBy = promotionContext['promotedBy'];
      if (typeof promotedBy !== 'string' || promotedBy.length === 0) {
        errors.push(
          `promotionContext.promotedBy: expected a non-empty string (the registeredBy source), got ${preview(promotedBy)}`,
        );
        valid = false;
      }
    }

    return valid ? (input as unknown as PromotionAdmission) : null;
  };

  const register = async (input: unknown, options: unknown): Promise<RegistryResult> => {
    const errors: string[] = [];

    // Caller-injected registration time — the registry never reads a clock.
    const registeredAt = readRegisteredAt(options, errors);

    if (!isObject(input)) {
      errors.push(
        `input: expected an object (candidate-shaped or promotion-shaped), got ${preview(input)}`,
      );
      return { ok: false, errors };
    }

    // The frozen admission gate.
    const manifest = readManifest(input['manifest'], errors);

    // Admission-shape discrimination: promotion markers select the promotion
    // path; everything else is candidate-shaped.
    const promotionShaped =
      input['promotionVersion'] !== undefined ||
      input['stage'] === 'replayed' ||
      input['promotionContext'] !== undefined;
    const stage: RegistryRecord['stage'] = promotionShaped ? 'replayed' : 'candidate';

    let registeredBy: string | null = null;
    if (promotionShaped) {
      const admission = validatePromotion(input, errors);
      registeredBy = admission === null ? null : admission.promotionContext.promotedBy;
    } else {
      const admission = validateCandidate(input, errors);
      registeredBy = admission === null ? null : admission.extractionContext.extractedBy;
    }

    if (
      errors.length > 0 ||
      manifest === null ||
      registeredBy === null ||
      registeredAt === null
    ) {
      // Fail closed: nothing is stored; every error names its field.
      return { ok: false, errors };
    }

    // Immutability: the (id, version) pair is the key — never overwritten.
    const versions = byId.get(manifest.id);
    if (versions !== undefined) {
      const existing = versions.get(manifest.version);
      if (existing !== undefined) {
        errors.push(
          `duplicate registration: ${manifest.id} @ ${manifest.version} is already registered at stage ${existing.stage}`,
        );
        return { ok: false, errors };
      }
    }

    // VERBATIM storage: the input's manifest object, stored as-is, at the
    // stage its admission shape minted ('candidate' or 'replayed'). The
    // registry never promotes, never demotes, never rewrites.
    const record: RegistryRecord = { manifest, stage, registeredAt, registeredBy };
    if (versions === undefined) {
      byId.set(manifest.id, new Map([[manifest.version, record]]));
    } else {
      versions.set(manifest.version, record);
    }
    count += 1;
    return { ok: true, record };
  };

  const get = (id: unknown, version: unknown): RegistryRecord | null => {
    // A query is never an error; non-string arguments and misses are null.
    if (typeof id !== 'string' || typeof version !== 'string') {
      return null;
    }
    const record = byId.get(id)?.get(version);
    return record === undefined ? null : record;
  };

  const list = (filter?: { stage?: string }): RegistryRecord[] => {
    // Defensive copies: the caller can never mutate registry state through
    // a listing (deep-copied records, a fresh array).
    const records = canonicalRecords().map(copyRecord);
    if (filter === undefined) {
      return records;
    }
    if (!isObject(filter)) {
      return []; // a null or non-object filter surfaces nothing (fail closed)
    }
    const wanted: unknown = filter['stage'];
    if (wanted === undefined) {
      return records;
    }
    if (typeof wanted !== 'string') {
      return []; // exact stage match: a non-string stage matches nothing
    }
    return records.filter((record) => record.stage === wanted);
  };

  const size = (): number => count;

  const entries = (): number => count; // alias of size — the honest count

  const snapshot = async (): Promise<string> => {
    // Content-addressed: canonical (id, version) order + canonicalJson +
    // sha256 — identical contents produce identical digests, any admission
    // moves the digest, and the input order of registrations never leaks.
    const records = canonicalRecords().map((record) => ({
      manifest: record.manifest,
      stage: record.stage,
      registeredAt: record.registeredAt,
      registeredBy: record.registeredBy,
    }));
    const payload = canonicalJson({ registryVersion: REGISTRY_VERSION, records });
    return SNAPSHOT_PREFIX + (await sha256Hex(payload));
  };

  return { register, get, list, size, entries, snapshot };
}
