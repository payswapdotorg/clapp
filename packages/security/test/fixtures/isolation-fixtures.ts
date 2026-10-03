// CLAPP-072 — isolation fixtures.
//
// Fixed caller-injected storedAt timestamps (fixtures never read the
// clock), two named tenants (the tenant-scoping law's A and B), the five
// frozen §6 domains pinned locally so the fixture coverage is checkable,
// and deliberately permissive/overridable builders so the fail-closed
// tests can inject contract-violating DATA on purpose (the
// registry-fixture discipline, CLAPP-055; the failure-fixture
// discipline, CLAPP-060).

import type { DataDomain } from '../../src/isolation';

/** Fixed caller-injected store timestamps (fixtures never read the clock). */
export const STORED_AT_A = '2026-10-05T08:00:00Z';
export const STORED_AT_B = '2026-10-05T09:30:00Z';

/** Two named tenants — the tenant-scoping law's A and B. */
export const TENANT_A = 'tenant-acme';
export const TENANT_B = 'tenant-globex';

/** The five frozen §6 data domains, pinned locally so the fixture coverage is checkable. */
export const FIVE_DOMAINS: readonly DataDomain[] = [
  'user-project',
  'target-evidence',
  'generated-code',
  'package-library',
  'benchmark-corpus',
];

/** Caller-chosen keys, one flavor per domain (keys are domain-scoped, never global). */
export const KEY_A = 'project-notes';
export const KEY_B = 'journey-checkout-01';
export const KEY_C = 'App.tsx';
export const KEY_D = 'button-parity@1.0.0';
export const KEY_E = 'case-checkout-flow';

/** The default datum value (a small plain-JSON literal). */
export const DEFAULT_VALUE = { sample: true };

/** One well-formed sample value per frozen §6 domain (the vocabulary coverage fixture). */
export const VALUES_BY_DOMAIN: Record<DataDomain, unknown> = {
  'user-project': { project: 'acme-rebuild', private: true, files: ['App.tsx', 'api.ts'] },
  'target-evidence': { target: 'shop.example', journey: ['navigate', 'click', 'type'], entries: 3 },
  'generated-code': { artifact: 'App.tsx', lines: 214, builder: 'clapp-gen' },
  'package-library': { package: 'button-parity', version: '1.0.0', provenance: 'case-checkout' },
  'benchmark-corpus': { case: 'checkout-flow', assertions: 42, platform: 'web' },
};

// ---- the write-input builder ----------------------------------------------------------

export interface WriteSpec {
  /** Deliberately permissive (unknown-typed) so fail-closed tests can inject violations. */
  domain?: unknown;
  key?: unknown;
  value?: unknown;
  /** Optional origin domain — OMITTED entirely when the spec leaves it undefined. */
  originDomain?: unknown;
}

/**
 * A put() input literal with deliberately-overridable (permissively-typed)
 * fields. The optional `originDomain` is included ONLY when the spec
 * supplies it (a present-but-undefined origin is indistinguishable from
 * an absent one — the JS idiom, documented in the module).
 */
export function write(spec: WriteSpec = {}): Record<string, unknown> {
  const input: Record<string, unknown> = {
    domain: spec.domain ?? 'user-project',
    key: spec.key ?? KEY_A,
    value: spec.value ?? DEFAULT_VALUE,
  };
  if (spec.originDomain !== undefined) {
    input['originDomain'] = spec.originDomain;
  }
  return input;
}

// ---- the store-options builder --------------------------------------------------------

export interface StoreOptionsSpec {
  /** Deliberately permissive (unknown-typed) so fail-closed tests can inject violations. */
  storedAt?: unknown;
}

/** A put() options literal with a deliberately-overridable (permissively-typed) storedAt. */
export function storeOptions(spec: StoreOptionsSpec = {}): Record<string, unknown> {
  return { storedAt: spec.storedAt ?? STORED_AT_A };
}
