/**
 * @clapp/security — public API (CLAPP-070).
 *
 * The Phase-7 FIRST lane (the first `docs/ROADMAP.md` P7 checkbox:
 * "auth/session boundary"): the authorized-session boundary —
 * docs/SECURITY_AND_AUTHORIZATION.md §1's capture requirement ("The
 * system must capture an authorization statement or benchmark ownership
 * record before observation begins") made executable.
 *
 * `createAuthorizedSession` admits a captured statement fail-closed into
 * a content-addressed AuthorizationSession (authz_ identity, observation-
 * only scopes); `assertObservationAuthorized` is the gate observation
 * must pass through before it begins — per-target, fail-closed,
 * synchronous and pure.
 *
 * Quick start:
 *
 *   import { assertObservationAuthorized, createAuthorizedSession } from '@clapp/security';
 *
 *   const result = await createAuthorizedSession({
 *     authorizationKind: 'owned',                  // one of the five §1 kinds
 *     targetIdentifier: 'app.example',
 *     ownerIdentity: 'owner@example.test',
 *     grantReference: 'ownership-record/example/app',
 *     grantedAt: '2026-10-04T08:00:00Z',           // caller-injected — never a clock
 *   });
 *   // result.ok === true  → result.session is the live AuthorizationSession
 *   // result.ok === false → result.errors names EVERY offending field
 *
 *   const verdict = assertObservationAuthorized(result.session, 'app.example');
 *   // verdict.ok === true  → { sessionId, targetIdentifier } — observation may begin
 *   // verdict.ok === false → { reason } — refused, the defect named
 *
 * Sibling packages must import `@clapp/security` and never reach into
 * deeper paths. The runtime dependencies are exactly @clapp/core
 * (`sha256Hex`) and @clapp/observe (`canonicalJson`); the statement
 * shapes are fully local (no devDependencies in v0.1).
 */

// ---- the authorized-session boundary (CLAPP-070 — the P7 first lane) -----------------
export { AUTHZ_ID_PATTERN, AUTHZ_VERSION, assertObservationAuthorized, createAuthorizedSession } from './authorization';
export type {
  AuthorizationKind,
  AuthorizationSession,
  AuthorizationSessionResult,
  AuthorizationStatement,
  BoundaryResult,
} from './authorization';

// ---- secret redaction (CLAPP-071 — the P7 second lane) -------------------------------

export { REDACTION_VERSION, classifyFieldName, redactSensitiveFields } from './redaction';
export type { RedactionEntry, RedactionReport, RedactionResult, SensitiveKind } from './redaction';

// ---- multi-tenant isolation (CLAPP-072 — the P7 third lane) ---------------------------

export { ISOLATION_VERSION, createTenantZone } from './isolation';
export type { DataDomain, IsolatedDatum, IsolationZone, StoreResult, ZoneResult } from './isolation';

// ---- audit/cancellation/resume (CLAPP-073 — the P7 fourth lane) -----------------------

export { AUDIT_VERSION, createAuditTrail } from './audit';
export type { AuditActionKind, AuditEvent, AuditResult, AuditTrail, CancellableOperation } from './audit';

// ---- the production readiness gate (CLAPP-074 — the tech lead's lane) ----------------
export { EVALUATED_BY, READINESS_VERSION, evaluateReadiness } from './readiness';
export type { ReadinessCheck, ReadinessEvidence, ReadinessReport, ReadinessResult } from './readiness';

// ---- resource budgets (CLAPP-075 — the P7 closing lane) -------------------------------
export { BUDGETS_VERSION, createBudgetAccount } from './budgets';
export type { BudgetAccount, BudgetAxis, BudgetEnvelope, BudgetResult, BudgetUsage } from './budgets';
