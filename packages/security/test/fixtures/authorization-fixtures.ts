// CLAPP-070 — authorization fixtures.
//
// Statement literals over the five frozen §1 kinds, fixed caller-injected
// grant timestamps (fixtures never read the clock), and deliberately
// permissive/overridable builders so the fail-closed tests can inject
// contract-violating DATA on purpose (the registry-fixture discipline,
// CLAPP-055; the failure-fixture discipline, CLAPP-060).

import type { AuthorizationKind, AuthorizationStatement } from '../../src/authorization';

/** Fixed caller-injected grant timestamps (fixtures never read the clock). */
export const GRANTED_AT_A = '2026-10-04T08:00:00Z';
export const GRANTED_AT_B = '2026-10-04T09:30:00Z';

/** Two distinct targets — the per-target law's A and B. */
export const TARGET_A = 'app-a.example';
export const TARGET_B = 'app-b.example';

/** The five frozen §1 kinds, pinned locally so the fixture coverage is checkable. */
export const FIVE_KINDS: readonly AuthorizationKind[] = [
  'owned',
  'licensed-open-source',
  'explicit-permission',
  'interop-testing',
  'research-benchmark',
];

// ---- the statement builder -----------------------------------------------------------

export interface StatementSpec {
  /** Deliberately permissive (unknown-typed) so fail-closed tests can inject violations. */
  authorizationKind?: unknown;
  targetIdentifier?: unknown;
  ownerIdentity?: unknown;
  grantReference?: unknown;
  grantedAt?: unknown;
}

/** A statement literal with deliberately-overridable (permissively-typed) fields. */
export function statement(spec: StatementSpec = {}): AuthorizationStatement {
  return {
    authorizationKind: (spec.authorizationKind ?? 'owned') as AuthorizationKind,
    targetIdentifier: (spec.targetIdentifier ?? TARGET_A) as string,
    ownerIdentity: (spec.ownerIdentity ?? 'owner@acme.test') as string,
    grantReference: (spec.grantReference ?? 'ownership-record/acme/app-a') as string,
    grantedAt: (spec.grantedAt ?? GRANTED_AT_A) as string,
  };
}

// ---- one literal per §1 kind ---------------------------------------------------------

/** One well-formed statement per frozen §1 kind (the vocabulary coverage fixture). */
export const STATEMENTS_BY_KIND: Record<AuthorizationKind, AuthorizationStatement> = {
  owned: {
    authorizationKind: 'owned',
    targetIdentifier: 'app-owned.example',
    ownerIdentity: 'owner@acme.test',
    grantReference: 'ownership-record/acme/owned-app',
    grantedAt: GRANTED_AT_A,
  },
  'licensed-open-source': {
    authorizationKind: 'licensed-open-source',
    targetIdentifier: 'widget-mit.example',
    ownerIdentity: 'maintainer@oss.test',
    grantReference: 'license/MIT/widget-mit',
    grantedAt: GRANTED_AT_A,
  },
  'explicit-permission': {
    authorizationKind: 'explicit-permission',
    targetIdentifier: 'partner-app.example',
    ownerIdentity: 'admin@partner.test',
    grantReference: 'permission/letter-2026-09-01',
    grantedAt: GRANTED_AT_A,
  },
  'interop-testing': {
    authorizationKind: 'interop-testing',
    targetIdentifier: 'interop-lab.example',
    ownerIdentity: 'engineer@lab.test',
    grantReference: 'interop-lab/contract-77',
    grantedAt: GRANTED_AT_A,
  },
  'research-benchmark': {
    authorizationKind: 'research-benchmark',
    targetIdentifier: 'bench-case-12.example',
    ownerIdentity: 'researcher@uni.test',
    grantReference: 'benchmark-registry/case-12',
    grantedAt: GRANTED_AT_A,
  },
};
