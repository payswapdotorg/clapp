// CLAPP-084 — environment fixtures.
//
// A well-formed v0.1 IOSEnvironment (an observing 'xcuitest' framework,
// the observation budget set to 3 — the seven-node fixture tree is
// depth 3, the over-depth fixture is depth 4), the honest no-framework
// environment (uiTestFramework 'none': a VALID descriptor whose
// observation refusal is the XCUITEST law), and a permissive
// malformed(...) builder so the fail-closed tests can inject
// contract-violating DATA on purpose (the budgets-fixture discipline,
// CLAPP-075).

import type { IOSEnvironment } from '../../src/environment';

/** The well-formed fixture environment (an observing 'xcuitest' framework, budget 3). */
export const VALID_ENVIRONMENT: IOSEnvironment = {
  environmentVersion: '0.1',
  platform: 'ios',
  osMajor: 17,
  uiTestFramework: 'xcuitest',
  screenSize: { width: 1170, height: 2532 },
  maxHierarchyDepth: 3,
};

/**
 * The honest no-framework environment: a VALID descriptor
 * (uiTestFramework 'none' passes the validator — never a validator
 * error) whose observation refusal is the XCUITEST law — the
 * observation-refusal fixture.
 */
export const NO_FRAMEWORK_ENVIRONMENT: IOSEnvironment = {
  environmentVersion: '0.1',
  platform: 'ios',
  osMajor: 17,
  uiTestFramework: 'none',
  screenSize: { width: 1170, height: 2532 },
  maxHierarchyDepth: 3,
};

/** Overriding builder: the valid fixture with contract-violating DATA injected on purpose. */
export function malformedEnvironment(patch: Record<string, unknown>): unknown {
  return { ...VALID_ENVIRONMENT, ...patch };
}
