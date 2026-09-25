/**
 * verify() — tamper detection for EvidenceBundles.
 *
 * `verify(bundle, stores)` re-hashes every artifact and the manifest and
 * cross-checks the bundle's claims against the live stores. It is total
 * (never throws) and returns either `{ ok: true, ... counts }` or the FIRST
 * failure with a machine-readable code from the frozen set below.
 *
 * TAMPER CODE SET (FROZEN — extend-only, never rename):
 *
 * - BUNDLE_MALFORMED       — the wrapper is structurally broken (not an
 *                            object; manifest not an object; rootHash not
 *                            64-char lowercase hex). Also the defensive
 *                            catch-all when verify itself cannot process a
 *                            pathological bundle.
 * - MANIFEST_MALFORMED     — the manifest fails deep structural validation
 *                            (schemaVersion, RunMeta / RunEvent /
 *                            EvidenceRef / ArtifactRecord shapes, duplicate
 *                            artifact ids / evidence ids), or cannot be
 *                            canonical-JSON serialized at all.
 * - ROOT_HASH_MISMATCH     — sha256(canonicalJson(manifest)) ≠ rootHash:
 *                            the manifest was edited without re-sealing.
 * - RUN_META_MISMATCH      — the run identity the manifest claims differs
 *                            from the store's RunMeta, or the store does
 *                            not know the run. status/endedAt are EXCLUDED
 *                            (mutable by design via RunStore.updateStatus).
 * - EVENT_SEQ_INVALID      — the event stream (manifest or store) violates
 *                            seq rules: first event not seq 0, seq not
 *                            strictly increasing, or events from another
 *                            run mixed into the stream.
 * - EVENT_MISSING          — a manifest event is not present VERBATIM in
 *                            the store's event log (absent, or a different
 *                            event squats its seq). Extra store events
 *                            beyond the manifest are ALLOWED — bundles can
 *                            be built mid-run and events appended after.
 * - ARTIFACT_MISSING       — a manifest artifact is unknown to the artifact
 *                            store, or its blob cannot be read.
 * - MANIFEST_HASH_MISMATCH — the manifest's artifact record disagrees with
 *                            the store's record for the same artifact id
 *                            (any field: sha256, kind, sizeBytes, …).
 *                            Catches a re-sealed manifest that lies about
 *                            what the store actually recorded.
 * - ARTIFACT_HASH_MISMATCH — artifact bytes hash to something other than
 *                            the record's sha256 (or the store's own
 *                            integrity layer refused the bytes).
 * - REF_UNKNOWN            — a manifest evidence ref is not carried by any
 *                            event, or no manifest artifact holds its sha256.
 * - REF_KIND_MISMATCH      — the artifacts holding the ref's sha256 do not
 *                            include one of the kind the ref's evidence
 *                            kind maps to (EVIDENCE_TO_ARTIFACT_KIND).
 *
 * Check order (first failure wins, phases in this exact sequence):
 *   1 BUNDLE_MALFORMED → 2 MANIFEST_MALFORMED → 3 ROOT_HASH_MISMATCH →
 *   4 RUN_META_MISMATCH → 5 EVENT_SEQ_INVALID (manifest stream, then store
 *   stream) → 6 EVENT_MISSING → 7 per artifact: ARTIFACT_MISSING →
 *   MANIFEST_HASH_MISMATCH → ARTIFACT_HASH_MISMATCH → 8 per evidence ref:
 *   REF_UNKNOWN (unbacked) → REF_UNKNOWN (no artifact) → REF_KIND_MISMATCH.
 */

import { sha256Hex } from '@clapp/core';
import type { ArtifactKind, ArtifactRecord, RunEvent, RunMeta } from '@clapp/core';
import type { ArtifactStore, RunStore } from '@clapp/store';
import { canonicalJson } from './canonical-json';
import { errorMessage, isRecordLike, preview } from './inspect';
import { SHA256_HEX_RE } from './manifest-shape';
import { manifestViolations } from './manifest-shape';
import { artifactKindForEvidence } from './recording-session';
import type { EvidenceBundle, EvidenceManifest } from './bundle';

/** The frozen tamper-code vocabulary (extend-only; never rename a member). */
export const TAMPER_CODES = [
  'ARTIFACT_MISSING',
  'ARTIFACT_HASH_MISMATCH',
  'MANIFEST_HASH_MISMATCH',
  'ROOT_HASH_MISMATCH',
  'MANIFEST_MALFORMED',
  'EVENT_SEQ_INVALID',
  'EVENT_MISSING',
  'RUN_META_MISMATCH',
  'REF_UNKNOWN',
  'REF_KIND_MISMATCH',
  'BUNDLE_MALFORMED',
] as const;

/** Machine-readable tamper code (frozen set — see {@link TAMPER_CODES}). */
export type TamperCode = (typeof TAMPER_CODES)[number];

/** Result of {@link verify}: ok with counts, or the first failure + code. */
export type VerifyResult =
  | {
      ok: true;
      rootHash: string;
      eventCount: number;
      evidenceCount: number;
      artifactCount: number;
    }
  | { ok: false; code: TamperCode; detail: string };

/** The stores verify() cross-checks a bundle against. */
export interface VerificationStores {
  artifactStore: ArtifactStore;
  runStore: RunStore;
}

function fail(code: TamperCode, detail: string): VerifyResult {
  return { ok: false, code, detail };
}

/**
 * Verify a bundle against the live stores. Total: never throws — internal
 * surprises surface as BUNDLE_MALFORMED with the error message in detail.
 */
export async function verify(bundle: EvidenceBundle, stores: VerificationStores): Promise<VerifyResult> {
  try {
    return await verifyPhases(bundle, stores);
  } catch (error) {
    return fail('BUNDLE_MALFORMED', `verify could not process the bundle: ${errorMessage(error)}`);
  }
}

async function verifyPhases(bundle: EvidenceBundle, stores: VerificationStores): Promise<VerifyResult> {
  // ---- Phase 1: bundle wrapper shape ------------------------------------
  const wrapper: unknown = bundle;
  if (!isRecordLike(wrapper)) {
    return fail('BUNDLE_MALFORMED', `bundle must be an object, observed ${preview(wrapper)}`);
  }
  const manifestValue: unknown = wrapper['manifest'];
  if (typeof manifestValue !== 'object' || manifestValue === null || Array.isArray(manifestValue)) {
    return fail('BUNDLE_MALFORMED', `bundle.manifest must be an object, observed ${preview(manifestValue)}`);
  }
  const rootHash: unknown = wrapper['rootHash'];
  if (typeof rootHash !== 'string' || !SHA256_HEX_RE.test(rootHash)) {
    return fail('BUNDLE_MALFORMED', `bundle.rootHash must be 64 lowercase hex chars, observed ${preview(rootHash)}`);
  }
  // Deep structural validation follows in phase 2 — this cast is only the
  // working type for the checks below.
  const manifest = manifestValue as EvidenceManifest;

  // ---- Phase 2: manifest structural validation --------------------------
  const violations = manifestViolations(manifest);
  if (violations.length > 0) {
    return fail('MANIFEST_MALFORMED', violations.join('; '));
  }

  // ---- Phase 3: root hash -----------------------------------------------
  let canonicalManifest: string;
  try {
    canonicalManifest = canonicalJson(manifest);
  } catch (error) {
    return fail('MANIFEST_MALFORMED', `manifest is not canonical-JSON serializable: ${errorMessage(error)}`);
  }
  const actualRoot = await sha256Hex(canonicalManifest);
  if (actualRoot !== rootHash) {
    return fail(
      'ROOT_HASH_MISMATCH',
      `manifest hashes to ${actualRoot} but bundle.rootHash claims ${rootHash}`,
    );
  }

  // ---- Phase 4: run identity vs store ------------------------------------
  let storeMeta: RunMeta | null;
  try {
    storeMeta = await stores.runStore.getRun(manifest.run.id);
  } catch (error) {
    return fail('RUN_META_MISMATCH', `run store threw while loading run ${manifest.run.id}: ${errorMessage(error)}`);
  }
  if (storeMeta === null) {
    return fail('RUN_META_MISMATCH', `run ${manifest.run.id} is unknown to the run store`);
  }
  // status/endedAt are mutable by design (RunStore.updateStatus) — compare
  // only the immutable identity fields.
  let manifestIdentity: string;
  let storeIdentity: string;
  try {
    manifestIdentity = canonicalJson(runIdentity(manifest.run));
    storeIdentity = canonicalJson(runIdentity(storeMeta));
  } catch (error) {
    return fail(
      'RUN_META_MISMATCH',
      `run identity could not be canonicalized: ${errorMessage(error)}`,
    );
  }
  if (manifestIdentity !== storeIdentity) {
    return fail(
      'RUN_META_MISMATCH',
      `immutable run identity differs between manifest and store (status/endedAt excluded by design): manifest ${manifestIdentity} vs store ${storeIdentity}`,
    );
  }

  // ---- Phase 5: event stream ordering (manifest, then store) -------------
  const streamResult = checkEventStream(manifest.events, manifest.run.id, 'manifest');
  if (streamResult !== null) return streamResult;

  let storeEvents: RunEvent[];
  try {
    storeEvents = await stores.runStore.listEvents(manifest.run.id);
  } catch (error) {
    return fail(
      'EVENT_SEQ_INVALID',
      `run store threw while listing events for run ${manifest.run.id}: ${errorMessage(error)}`,
    );
  }
  const storeStreamResult = checkEventStream(storeEvents, manifest.run.id, 'store');
  if (storeStreamResult !== null) return storeStreamResult;

  // ---- Phase 6: manifest events ⊆ store events, verbatim -----------------
  const storeEventBySeq = new Map<number, RunEvent>();
  for (const event of storeEvents) storeEventBySeq.set(event.seq, event);

  for (const event of manifest.events) {
    const observed = storeEventBySeq.get(event.seq);
    if (observed === undefined) {
      return fail(
        'EVENT_MISSING',
        `event seq ${event.seq} (${event.kind}) from the manifest is absent from the store's event log for run ${manifest.run.id}`,
      );
    }
    let manifestEvent: string;
    let storeEvent: string;
    try {
      manifestEvent = canonicalJson(event);
      storeEvent = canonicalJson(observed);
    } catch (error) {
      return fail(
        'EVENT_MISSING',
        `event seq ${event.seq} could not be canonicalized for verbatim comparison: ${errorMessage(error)}`,
      );
    }
    if (manifestEvent !== storeEvent) {
      return fail(
        'EVENT_MISSING',
        `event seq ${event.seq} differs between manifest and store: manifest has (${event.kind} @ ${event.ts}), store has (${observed.kind} @ ${observed.ts})`,
      );
    }
  }

  // ---- Phase 7: every artifact (manifest order) ---------------------------
  for (const record of manifest.artifacts) {
    let storeRecord: ArtifactRecord | null;
    try {
      storeRecord = await stores.artifactStore.get(record.id);
    } catch (error) {
      return fail(
        'ARTIFACT_MISSING',
        `artifact store threw while loading artifact ${record.id}: ${errorMessage(error)}`,
      );
    }
    if (storeRecord === null) {
      return fail(
        'ARTIFACT_MISSING',
        `artifact ${record.id} (kind ${record.kind}) is unknown to the artifact store`,
      );
    }

    let manifestRecord: string;
    let observedRecord: string;
    try {
      manifestRecord = canonicalJson(record);
      observedRecord = canonicalJson(storeRecord);
    } catch (error) {
      return fail(
        'MANIFEST_HASH_MISMATCH',
        `artifact ${record.id} could not be canonicalized for record comparison: ${errorMessage(error)}`,
      );
    }
    if (manifestRecord !== observedRecord) {
      return fail(
        'MANIFEST_HASH_MISMATCH',
        `manifest record for artifact ${record.id} disagrees with the store's record: manifest ${manifestRecord} vs store ${observedRecord}`,
      );
    }

    let bytes: Uint8Array | null;
    try {
      bytes = await stores.artifactStore.readBytes(record.id);
    } catch (error) {
      const message = errorMessage(error);
      // The frozen store surface signals blob absence by throwing (only a
      // missing RECORD returns null), so we map by the store's own wording.
      // Documented limitation — see README "Known limitations".
      if (/is missing/i.test(message)) {
        return fail('ARTIFACT_MISSING', `blob for artifact ${record.id}: ${message}`);
      }
      return fail(
        'ARTIFACT_HASH_MISMATCH',
        `artifact store refused to serve bytes for ${record.id}: ${message}`,
      );
    }
    if (bytes === null) {
      return fail('ARTIFACT_MISSING', `bytes for artifact ${record.id} could not be read from the store`);
    }
    const actual = await sha256Hex(bytes);
    if (actual !== record.sha256) {
      return fail(
        'ARTIFACT_HASH_MISMATCH',
        `artifact ${record.id} bytes hash to ${actual} but the record claims ${record.sha256}`,
      );
    }
    if (bytes.byteLength !== record.sizeBytes) {
      return fail(
        'ARTIFACT_HASH_MISMATCH',
        `artifact ${record.id} has ${bytes.byteLength} bytes but the record claims ${record.sizeBytes}`,
      );
    }
  }

  // ---- Phase 8: evidence refs ----------------------------------------------
  // Every ref must be carried by a manifest event (verbatim) and point at
  // a manifest artifact holding its sha256 with the expected artifact kind.
  const eventRefForms = new Set<string>();
  for (const event of manifest.events) {
    for (const ref of event.evidenceRefs ?? []) eventRefForms.add(canonicalJson(ref));
  }
  const artifactKindsBySha = new Map<string, Set<ArtifactKind>>();
  for (const record of manifest.artifacts) {
    const kinds = artifactKindsBySha.get(record.sha256) ?? new Set<ArtifactKind>();
    kinds.add(record.kind);
    artifactKindsBySha.set(record.sha256, kinds);
  }

  for (const ref of manifest.evidence) {
    if (!eventRefForms.has(canonicalJson(ref))) {
      return fail(
        'REF_UNKNOWN',
        `evidence ${ref.evidenceId} (kind ${ref.kind}) is not carried by any event in the manifest`,
      );
    }
    const kindsWithSha = artifactKindsBySha.get(ref.sha256);
    if (kindsWithSha === undefined) {
      return fail(
        'REF_UNKNOWN',
        `evidence ${ref.evidenceId} references sha256 ${ref.sha256} which no artifact in the manifest carries`,
      );
    }
    const expectedKind = artifactKindForEvidence(ref.kind);
    if (!kindsWithSha.has(expectedKind)) {
      return fail(
        'REF_KIND_MISMATCH',
        `evidence ${ref.evidenceId} (kind ${ref.kind}) expects an artifact of kind ${expectedKind}, but the artifacts carrying sha256 ${ref.sha256} have kinds ${[...kindsWithSha].join('|')}`,
      );
    }
  }

  return {
    ok: true,
    rootHash,
    eventCount: manifest.events.length,
    evidenceCount: manifest.evidence.length,
    artifactCount: manifest.artifacts.length,
  };
}

function runIdentity(meta: RunMeta): Record<string, unknown> {
  return {
    id: meta.id,
    targetId: meta.targetId,
    kind: meta.kind,
    startedAt: meta.startedAt,
    environment: meta.environment,
    ...(meta.budget !== undefined ? { budget: meta.budget } : {}),
  };
}

/**
 * Seq/ownership rules for one event stream: first event seq 0, strictly
 * increasing after, every event owned by the run. Mirrors the rules
 * @clapp/core's assertMonotonicSeq enforces at append time — re-checked here
 * because neither store re-validates ordering on READ (a tampered fs log
 * parses back just fine), and the manifest may be hand-built.
 */
function checkEventStream(events: readonly RunEvent[], runId: string, source: string): VerifyResult | null {
  let previous: RunEvent | undefined;
  for (const [index, event] of events.entries()) {
    if (event.runId !== runId) {
      return fail(
        'EVENT_SEQ_INVALID',
        `${source} event at index ${index} has runId ${event.runId} but belongs to run ${runId} (foreign event in the stream)`,
      );
    }
    if (index === 0 && event.seq !== 0) {
      return fail(
        'EVENT_SEQ_INVALID',
        `first ${source} event must have seq 0, observed seq ${event.seq}`,
      );
    }
    if (previous !== undefined && event.seq <= previous.seq) {
      return fail(
        'EVENT_SEQ_INVALID',
        `non-increasing seq in ${source} stream for run ${runId}: ${previous.seq} -> ${event.seq}`,
      );
    }
    previous = event;
  }
  return null;
}
