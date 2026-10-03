/**
 * @clapp/linux — public API (CLAPP-081, the P8 second platform).
 *
 * The Linux lane — second of the five platforms per docs/WORK_ITEMS.md
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
 * (test/linux.test.ts) pins all of this.
 *
 * The host seams (LinuxObservationHost, LinuxVerificationHost) are
 * duck-typed: everything environment-specific enters through them, the
 * tests fake them, and real X11/Wayland/AT-SPI-over-D-Bus bindings are
 * deployment scope — the CONTRACTS are this lane's deliverable.
 *
 * Sibling packages must import `@clapp/linux` and never reach into
 * deeper paths. Windows/macOS/iOS are later lanes.
 */

// ---- the environment descriptor (component 1) ---------------------------------------
export {
  LINUX_ACCESSIBILITY_BUSES,
  LINUX_DISPLAY_SERVERS,
  LINUX_ENVIRONMENT_VERSION,
  validateLinuxEnvironment,
} from './environment';
export type { LinuxEnvironment, LinuxEnvironmentValidation } from './environment';

// ---- the observation adapter — the host seam (component 2) ---------------------------
export { observeLinuxScreen } from './observation';
export type {
  LinuxObservation,
  LinuxObservationHost,
  LinuxObservationResult,
  LinuxViewNode,
} from './observation';

// ---- the evidence emitter (component 3) ----------------------------------------------
export { emitObservationEvidence } from './evidence';
export type { ObservationEvidenceResult } from './evidence';

// ---- the synthesis target (component 4) ------------------------------------------------
export {
  LINUX_PACKAGING_FORMATS,
  LINUX_TARGET_VERSION,
  validateLinuxSynthesisTarget,
} from './synthesis-target';
export type { LinuxSynthesisTarget, LinuxSynthesisTargetValidation } from './synthesis-target';

// ---- the verification adapter — the host seam (component 5) ----------------------------
export { verifyLinuxJourneys } from './verification';
export type {
  LinuxVerificationHost,
  LinuxVerificationResult,
  LinuxVerificationRun,
} from './verification';
