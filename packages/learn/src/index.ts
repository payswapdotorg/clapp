/**
 * @clapp/learn — public API (CLAPP-060).
 *
 * The CLAPP Continuous Learning FIRST lane (P6, the first roadmap
 * checkbox: "failure memory"): the failure-event store — a fail-closed,
 * in-memory, insert-only FailureMemory over the frozen diff-contract v0.1
 * vocabulary (DiffFinding-shaped findings; repair-loop outcome facts),
 * with content-addressed event identities ('fail_'), canonically ordered
 * deep-copied listings, and input-order-independent snapshots ('fmem_').
 *
 * docs/LEARNING_AND_LIBRARY.md §7: "Failures are first-class knowledge" —
 * this lane RECORDS and STORES the failure events (failing package/version,
 * target/context, error signature, expected/actual, repair outcome,
 * whether the repair generalized); the guard/pattern DERIVATION from
 * repeated failures is CLAPP-061's later lane, not this package's.
 *
 * Quick start:
 *
 *   import { createFailureMemory } from '@clapp/learn';
 *
 *   const memory = createFailureMemory();
 *   const result = await memory.record(
 *     { finding, repair, packageRef, target, context },
 *     { observedAt: '2026-10-02T19:00:00Z' }, // caller-injected — never a clock
 *   );
 *   // result.ok === true  → result.record is the stored FailureRecord
 *   // result.ok === false → result.errors names EVERY offending field
 *
 *   memory.bySignature({ dimension, severity, summary }); // recurrences, canonical order
 *   memory.byPackage(packageId);                          // a package's events
 *   memory.list();                                        // deep copies, sorted by id
 *   await memory.snapshot();                              // 'fmem_' + sha256 — content-addressed
 *
 * Sibling packages must import `@clapp/learn` and never reach into deeper
 * paths. The memory consumes contract-shaped DATA: @clapp/diff and
 * @clapp/repair are devDependencies imported for TYPES ONLY (pinned by
 * test/failure-memory.test.ts); the runtime dependencies are exactly
 * @clapp/core (sha256Hex) and @clapp/observe (canonicalJson).
 */

// ---- the failure memory (CLAPP-060 — the P6 first lane) -----------------------------
export { FAILURE_VERSION, createFailureMemory } from './failure-memory';
export type { FailureMemory, FailureRecord, FailureResult } from './failure-memory';

// ---- the repair-pattern miner (CLAPP-061 — the P6 second lane) ----------------------
export { PATTERN_VERSION, mineRepairPatterns } from './repair-patterns';
export type { MiningResult, RepairPattern } from './repair-patterns';

// ---- the archetype classifier (CLAPP-062 — the P6 third lane) -----------------------
export { ARCHETYPE_TABLE_VERSION, ARCHETYPE_VERSION, classifyManifest } from './archetypes';
export type { ArchetypeClassification, ArchetypeMatch, ClassificationResult } from './archetypes';
