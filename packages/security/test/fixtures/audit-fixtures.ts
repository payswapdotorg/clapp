// CLAPP-073 — audit fixtures.
//
// Fixed caller-injected record/transition timestamps (fixtures never
// read the clock), the seven frozen v0.1 action kinds pinned locally so
// the fixture coverage is checkable, one well-formed event input per
// kind (the vocabulary coverage fixture), and deliberately
// permissive/overridable builders so the fail-closed tests can inject
// contract-violating DATA on purpose (the registry-fixture discipline,
// CLAPP-055; the failure-fixture discipline, CLAPP-060).

import type { AuditActionKind } from '../../src/audit';

/** Fixed caller-injected event-record timestamps (fixtures never read the clock). */
export const RECORDED_AT_A = '2026-10-06T08:00:00Z';
export const RECORDED_AT_B = '2026-10-06T09:30:00Z';
export const RECORDED_AT_C = '2026-10-06T11:15:00Z';

/** Fixed caller-injected state-machine transition timestamps (fixtures never read the clock). */
export const REGISTERED_AT_A = '2026-10-06T08:05:00Z';
export const CANCELLED_AT_A = '2026-10-06T09:00:00Z';
export const RESUMED_AT_A = '2026-10-06T10:00:00Z';
export const CANCELLED_AT_B = '2026-10-06T10:30:00Z';
export const RESUMED_AT_B = '2026-10-06T11:45:00Z';

/** Two named actors — who/what acted. */
export const ACTOR_A = 'observation-runner-01';
export const ACTOR_B = 'redaction-worker-02';

/** Two named subjects — what the action concerned. */
export const SUBJECT_A = 'observation-run-42';
export const SUBJECT_B = 'evidence-bundle-77';

/** Two named cancellable operations — the CALLER supplies these ids (the module never generates one). */
export const OPERATION_ID_A = 'observation-walk-42';
export const OPERATION_ID_B = 'repair-pass-7';

/** The seven frozen v0.1 action kinds, pinned locally so the fixture coverage is checkable. */
export const SEVEN_KINDS: readonly AuditActionKind[] = [
  'session-admitted',
  'observation-refused',
  'redaction-applied',
  'zone-write',
  'zone-refused',
  'operation-cancelled',
  'operation-resumed',
];

/** One well-formed MEASURED-facts literal per frozen kind (the vocabulary coverage fixture). */
export const FACTS_BY_KIND: Record<AuditActionKind, Record<string, unknown>> = {
  'session-admitted': { sessionId: 'authz_5f3c2b', scopes: ['observe'] },
  'observation-refused': { reason: 'no statement for the target', target: 'app-b.example' },
  'redaction-applied': { fieldsRedacted: 3, countsByKind: { cookie: 1, password: 2 } },
  'zone-write': { domain: 'user-project', key: 'project-notes' },
  'zone-refused': { domain: 'package-library', cause: 'cross-domain publication' },
  'operation-cancelled': { cancellationCount: 1 },
  'operation-resumed': { cancellationCount: 1 },
};

// ---- the event-input builder ----------------------------------------------------------

export interface EventSpec {
  /** Deliberately permissive (unknown-typed) so fail-closed tests can inject violations. */
  kind?: unknown;
  actor?: unknown;
  subject?: unknown;
  /**
   * Optional MEASURED facts — OMITTED entirely when the spec leaves it
   * undefined (a present-but-undefined facts is indistinguishable from
   * an absent one — the JS idiom, documented in the module).
   */
  facts?: unknown;
}

/**
 * A record() input literal with deliberately-overridable
 * (permissively-typed) fields. The optional `facts` is included ONLY
 * when the spec supplies it; the default input carries none (an absent
 * facts rides as {} in the stored event — the contract's non-optional
 * slot).
 */
export function event(spec: EventSpec = {}): Record<string, unknown> {
  const input: Record<string, unknown> = {
    kind: spec.kind ?? 'session-admitted',
    actor: spec.actor ?? ACTOR_A,
    subject: spec.subject ?? SUBJECT_A,
  };
  if (spec.facts !== undefined) {
    input['facts'] = spec.facts;
  }
  return input;
}

// ---- the option builders --------------------------------------------------------------

export interface RecordOptionsSpec {
  /** Deliberately permissive (unknown-typed) so fail-closed tests can inject violations. */
  recordedAt?: unknown;
}

/** A record() options literal with a deliberately-overridable (permissively-typed) recordedAt. */
export function recordOptions(spec: RecordOptionsSpec = {}): Record<string, unknown> {
  return { recordedAt: spec.recordedAt ?? RECORDED_AT_A };
}

export interface RegisterOptionsSpec {
  /** Deliberately permissive (unknown-typed) so fail-closed tests can inject violations. */
  registeredAt?: unknown;
}

/** A registerOperation() options literal with a deliberately-overridable registeredAt. */
export function registerOptions(spec: RegisterOptionsSpec = {}): Record<string, unknown> {
  return { registeredAt: spec.registeredAt ?? REGISTERED_AT_A };
}

export interface CancelOptionsSpec {
  /** Deliberately permissive (unknown-typed) so fail-closed tests can inject violations. */
  cancelledAt?: unknown;
}

/** A cancel() options literal with a deliberately-overridable cancelledAt. */
export function cancelOptions(spec: CancelOptionsSpec = {}): Record<string, unknown> {
  return { cancelledAt: spec.cancelledAt ?? CANCELLED_AT_A };
}

export interface ResumeOptionsSpec {
  /** Deliberately permissive (unknown-typed) so fail-closed tests can inject violations. */
  resumedAt?: unknown;
}

/** A resume() options literal with a deliberately-overridable resumedAt. */
export function resumeOptions(spec: ResumeOptionsSpec = {}): Record<string, unknown> {
  return { resumedAt: spec.resumedAt ?? RESUMED_AT_A };
}
