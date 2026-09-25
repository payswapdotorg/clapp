/**
 * EvidenceBundle — the tamper-evident manifest of a run's evidence.
 *
 * A bundle is `{ manifest, rootHash }` where `rootHash` is the sha256 of the
 * canonical JSON serialization of the manifest. The manifest is a complete,
 * deterministic snapshot of the run at build time:
 *
 * - `run` — the RunMeta (status/endedAt as of build; both are mutable by
 *   design and excluded from verify's run-identity comparison).
 * - `events` — the full append-only event stream in seq order.
 * - `evidence` — every EvidenceRef carried by any event, in event order,
 *   deduplicated by evidenceId (first occurrence wins).
 * - `artifacts` — every artifact record in the run, insertion order.
 *
 * Determinism: buildBundle is a pure function of the LoadedRun — no build
 * timestamp, no randomness — so rebuilding an unchanged run yields the
 * identical rootHash. The manifest object handed back is the JSON.parse of
 * its own canonical serialization (detached from the caller's objects and
 * with keys materialized in canonical order), so later caller-side mutation
 * of the LoadedRun cannot silently de-sync manifest from rootHash.
 */

import { assertMonotonicSeq, sha256Hex, validateRunEvent } from '@clapp/core';
import type { ArtifactRecord, EvidenceRef, RunEvent, RunId, RunMeta } from '@clapp/core';
import type { LoadedRun } from '@clapp/store';
import { canonicalJson } from './canonical-json';
import { errorMessage } from './inspect';
import { artifactRecordViolations, runMetaViolations } from './manifest-shape';
import type { RecordingStores } from './recording-session';

/** Manifest schema version — bump on any manifest shape change (ADR required). */
export const MANIFEST_SCHEMA_VERSION = 1;

/** The sealed manifest of a run's evidence (see module doc). */
export interface EvidenceManifest {
  schemaVersion: number;
  run: RunMeta;
  /** seq order; the exact event stream as of build time. */
  events: RunEvent[];
  /** event order, deduplicated by evidenceId. */
  evidence: EvidenceRef[];
  /** insertion order; every artifact in the run. */
  artifacts: ArtifactRecord[];
}

/** A sealed bundle: the manifest plus its root hash. */
export interface EvidenceBundle {
  manifest: EvidenceManifest;
  /** sha256 (lowercase hex) over canonicalJson(manifest). */
  rootHash: string;
}

/**
 * Build the evidence bundle for a loaded run.
 *
 * Honest preconditions — a run that violates any of these throws (this is a
 * builder, not a verifier; tamper detection with machine-readable codes is
 * `verify`'s job): every event and artifact conforms to the core contract
 * and belongs to `run.meta.id`, and the event stream is seq-monotonic.
 */
export async function buildBundle(run: LoadedRun): Promise<EvidenceBundle> {
  const metaViolations = runMetaViolations(run.meta);
  if (metaViolations.length > 0) {
    throw new Error(`buildBundle: run meta violates the contract: ${metaViolations.join('; ')}`);
  }

  for (const [index, event] of run.events.entries()) {
    const violations = validateRunEvent(event);
    if (violations.length > 0) {
      throw new Error(`buildBundle: events[${index}] violates the contract: ${violations.join('; ')}`);
    }
    if (event.runId !== run.meta.id) {
      throw new Error(
        `buildBundle: events[${index}].runId ${event.runId} does not belong to run ${run.meta.id}`,
      );
    }
  }
  try {
    assertMonotonicSeq(run.events);
  } catch (error) {
    throw new Error(`buildBundle: ${errorMessage(error)}`);
  }
  // assertMonotonicSeq tolerates gaps and does not pin the first seq — the
  // store append contract does (first event of a run is seq 0). Manifests
  // must not start mid-stream: verify() would report EVENT_SEQ_INVALID.
  if (run.events.length > 0 && run.events[0]!.seq !== 0) {
    throw new Error(`buildBundle: first event of run ${run.meta.id} must have seq 0, observed seq ${run.events[0]!.seq}`);
  }

  for (const [index, record] of run.artifacts.entries()) {
    const violations = artifactRecordViolations(record);
    if (violations.length > 0) {
      throw new Error(`buildBundle: artifacts[${index}] violates the contract: ${violations.join('; ')}`);
    }
    if (record.runId !== run.meta.id) {
      throw new Error(
        `buildBundle: artifacts[${index}].runId ${record.runId} does not belong to run ${run.meta.id}`,
      );
    }
  }

  const raw: EvidenceManifest = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    run: run.meta,
    events: run.events,
    evidence: collectEvidenceRefs(run.events),
    artifacts: run.artifacts,
  };

  let canonical: string;
  try {
    canonical = canonicalJson(raw);
  } catch (error) {
    throw new Error(
      `buildBundle: run data is not canonical-JSON serializable (${errorMessage(error)}); ` +
        'the manifest cannot be sealed — see canonical-json.ts for the accepted value shapes',
    );
  }
  const manifest = JSON.parse(canonical) as EvidenceManifest;
  const rootHash = await sha256Hex(canonical);
  return { manifest, rootHash };
}

/**
 * Load a whole run from any store pair — the store-agnostic replay entry
 * point (the fs-only equivalent is @clapp/store's `loadRun`). Returns null
 * when the run does not exist.
 */
export async function loadRunFromStores(stores: RecordingStores, runId: RunId): Promise<LoadedRun | null> {
  const meta = await stores.runStore.getRun(runId);
  if (meta === null) return null;
  const events = await stores.runStore.listEvents(runId);
  const artifacts = await stores.artifactStore.list(runId);
  return { meta, events, artifacts };
}

/** Every ref carried by any event, event order, deduplicated by evidenceId. */
function collectEvidenceRefs(events: readonly RunEvent[]): EvidenceRef[] {
  const seenEvidenceIds = new Map<string, string>();
  const out: EvidenceRef[] = [];
  for (const event of events) {
    for (const ref of event.evidenceRefs ?? []) {
      const known = seenEvidenceIds.get(ref.evidenceId);
      if (known !== undefined) {
        // Same evidenceId twice with DIFFERENT content is a provenance
        // violation upstream — fail honestly instead of silently keeping one.
        if (known !== canonicalJson(ref)) {
          throw new Error(
            `buildBundle: evidenceId ${ref.evidenceId} appears twice with different content in the event stream`,
          );
        }
        continue;
      }
      seenEvidenceIds.set(ref.evidenceId, canonicalJson(ref));
      out.push(ref);
    }
  }
  return out;
}
