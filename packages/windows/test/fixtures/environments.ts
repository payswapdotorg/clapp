// CLAPP-082 — environment fixtures.
//
// A well-formed v0.1 WindowsEnvironment (an observing 'uia' provider,
// the observation budget set to 3 — the seven-node fixture tree is
// depth 3, the over-depth fixture is depth 4), the honest no-provider
// environment (uiAccessProvider 'none': a VALID descriptor whose
// observation refusal is the UIA law), and a permissive malformed(...)
// builder so the fail-closed tests can inject contract-violating DATA
// on purpose (the budgets-fixture discipline, CLAPP-075).

import type { WindowsEnvironment } from '../../src/environment';

/** The well-formed fixture environment (an observing 'uia' provider, budget 3). */
export const VALID_ENVIRONMENT: WindowsEnvironment = {
  environmentVersion: '0.1',
  platform: 'windows',
  osBuild: 22631,
  uiAccessProvider: 'uia',
  screenSize: { width: 1920, height: 1080 },
  maxHierarchyDepth: 3,
};

/**
 * The honest no-provider environment: a VALID descriptor
 * (uiAccessProvider 'none' passes the validator — never a validator
 * error) whose observation refusal is the UIA law — the
 * observation-refusal fixture.
 */
export const NO_PROVIDER_ENVIRONMENT: WindowsEnvironment = {
  environmentVersion: '0.1',
  platform: 'windows',
  osBuild: 22631,
  uiAccessProvider: 'none',
  screenSize: { width: 1920, height: 1080 },
  maxHierarchyDepth: 3,
};

/** Overriding builder: the valid fixture with contract-violating DATA injected on purpose. */
export function malformedEnvironment(patch: Record<string, unknown>): unknown {
  return { ...VALID_ENVIRONMENT, ...patch };
}
