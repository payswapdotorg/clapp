/**
 * CLAPP-003 test battery — network policy defaults.
 *
 * Asserts the platform's default posture (deny-all) at runtime AND at the
 * type level: `ExecutionProfile.network` is a required field, enforced by tsc
 * via an @ts-expect-error contract test.
 */

import { expect, it } from 'bun:test';
import { defaultDenyAllNetwork } from './policy';
import type { ExecutionProfile } from './types';

it('defaultDenyAllNetwork() returns the deny-all default posture', () => {
  expect(defaultDenyAllNetwork()).toEqual({ mode: 'deny-all' });
});

it('ExecutionProfile requires a network policy (compile-time contract)', () => {
  // @ts-expect-error — `network` is a required field of ExecutionProfile; this
  // assignment must fail typecheck. If the field ever became optional, the
  // unused directive itself becomes a tsc error, failing the battery.
  const invalid: ExecutionProfile = { id: 'sandbox_typecheck', rootDir: '/tmp/clapp-typecheck', envAllowlist: [], budget: { maxDurationMs: 1_000 } };
  void invalid;
});
