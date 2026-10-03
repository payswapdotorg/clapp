/**
 * @clapp/android — public API (CLAPP-080, the P8 opener).
 *
 * The Android lane — first of the five platforms per docs/WORK_ITEMS.md
 * P8 ("Sequence: Android → Linux → Windows → macOS → iOS") — the five
 * platform components that lane demands, as v0.1 contracts:
 *   1. the environment descriptor  (src/environment.ts)
 *   2. the observation adapter     (src/observation.ts — the host seam)
 *   3. the evidence emitter        (src/evidence.ts)
 *   4. the synthesis target        (src/synthesis-target.ts)
 *   5. the verification adapter    (src/verification.ts — the host seam)
 *
 * THE NO-FORK LAW (P8, binding): this package CONSUMES the frozen
 * contracts and produces contract-shaped DATA — it never redefines,
 * rewrites, or forks any IR/contract type. The runtime dependencies are
 * exactly @clapp/core (sha256Hex; EVIDENCE_KINDS — the core's own
 * frozen vocabulary mirror, one source of truth) and @clapp/observe
 * (canonicalJson); the @clapp/diff / @clapp/ir / @clapp/journey
 * vocabularies are consumed through THEIR machinery, TYPE-ONLY (the
 * verification run feeds the diff lane's PairedRun/DiffReport through
 * the existing machinery — this adapter never constructs a DiffReport;
 * the journey ids are the journey lane's vocabulary, run through the
 * host seam, never redefined). The import-discipline test
 * (test/android.test.ts) pins all of this.
 *
 * The host seams (AndroidObservationHost, AndroidVerificationHost) are
 * duck-typed: everything environment-specific enters through them, the
 * tests fake them, and real adb/uiautomator/emulator bindings are
 * deployment scope — the CONTRACTS are this lane's deliverable.
 *
 * Sibling packages must import `@clapp/android` and never reach into
 * deeper paths. Linux/Windows/macOS/iOS are later lanes.
 */

// ---- the environment descriptor (component 1) ---------------------------------------
export { ANDROID_ENVIRONMENT_VERSION, ANDROID_PERMISSIONS, validateAndroidEnvironment } from './environment';
export type { AndroidEnvironment, AndroidEnvironmentValidation } from './environment';

// ---- the observation adapter — the host seam (component 2) ---------------------------
export { observeAndroidScreen } from './observation';
export type {
  AndroidObservation,
  AndroidObservationHost,
  AndroidObservationResult,
  AndroidViewNode,
} from './observation';

// ---- the evidence emitter (component 3) ----------------------------------------------
export { emitObservationEvidence } from './evidence';
export type { ObservationEvidenceResult } from './evidence';

// ---- the synthesis target (component 4) ------------------------------------------------
export { ANDROID_DENSITIES, ANDROID_TARGET_VERSION, validateAndroidSynthesisTarget } from './synthesis-target';
export type { AndroidSynthesisTarget, AndroidSynthesisTargetValidation } from './synthesis-target';

// ---- the verification adapter — the host seam (component 5) ----------------------------
export { verifyAndroidJourneys } from './verification';
export type {
  AndroidVerificationHost,
  AndroidVerificationResult,
  AndroidVerificationRun,
} from './verification';
