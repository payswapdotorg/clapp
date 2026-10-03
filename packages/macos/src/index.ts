/**
 * @clapp/macos — public API (CLAPP-083, the P8 fourth platform).
 *
 * The macOS lane — fourth of the five platforms per docs/WORK_ITEMS.md
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
 * (test/macos.test.ts) pins all of this.
 *
 * The host seams (MacOSObservationHost, MacOSVerificationHost) are
 * duck-typed: everything environment-specific enters through them, the
 * tests fake them, and real macOS Accessibility API (AX) / AppKit /
 * Quartz bindings are deployment scope — the CONTRACTS are this lane's
 * deliverable.
 *
 * Sibling packages must import `@clapp/macos` and never reach into
 * deeper paths. iOS is a later lane.
 */

// ---- the environment descriptor (component 1) ---------------------------------------
export {
  MACOS_ACCESSIBILITY_FRAMEWORKS,
  MACOS_ENVIRONMENT_VERSION,
  validateMacOSEnvironment,
} from './environment';
export type { MacOSEnvironment, MacOSEnvironmentValidation } from './environment';

// ---- the observation adapter — the host seam (component 2) ---------------------------
export { observeMacOSScreen } from './observation';
export type {
  MacOSObservation,
  MacOSObservationHost,
  MacOSObservationResult,
  MacOSViewNode,
} from './observation';

// ---- the evidence emitter (component 3) ----------------------------------------------
export { emitObservationEvidence } from './evidence';
export type { ObservationEvidenceResult } from './evidence';

// ---- the synthesis target (component 4) ------------------------------------------------
export {
  MACOS_PACKAGING_FORMATS,
  MACOS_TARGET_VERSION,
  validateMacOSSynthesisTarget,
} from './synthesis-target';
export type { MacOSSynthesisTarget, MacOSSynthesisTargetValidation } from './synthesis-target';

// ---- the verification adapter — the host seam (component 5) ----------------------------
export { verifyMacOSJourneys } from './verification';
export type {
  MacOSVerificationHost,
  MacOSVerificationResult,
  MacOSVerificationRun,
} from './verification';
