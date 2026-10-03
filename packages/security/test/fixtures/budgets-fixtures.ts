// CLAPP-075 — budget fixtures.
//
// Fixed caller-injected usage timestamps (fixtures never read the
// clock), the six frozen v0.1 budget axes pinned locally so the fixture
// coverage is checkable, a well-formed sample envelope, and deliberately
// permissive/overridable envelope/usage builders so the fail-closed
// tests can inject contract-violating DATA on purpose (the registry-
// fixture discipline, CLAPP-055; the failure-fixture discipline,
// CLAPP-060).

import type { BudgetAxis } from '../../src/budgets';

/** Fixed caller-injected usage timestamps (fixtures never read the clock). */
export const USED_AT_A = '2026-10-06T08:00:00Z';
export const USED_AT_B = '2026-10-06T09:30:00Z';
export const USED_AT_C = '2026-10-06T11:15:00Z';

/** The six frozen v0.1 budget axes, pinned locally so the fixture coverage is checkable. */
export const SIX_AXES: readonly BudgetAxis[] = [
  'cpu-ms',
  'memory-mb',
  'process-count',
  'filesystem-bytes',
  'network-egress-count',
  'timeout-ms',
];

/** A well-formed, generously-sized sample envelope (every sample usage fits every axis). */
export const SAMPLE_ENVELOPE = {
  cpuMs: 2000,
  memoryMb: 512,
  processCount: 8,
  filesystemBytes: 1_000_000,
  networkEgressCount: 16,
  timeoutMs: 1000,
} as const;

// ---- the envelope builder -----------------------------------------------------------

export interface EnvelopeSpec {
  /** Deliberately permissive (unknown-typed) so fail-closed tests can inject violations. */
  cpuMs?: unknown;
  memoryMb?: unknown;
  processCount?: unknown;
  filesystemBytes?: unknown;
  networkEgressCount?: unknown;
  timeoutMs?: unknown;
}

/**
 * An envelope literal with deliberately-overridable (permissively-typed)
 * axis limits. An explicitly-passed zero/negative/fractional value rides
 * through untouched (nullish coalescing, not falsiness) — the fail-closed
 * tests inject violations as DATA, and the missing-limit case deletes the
 * key from a built envelope at the call site.
 */
export function envelope(spec: EnvelopeSpec = {}): Record<string, unknown> {
  return {
    cpuMs: spec.cpuMs ?? SAMPLE_ENVELOPE.cpuMs,
    memoryMb: spec.memoryMb ?? SAMPLE_ENVELOPE.memoryMb,
    processCount: spec.processCount ?? SAMPLE_ENVELOPE.processCount,
    filesystemBytes: spec.filesystemBytes ?? SAMPLE_ENVELOPE.filesystemBytes,
    networkEgressCount: spec.networkEgressCount ?? SAMPLE_ENVELOPE.networkEgressCount,
    timeoutMs: spec.timeoutMs ?? SAMPLE_ENVELOPE.timeoutMs,
  };
}

// ---- the usage builder --------------------------------------------------------------

export interface UsageSpec {
  /** Deliberately permissive (unknown-typed) so fail-closed tests can inject violations. */
  axis?: unknown;
  amount?: unknown;
  usedAt?: unknown;
}

/** A use() usage literal with deliberately-overridable (permissively-typed) fields. */
export function usage(spec: UsageSpec = {}): Record<string, unknown> {
  return {
    axis: spec.axis ?? 'timeout-ms',
    amount: spec.amount ?? 100,
    usedAt: spec.usedAt ?? USED_AT_A,
  };
}
