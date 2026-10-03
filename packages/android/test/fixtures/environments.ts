// CLAPP-080 — environment fixtures.
//
// A well-formed v0.1 AndroidEnvironment (the observation budget set to
// 3 — the seven-node fixture tree is depth 3, the over-depth fixture is
// depth 4), and a permissive malformed(...) builder so the fail-closed
// tests can inject contract-violating DATA on purpose (the
// budgets-fixture discipline, CLAPP-075).

import type { AndroidEnvironment } from '../../src/environment';

/** The well-formed fixture environment (sorted permissions, budget 3). */
export const VALID_ENVIRONMENT: AndroidEnvironment = {
  environmentVersion: '0.1',
  platform: 'android',
  apiLevel: 34,
  screenDp: { width: 412, height: 892 },
  grantedPermissions: ['android.permission.CAMERA', 'android.permission.INTERNET'],
  maxHierarchyDepth: 3,
};

/** Overriding builder: the valid fixture with contract-violating DATA injected on purpose. */
export function malformedEnvironment(patch: Record<string, unknown>): unknown {
  return { ...VALID_ENVIRONMENT, ...patch };
}
