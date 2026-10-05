/**
 * @clapp/factory — the human release gate (CLAPP-089, the P9 fifth and
 * final lane — Worker 1, Observation and Platform Adapters, per
 * docs/WORKER_HANDOFFS.md; the factory lane's owner).
 *
 * docs/WORK_ITEMS.md P9: "The factory turns a build request into a
 * classified target, explores within adaptive budgets, synthesizes the
 * package graph, repairs multi-pass, and holds the release for the human
 * gate." THIS module is the factory's FIFTH and FINAL component (the
 * ROADMAP's last line, "human release gate"): the honesty seam between
 * the autonomous factory and the human — the gate that holds every
 * release until a CALLER-PRESENTED verdict seals it.
 *
 * THE GATE LAW (frozen v0.1 — five iron laws):
 * 1. NEVER FABRICATE APPROVAL. A verdict is CALLER-PRESENTED data only.
 *    The module records verdicts; it never derives, defaults, infers, or
 *    synthesizes one. No path through the module can produce a verdict
 *    that did not arrive as an argument. (By the same law the module
 *    never fabricates REFUSAL either: a never-converged schedule does
 *    not block a release — only the verdict decides, and the schedule's
 *    measured facts are carried verbatim for the human's own judgment.)
 * 2. THE VERDICT VOCABULARY IS FROZEN TO TWO VALUES: 'approved' and
 *    'rejected'. 'pending' is a STATE (the gate is open, no verdict yet),
 *    never a verdict. Anything outside the two-value vocabulary is a
 *    named error at the seam — BEFORE any state change.
 * 3. ONE GATE, ONE VERDICT. The second applyVerdict on a gate that
 *    already holds a sealed verdict is a named error. The first verdict
 *    is permanent — there is no re-vote, no overwrite, no appeal.
 * 4. PENDING AND REJECTED NEVER RELEASE. releaseFromGate returns
 *    { ok: true, ... } ONLY for a sealed+approved gate. For pending and
 *    rejected it returns { ok: false, errors: [...] } — honest DATA,
 *    never a thrown exception (the caller must be able to branch on
 *    refusal).
 * 5. 'rgate_' ids are content-addressed: 'rgate_' +
 *    sha256Hex(canonicalJson(body minus id minus gatedAt)). The gatedAt
 *    timestamp is EXCLUDED from the minting body (the determinism law:
 *    same gate content, same id, regardless of when it was opened),
 *    while the SEALED VERDICT is INSIDE the body (a different verdict is
 *    a different gate identity). Id shape: 'rgate_' + 64 lowercase hex
 *    chars.
 *
 * THE BINDING (consumed, never forked): the CLAPP-088 MultiPassSchedule
 * — this package's own ./multi-pass-repair output — enters as DATA
 * across the module boundary, duck-validated field by field on exactly
 * the fields this lane consumes (multiPassVersion, id, budgetTier,
 * converged, classificationId, and totalRounds — the schedule's own
 * MEASURED pass count, carried verbatim as the gate's passCount), with
 * a named error for every malformation. The mpass_ id passes through
 * VERBATIM as the gate and release records' scheduleId, and the tcls_
 * classificationId VERBATIM beside it — the provenance chain
 * (tcls_ classificationId + mpass_ scheduleId) appears verbatim in both
 * records. The gate does NOT re-derive convergence, does NOT re-run the
 * scheduler, and does NOT import the repair lane (the no-fork law: the
 * schedule is frozen data on arrival) — its own module,
 * ./multi-pass-repair, is never imported here either, not even
 * type-only: the schedule's contract version is duck-validated against
 * the frozen literal '0.1' (MULTI_PASS_REPAIR_VERSION), named in the
 * error, never imported; the frozen tier vocabulary comes from
 * ./target-classification (the entry contract) as the one in-package
 * binding this lane needs.
 *
 * THE LAWS (the 060–088 house discipline, binding):
 * - Fail closed: gate errors are collected — ALL of them, each naming
 *   its field and carrying the OBSERVED VALUE — into { ok: false,
 *   errors }; results, never exceptions; nothing is opened, sealed, or
 *   released from partial data. Every seam (open, seal, release)
 *   re-validates exactly the fields it reads — the records are DATA at
 *   every boundary, never trusted provenance.
 * - Carried verbatim, never re-derived: the gate's passCount is the
 *   schedule's own totalRounds, its converged the schedule's own honest
 *   flag — copied by value at gate open, never recomputed, never
 *   re-inferred, never blocked on. The verdict is the ONLY decision
 *   input, and it is the caller's.
 * - Determinism: no clock (gatedAt and releasedAt are CALLER-injected),
 *   no randomness, no network, no filesystem. The gate id is
 *   content-addressed — 'rgate_' + sha256Hex(canonicalJson(gate minus
 *   id minus gatedAt)) — so opening the same schedule twice yields
 *   deep-equal gates with identical ids, and a different caller clock
 *   never changes the id (the 085 tcls_ / 087 pgraph_ / 088 mpass_
 *   discipline). Sealing re-mints the id with the verdict INSIDE the
 *   body (law 5): the sealed identity differs from the pending one, and
 *   a different verdict is a different gate identity. The 'rgate_'
 *   prefix is a DISTINCT identity in the repo's tcls_/pgraph_/
 *   cgraph_/comp_/repd_/mpass_ prefix discipline — the other lanes' ids
 *   are their own, never re-used here.
 * - The facts are carried by value (a fresh flat copy — the sealed-
 *   record law): the caller's schedule object is never aliased into the
 *   gate, and a caller that mutates its schedule after opening never
 *   rewrites the gate's record.
 */

import { sha256Hex } from '@clapp/core';
import { canonicalJson } from '@clapp/observe';

import { BUDGET_TIERS } from './target-classification';

// ---- internal shared helpers (module-level; NOT re-exported by src/index.ts) ------

/** Plain-object guard (arrays are NOT objects here — the house helper). */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Human preview of an unknown value, for error messages. */
function preview(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'undefined') return 'undefined';
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/** Renders a frozen vocabulary for an error message (the preview discipline). */
function vocabulary(words: readonly string[]): string {
  return `[${words.map((word) => `'${word}'`).join(', ')}]`;
}

/** A non-negative-integer guard (MEASURED pass counts are never negative or fractional). */
function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/**
 * Own-vocabulary membership in the frozen budget tiers (the entry
 * contract's tags — the tiers the CLAPP-088 pass-cap table spends; a
 * schedule claiming a tier outside them is not a well-formed 088
 * schedule).
 */
function isKnownTier(tier: unknown): tier is string {
  return typeof tier === 'string' && BUDGET_TIERS.includes(tier);
}

/**
 * The frozen CLAPP-088 schedule contract version this gate binds — '0.1'
 * (MULTI_PASS_REPAIR_VERSION in ./multi-pass-repair.ts). PINNED as a
 * literal here ON PURPOSE (the no-fork law): the schedule arrives as
 * DATA across the module boundary, so its contract version is
 * duck-validated against the frozen literal, named in the error
 * message, never imported from the schedule's own module.
 */
const MULTI_PASS_SCHEDULE_VERSION = '0.1';

/**
 * The CLAPP-088 schedule-id prefix — the provenance chain's
 * traceability pin: a schedule id that is not 'mpass_'-prefixed is not
 * traceable to the 088 lane and never opens a gate.
 */
const MPASS_ID_PREFIX = 'mpass_';

/**
 * The gate-id prefix — THIS lane's frozen identity in the `tcls_` /
 * `pgraph_` / `cgraph_` / `comp_` / `repd_` / `mpass_` prefix
 * discipline: `rgate_` + 64 lowercase hex chars. Changing it changes
 * every minted id and requires a contract version bump.
 */
const RELEASE_GATE_ID_PREFIX = 'rgate_';

/**
 * Duck-validates the carried fields of a caller-presented gate record
 * (the record crossed back through the caller — it is DATA at this seam
 * too), each malformation named, and returns the admitted field values
 * for the seal/release records. The gate's state/verdict fields are the
 * CALLER's laws (the one-verdict law, the refusal-or-release seam) and
 * are checked by the callers, not here.
 */
function admitGateCarriedFields(
  gate: Record<string, unknown>,
  errors: string[],
): {
  classificationId: string;
  scheduleId: string;
  budgetTier: string;
  passCount: number;
  converged: boolean;
  gatedAt: string;
} | null {
  let admitted = true;

  // ---- releaseGateVersion: this gate's own frozen contract ----
  const releaseGateVersion = gate['releaseGateVersion'];
  if (releaseGateVersion !== RELEASE_GATE_VERSION) {
    errors.push(
      `gate.releaseGateVersion: expected '0.1' (RELEASE_GATE_VERSION — this gate's own frozen contract; the caller-presented record must bind it), got ${preview(releaseGateVersion)}`,
    );
    admitted = false;
  }

  // ---- classificationId: the tcls_ provenance, a non-empty string ----
  const classificationId = gate['classificationId'];
  if (typeof classificationId !== 'string' || classificationId.length === 0) {
    errors.push(
      `gate.classificationId: expected a non-empty string (the source classification's tcls_ identity — carried verbatim as the provenance binding), got ${preview(classificationId)}`,
    );
    admitted = false;
  }

  // ---- scheduleId: the mpass_ provenance (the chain stays traceable to the 088 lane) ----
  const scheduleId = gate['scheduleId'];
  if (typeof scheduleId !== 'string' || scheduleId.length === 0 || !scheduleId.startsWith(MPASS_ID_PREFIX)) {
    errors.push(
      `gate.scheduleId: expected an 'mpass_'-prefixed non-empty string (the CLAPP-088 schedule's content-addressed identity — carried verbatim; the provenance chain must stay traceable to the 088 lane), got ${preview(scheduleId)}`,
    );
    admitted = false;
  }

  // ---- budgetTier: one of the frozen tiers ----
  const budgetTier = gate['budgetTier'];
  if (!isKnownTier(budgetTier)) {
    errors.push(
      `gate.budgetTier: expected a string from the frozen budget tiers ${vocabulary(BUDGET_TIERS)} (the tier the bound schedule's pass cap governed), got ${preview(budgetTier)}`,
    );
    admitted = false;
  }

  // ---- passCount: the schedule's MEASURED totalRounds, a non-negative integer ----
  const passCount = gate['passCount'];
  if (!isNonNegativeInteger(passCount)) {
    errors.push(
      `gate.passCount: expected a non-negative integer (the bound schedule's MEASURED totalRounds, carried verbatim — never re-derived here), got ${preview(passCount)}`,
    );
    admitted = false;
  }

  // ---- converged: the schedule's own honest flag, a boolean ----
  const converged = gate['converged'];
  if (typeof converged !== 'boolean') {
    errors.push(
      `gate.converged: expected a boolean (the bound schedule's own honest convergence flag, carried verbatim — never re-derived here), got ${preview(converged)}`,
    );
    admitted = false;
  }

  // ---- gatedAt: the caller-injected clock the sealed record still carries ----
  const gatedAt = gate['gatedAt'];
  if (typeof gatedAt !== 'string' || gatedAt.length === 0) {
    errors.push(
      `gate.gatedAt: expected a non-empty string (caller-injected at gate open — the gate never reads a clock), got ${preview(gatedAt)}`,
    );
    admitted = false;
  }

  // ---- fail closed: no admitted body unless every field admitted ----
  if (
    !admitted ||
    typeof classificationId !== 'string' ||
    classificationId.length === 0 ||
    typeof scheduleId !== 'string' ||
    scheduleId.length === 0 ||
    !scheduleId.startsWith(MPASS_ID_PREFIX) ||
    !isKnownTier(budgetTier) ||
    !isNonNegativeInteger(passCount) ||
    typeof converged !== 'boolean' ||
    typeof gatedAt !== 'string' ||
    gatedAt.length === 0
  ) {
    return null;
  }
  return { classificationId, scheduleId, budgetTier, passCount, converged, gatedAt };
}

// ---- the human release gate contract v0.1 --------------------------------------------

/** The release gate's contract version (bumps only via a tech-lead declaration wave). */
export const RELEASE_GATE_VERSION = '0.1';

/**
 * The frozen verdict vocabulary — EXACTLY two values (the gate law 2).
 * 'pending' is a STATE ( {@link GateState} ), never a verdict: a verdict
 * exists on a gate ONLY as the sealed, CALLER-PRESENTED argument that
 * applyVerdict recorded.
 */
export type GateVerdict = 'approved' | 'rejected';

/**
 * The gate's own state vocabulary: 'pending' (the gate is open, no
 * verdict yet) or 'sealed' (the one verdict is held). 'pending' is a
 * STATE, never a verdict.
 */
export type GateState = 'pending' | 'sealed';

/** The human release gate — the honesty seam's own record. */
export interface ReleaseGate {
  /** RELEASE_GATE_VERSION ('0.1'). */
  releaseGateVersion: string;
  /**
   * Content-addressed: 'rgate_' + sha256Hex(canonicalJson(gate minus id
   * minus gatedAt)) — deterministic, no uuid, no clock. Excluding
   * gatedAt means a different caller clock never changes the id; the
   * SEALED VERDICT is inside the minting body (a different verdict is a
   * different gate identity), so sealing re-mints the id.
   */
  id: string;
  /** The source classification's id, carried VERBATIM (the tcls_ provenance). */
  classificationId: string;
  /** The CLAPP-088 schedule's id, carried VERBATIM (the mpass_ provenance — the chain traceable to the 088 lane). */
  scheduleId: string;
  /** The tier the bound schedule's pass cap governed (carried verbatim). */
  budgetTier: string;
  /** The schedule's MEASURED totalRounds, carried VERBATIM (never re-derived here). */
  passCount: number;
  /** The schedule's own honest convergence flag, carried VERBATIM (never re-derived, never blocked on). */
  converged: boolean;
  /** 'pending' (open, no verdict yet) or 'sealed' (the one verdict is held). */
  state: GateState;
  /**
   * Present IFF state is 'sealed': the one CALLER-PRESENTED verdict that
   * applyVerdict recorded (the gate law 1 — the module never derives,
   * defaults, infers, or synthesizes one; there is no path to a verdict
   * that did not arrive as an argument).
   */
  verdict?: GateVerdict;
  /** RFC3339 — CALLER-injected at gate open; the gate never reads a clock. */
  gatedAt: string;
}

/** Fail-closed gate open/seal: a result, never an exception. */
export type ReleaseGateResult =
  | { ok: true; gate: ReleaseGate }
  | { ok: false; errors: string[] };

/**
 * The release record — what a sealed+approved gate releases. Carries the
 * full provenance chain (tcls_ classificationId + mpass_ scheduleId +
 * this gate's own rgate_ gateId) and the measured schedule facts
 * (passCount, converged) VERBATIM, plus the verdict that authorized the
 * release and the caller-injected release clock.
 */
export interface ReleaseRecord {
  /** RELEASE_GATE_VERSION ('0.1'). */
  releaseGateVersion: string;
  /** The sealed gate's own rgate_ id — the release traces to the gate that authorized it. */
  gateId: string;
  /** The source classification's id, carried VERBATIM (the tcls_ provenance). */
  classificationId: string;
  /** The CLAPP-088 schedule's id, carried VERBATIM (the mpass_ provenance — the chain traceable to the 088 lane). */
  scheduleId: string;
  /** The tier the bound schedule's pass cap governed (carried verbatim). */
  budgetTier: string;
  /** The schedule's MEASURED totalRounds, carried VERBATIM (never re-derived here). */
  passCount: number;
  /** The schedule's own honest convergence flag, carried VERBATIM (never re-derived here). */
  converged: boolean;
  /** Always 'approved' here — the only verdict that releases (the gate law 4). */
  verdict: 'approved';
  /** RFC3339 — CALLER-injected; the gate never reads a clock. */
  releasedAt: string;
}

/** Fail-closed refusal-or-release: a result, never an exception (the gate law 4). */
export type ReleaseResult =
  | { ok: true; release: ReleaseRecord }
  | { ok: false; errors: string[] };

// ---- the gate open -------------------------------------------------------------------

/**
 * Opens the human release gate over one CLAPP-088 multi-pass repair
 * schedule: duck-validates the schedule field by field (the schedule
 * crossed a module boundary — it is DATA here, never forked, never
 * re-run), mints the content-addressed rgate_ id, and returns the gate
 * in the PENDING state (a state, never a verdict — the opened gate
 * holds NO verdict key; no path through this module produces a verdict
 * that did not arrive as an applyVerdict argument). Async because the
 * gate id hashes (sha256Hex over the canonical gate body).
 *
 * Fail closed: a non-object schedule, a multiPassVersion other than
 * '0.1' (MULTI_PASS_REPAIR_VERSION — the frozen 088 schedule contract
 * this gate binds), an id that is not an 'mpass_'-prefixed non-empty
 * string (the provenance chain must be traceable to the 088 lane), a
 * budgetTier outside the frozen tiers (named with the observed value),
 * a non-boolean converged, an empty classificationId, a malformed
 * totalRounds (the MEASURED pass count the gate carries verbatim as its
 * passCount), or an empty gatedAt is a collected, field-named error
 * carrying the observed value — ALL errors, never just the first;
 * results, never exceptions; no gate is opened from partial data.
 * Extra schedule fields (passes, maxPasses, initialFindings,
 * scheduledAt, …) are the 088 lane's own business — the gate validates
 * exactly the fields it reads.
 *
 * On success the gate is carried, never derived: classificationId and
 * scheduleId (the tcls_ + mpass_ provenance chain), budgetTier,
 * passCount (the schedule's totalRounds), and converged are copied
 * VERBATIM by value (the sealed-record law — the caller's schedule
 * object is never aliased into the gate; convergence is never
 * re-derived, never blocked on). Deterministic: the same schedule +
 * caller timestamp produce a deep-equal gate with an identical id, and
 * a different caller clock never moves the id (gatedAt is excluded
 * from the minting body). The gate never mutates its inputs and
 * touches nothing but the schedule and timestamp given.
 */
export async function openReleaseGate(
  schedule: unknown,
  gatedAt: string,
): Promise<ReleaseGateResult> {
  const errors: string[] = [];

  // ---- caller-injected gate time — the gate never reads a clock ----
  if (typeof gatedAt !== 'string' || gatedAt.length === 0) {
    errors.push(
      `gatedAt: expected a non-empty string (caller-injected — the gate never reads a clock), got ${preview(gatedAt)}`,
    );
  }

  // ---- the schedule admission shape (a plain object) ----
  if (!isObject(schedule)) {
    errors.push(
      `schedule: expected an object (a resolved CLAPP-088 MultiPassSchedule: multiPassVersion, id, classificationId, budgetTier, converged, totalRounds), got ${preview(schedule)}`,
    );
    return { ok: false, errors };
  }

  // ---- multiPassVersion: the frozen 088 schedule contract this gate binds ----
  // (checked against the pinned literal — the no-fork law keeps the
  // schedule's own module unimported; the constant is NAMED in the
  // error, never imported.)
  const multiPassVersion = schedule['multiPassVersion'];
  if (multiPassVersion !== MULTI_PASS_SCHEDULE_VERSION) {
    errors.push(
      `schedule.multiPassVersion: expected '0.1' (MULTI_PASS_REPAIR_VERSION — the frozen CLAPP-088 schedule contract this gate consumes; a mismatch is a named error, never a guess), got ${preview(multiPassVersion)}`,
    );
  }

  // ---- id: the mpass_ provenance — the chain must be traceable to the 088 lane ----
  const scheduleId = schedule['id'];
  if (typeof scheduleId !== 'string' || scheduleId.length === 0 || !scheduleId.startsWith(MPASS_ID_PREFIX)) {
    errors.push(
      `schedule.id: expected an 'mpass_'-prefixed non-empty string (the CLAPP-088 schedule's content-addressed identity — the provenance chain must be traceable to the 088 lane; it passes VERBATIM as the gate and release records' scheduleId), got ${preview(scheduleId)}`,
    );
  }

  // ---- classificationId: the tcls_ provenance, a non-empty string ----
  const classificationId = schedule['classificationId'];
  if (typeof classificationId !== 'string' || classificationId.length === 0) {
    errors.push(
      `schedule.classificationId: expected a non-empty string (the source classification's tcls_ identity — carried verbatim as the provenance binding), got ${preview(classificationId)}`,
    );
  }

  // ---- budgetTier: one of the frozen tiers the 088 pass-cap table spends ----
  const budgetTier = schedule['budgetTier'];
  if (!isKnownTier(budgetTier)) {
    errors.push(
      `schedule.budgetTier: expected a string from the frozen budget tiers ${vocabulary(BUDGET_TIERS)} (the tiers CLAPP-085 tags and the 088 pass-cap table spends), got ${preview(budgetTier)}`,
    );
  }

  // ---- converged: the schedule's own honest flag, a boolean ----
  const converged = schedule['converged'];
  if (typeof converged !== 'boolean') {
    errors.push(
      `schedule.converged: expected a boolean (the schedule's own honest convergence flag — carried verbatim, never re-derived here), got ${preview(converged)}`,
    );
  }

  // ---- totalRounds: the MEASURED pass count the gate carries verbatim ----
  const totalRounds = schedule['totalRounds'];
  if (!isNonNegativeInteger(totalRounds)) {
    errors.push(
      `schedule.totalRounds: expected a non-negative integer (the schedule's MEASURED pass count — carried verbatim as the gate's passCount, never re-derived from the pass records), got ${preview(totalRounds)}`,
    );
  }

  // ---- fail closed: nothing opens unless every field admitted ----
  if (
    errors.length > 0 ||
    typeof scheduleId !== 'string' ||
    scheduleId.length === 0 ||
    !scheduleId.startsWith(MPASS_ID_PREFIX) ||
    typeof classificationId !== 'string' ||
    classificationId.length === 0 ||
    !isKnownTier(budgetTier) ||
    typeof converged !== 'boolean' ||
    !isNonNegativeInteger(totalRounds)
  ) {
    return { ok: false, errors };
  }

  // ---- the pending gate body (NO verdict key — 'pending' is a STATE, never a verdict) ----
  const gateBody: Omit<ReleaseGate, 'id' | 'gatedAt'> = {
    releaseGateVersion: RELEASE_GATE_VERSION,
    classificationId,
    scheduleId,
    budgetTier,
    passCount: totalRounds,
    converged,
    state: 'pending',
  };

  // ---- the content-addressed gate identity (the gate law 5) ----
  // The gate MINUS its id and gatedAt is the minting input (the
  // tcls_/pgraph_/mpass_ discipline with the clock excluded): same id
  // ⇔ identical canonical gate bytes — any carried change (the tier, the
  // provenance, the pass count, the convergence, the state) moves the
  // id, while a different caller clock never does. The pending body
  // holds NO verdict; the verdict enters the body ONLY when a caller
  // presents one and applyVerdict seals it (a different verdict is a
  // different gate identity).
  let canonical: string;
  try {
    canonical = canonicalJson(gateBody);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      errors: [
        `gate minting: the derived gate is not canonical-JSON serializable (${detail})`,
      ],
    };
  }
  const id = `${RELEASE_GATE_ID_PREFIX}${await sha256Hex(canonical)}`;

  return { ok: true, gate: { ...gateBody, id, gatedAt } };
}

// ---- the verdict seal ----------------------------------------------------------------

/**
 * Seals THE one verdict on a pending gate (the gate law 3): records the
 * CALLER-PRESENTED verdict — never derives, defaults, infers, or
 * synthesizes one (the gate law 1 — no path through this module can
 * produce a verdict that did not arrive as THIS argument) — and returns
 * the updated record: state 'sealed', the verdict held, and the id
 * RE-MINTED with the sealed verdict INSIDE the minting body (the gate
 * law 5 — a different verdict is a different gate identity; the sealed
 * id therefore differs from the pending id). Async because the id
 * hashes.
 *
 * Fail closed, before ANY state change (the gate law 2): a verdict
 * outside the frozen two-value vocabulary ('approved', 'rejected' —
 * 'pending' is a STATE, never a verdict) is a named error carrying the
 * observed value; a gate that already holds a sealed verdict is a named
 * error (one gate, one verdict — the first verdict is permanent: no
 * re-vote, no overwrite, no appeal), and the refusal collects BOTH
 * errors when both apply; a non-object gate, a state outside the gate's
 * own vocabulary, a pending gate holding a verdict key (the state and
 * the verdict MUST AGREE — a pending gate holds NO verdict), or a
 * malformed carried field is its own collected, field-named error. ALL
 * errors, never just the first; results, never exceptions; the caller's
 * gate record is never mutated — a refused seal leaves the presented
 * record exactly as it was, and the first VALID verdict still seals.
 */
export async function applyVerdict(
  gate: unknown,
  verdict: unknown,
): Promise<ReleaseGateResult> {
  const errors: string[] = [];

  // ---- the verdict: CALLER-PRESENTED data, validated BEFORE any state change (law 2) ----
  if (verdict !== 'approved' && verdict !== 'rejected') {
    errors.push(
      `verdict: expected 'approved' or 'rejected' (the frozen two-value verdict vocabulary — 'pending' is a STATE the open gate holds before any verdict, never a verdict; a verdict is CALLER-PRESENTED data, never derived, defaulted, inferred, or synthesized here), got ${preview(verdict)}`,
    );
  }

  // ---- the gate admission shape (the record the caller presents back) ----
  if (!isObject(gate)) {
    errors.push(
      `gate: expected an object (a ReleaseGate minted by openReleaseGate — the pending record, not yet sealed), got ${preview(gate)}`,
    );
    return { ok: false, errors };
  }

  // ---- the one-verdict law (law 3), checked BEFORE any state change ----
  const state = gate['state'];
  if (state === 'sealed') {
    errors.push(
      `gate: the verdict is already sealed (one gate, one verdict — the first verdict is permanent: no re-vote, no overwrite, no appeal), got a sealed gate holding ${preview(gate['verdict'])}`,
    );
  } else if (state !== 'pending') {
    errors.push(
      `gate.state: expected 'pending' or 'sealed' (the gate's own state vocabulary — 'pending' is a STATE, never a verdict), got ${preview(state)}`,
    );
  }

  // ---- the state/verdict agreement: a pending gate holds NO verdict ----
  if (state === 'pending' && Object.hasOwn(gate, 'verdict')) {
    errors.push(
      `gate.verdict: a pending gate holds no verdict ('pending' is a STATE, never a verdict — a verdict exists on a gate ONLY as the sealed, CALLER-PRESENTED one), got ${preview(gate['verdict'])}`,
    );
  }

  // ---- the carried fields (each named — the duck-validated record) ----
  const admitted = admitGateCarriedFields(gate, errors);

  // ---- fail closed: nothing is sealed unless the verdict AND the record admitted ----
  if (errors.length > 0 || (verdict !== 'approved' && verdict !== 'rejected') || admitted === null) {
    return { ok: false, errors };
  }

  // ---- the seal: the caller's verdict, recorded INSIDE the identity (law 5) ----
  const sealedBody: Omit<ReleaseGate, 'id' | 'gatedAt'> = {
    releaseGateVersion: RELEASE_GATE_VERSION,
    classificationId: admitted.classificationId,
    scheduleId: admitted.scheduleId,
    budgetTier: admitted.budgetTier,
    passCount: admitted.passCount,
    converged: admitted.converged,
    state: 'sealed',
    verdict,
  };

  // The same minting discipline as the open (the last line of defense
  // kept unconditional — the 085/088 precedent): the body is built from
  // validated primitives, so a canonicalization refusal cannot fire in
  // practice; a named error, never an escaped exception, if it ever did.
  let canonical: string;
  try {
    canonical = canonicalJson(sealedBody);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      errors: [
        `gate minting: the sealed gate is not canonical-JSON serializable (${detail})`,
      ],
    };
  }
  const id = `${RELEASE_GATE_ID_PREFIX}${await sha256Hex(canonical)}`;

  // The gatedAt clock is the record's own open clock, carried verbatim
  // (the gate never reads a clock; the seal adds no clock of its own).
  return { ok: true, gate: { ...sealedBody, id, gatedAt: admitted.gatedAt } };
}

// ---- the refusal-or-release seam ------------------------------------------------------

/**
 * The refusal-or-release seam (the gate law 4): releases a record ONLY
 * from a sealed+approved gate. For a pending gate (no verdict yet — a
 * verdict is CALLER-PRESENTED data only, and this module never derives
 * one) and for a sealed rejected gate (the first verdict is permanent)
 * it returns { ok: false, errors } — honest DATA, never a thrown
 * exception, so the caller can branch on refusal. Async for seam
 * symmetry with the minting functions (it hashes nothing; the record it
 * returns was already minted at seal time).
 *
 * Fail closed: an empty releasedAt (caller-injected — the gate never
 * reads a clock), a non-object gate, a state outside the gate's own
 * vocabulary, a sealed verdict outside the frozen two-value vocabulary,
 * a gate id that is not 'rgate_'-prefixed, or a malformed carried field
 * is a collected, field-named error carrying the observed value — ALL
 * errors, never just the first. A pending gate holding a verdict key is
 * named as the state/verdict disagreement it is.
 *
 * On success the release record carries the full provenance chain —
 * the tcls_ classificationId and mpass_ scheduleId VERBATIM, plus this
 * gate's own rgate_ gateId — and the measured schedule facts
 * (passCount, converged) VERBATIM (copied from the gate's own carried
 * values; nothing is re-derived, and the release never blocks on the
 * facts: the verdict already decided, and the facts ride along for the
 * record), the sealed 'approved' verdict, and the caller-injected
 * release clock. The caller's gate record is never mutated.
 */
export async function releaseFromGate(
  gate: unknown,
  releasedAt: string,
): Promise<ReleaseResult> {
  const errors: string[] = [];

  // ---- caller-injected release time — the gate never reads a clock ----
  if (typeof releasedAt !== 'string' || releasedAt.length === 0) {
    errors.push(
      `releasedAt: expected a non-empty string (caller-injected — the gate never reads a clock), got ${preview(releasedAt)}`,
    );
  }

  // ---- the gate admission shape (the record the caller presents back) ----
  if (!isObject(gate)) {
    errors.push(
      `gate: expected an object (a ReleaseGate minted by openReleaseGate — pending or sealed), got ${preview(gate)}`,
    );
    return { ok: false, errors };
  }

  // ---- the sealed gate's own id: the release's traceability to the gate ----
  const gateId = gate['id'];
  if (typeof gateId !== 'string' || gateId.length === 0 || !gateId.startsWith(RELEASE_GATE_ID_PREFIX)) {
    errors.push(
      `gate.id: expected an 'rgate_'-prefixed non-empty string (the gate's content-addressed identity — carried verbatim as the release record's gateId), got ${preview(gateId)}`,
    );
  }

  // ---- the refusal-or-release seam (law 4) ----
  const state = gate['state'];
  const verdict = gate['verdict'];

  if (state !== 'pending' && state !== 'sealed') {
    errors.push(
      `gate.state: expected 'pending' or 'sealed' (the gate's own state vocabulary — 'pending' is a STATE, never a verdict), got ${preview(state)}`,
    );
  }

  if (state === 'pending') {
    errors.push(
      "gate: the gate is PENDING — it is open and holds no verdict yet (a verdict is CALLER-PRESENTED data only; this module never derives, defaults, infers, or synthesizes one), and pending never releases",
    );
    if (Object.hasOwn(gate, 'verdict')) {
      errors.push(
        `gate.verdict: a pending gate holds no verdict ('pending' is a STATE, never a verdict), got ${preview(verdict)}`,
      );
    }
  }

  if (state === 'sealed') {
    if (verdict === 'rejected') {
      errors.push(
        'gate: the gate is sealed REJECTED — rejected never releases (the first verdict is permanent: no re-vote, no overwrite, no appeal; the refusal is honest data, never a thrown exception — the caller must be able to branch on refusal)',
      );
    } else if (verdict !== 'approved') {
      errors.push(
        `gate.verdict: expected 'approved' or 'rejected' (the frozen two-value verdict vocabulary — a sealed gate holds exactly one, the CALLER-PRESENTED verdict that applyVerdict recorded), got ${preview(verdict)}`,
      );
    }
    // verdict === 'approved' is the ONLY release path (law 4) — no error;
    // the carried-fields admission below is the last fail-closed guard.
  }

  // ---- the carried fields (each named — the duck-validated record) ----
  const admitted = admitGateCarriedFields(gate, errors);

  // ---- fail closed: nothing releases unless everything admitted AND the gate is sealed+approved ----
  if (
    errors.length > 0 ||
    state !== 'sealed' ||
    verdict !== 'approved' ||
    admitted === null ||
    typeof gateId !== 'string' ||
    gateId.length === 0 ||
    !gateId.startsWith(RELEASE_GATE_ID_PREFIX)
  ) {
    return { ok: false, errors };
  }

  // ---- the release record: the provenance chain and the measured facts, VERBATIM ----
  return {
    ok: true,
    release: {
      releaseGateVersion: RELEASE_GATE_VERSION,
      gateId,
      classificationId: admitted.classificationId,
      scheduleId: admitted.scheduleId,
      budgetTier: admitted.budgetTier,
      passCount: admitted.passCount,
      converged: admitted.converged,
      verdict,
      releasedAt,
    },
  };
}
