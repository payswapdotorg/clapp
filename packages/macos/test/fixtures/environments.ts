// CLAPP-083 — environment fixtures.
//
// A well-formed v0.1 MacOSEnvironment (an observing 'ax' framework,
// the observation budget set to 3 — the seven-node fixture tree is
// depth 3, the over-depth fixture is depth 4), the honest no-framework
// environment (accessibilityFramework 'none': a VALID descriptor whose
// observation refusal is the AX law), and a permissive malformed(...)
// builder so the fail-closed tests can inject contract-violating DATA
// on purpose (the budgets-fixture discipline, CLAPP-075).

import type { MacOSEnvironment } from '../../src/environment';

/** The well-formed fixture environment (an observing 'ax' framework, budget 3). */
export const VALID_ENVIRONMENT: MacOSEnvironment = {
  environmentVersion: '0.1',
  platform: 'macos',
  osMajor: 14,
  accessibilityFramework: 'ax',
  screenSize: { width: 1920, height: 1080 },
  maxHierarchyDepth: 3,
};

/**
 * The honest no-framework environment: a VALID descriptor
 * (accessibilityFramework 'none' passes the validator — never a
 * validator error) whose observation refusal is the AX law — the
 * observation-refusal fixture.
 */
export const NO_FRAMEWORK_ENVIRONMENT: MacOSEnvironment = {
  environmentVersion: '0.1',
  platform: 'macos',
  osMajor: 14,
  accessibilityFramework: 'none',
  screenSize: { width: 1920, height: 1080 },
  maxHierarchyDepth: 3,
};

/** Overriding builder: the valid fixture with contract-violating DATA injected on purpose. */
export function malformedEnvironment(patch: Record<string, unknown>): unknown {
  return { ...VALID_ENVIRONMENT, ...patch };
}
