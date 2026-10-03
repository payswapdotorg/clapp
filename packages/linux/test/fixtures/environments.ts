// CLAPP-081 — environment fixtures.
//
// A well-formed v0.1 LinuxEnvironment (an observing AT-SPI bus, the
// observation budget set to 3 — the seven-node fixture tree is depth 3,
// the over-depth fixture is depth 4), the honest no-bus environment
// (accessibilityBus 'none': a VALID descriptor whose observation
// refusal is the AT-SPI law), and a permissive malformed(...) builder
// so the fail-closed tests can inject contract-violating DATA on
// purpose (the budgets-fixture discipline, CLAPP-075).

import type { LinuxEnvironment } from '../../src/environment';

/** The well-formed fixture environment (an observing AT-SPI bus, budget 3). */
export const VALID_ENVIRONMENT: LinuxEnvironment = {
  environmentVersion: '0.1',
  platform: 'linux',
  kernelMajor: 6,
  displayServer: 'x11',
  accessibilityBus: 'at-spi',
  screenSize: { width: 1920, height: 1080 },
  maxHierarchyDepth: 3,
};

/**
 * The honest no-bus environment: a VALID descriptor (accessibilityBus
 * 'none' passes the validator — never a validator error) whose
 * observation refusal is the AT-SPI law — the observation-refusal
 * fixture.
 */
export const NO_BUS_ENVIRONMENT: LinuxEnvironment = {
  environmentVersion: '0.1',
  platform: 'linux',
  kernelMajor: 6,
  displayServer: 'wayland',
  accessibilityBus: 'none',
  screenSize: { width: 1920, height: 1080 },
  maxHierarchyDepth: 3,
};

/** Overriding builder: the valid fixture with contract-violating DATA injected on purpose. */
export function malformedEnvironment(patch: Record<string, unknown>): unknown {
  return { ...VALID_ENVIRONMENT, ...patch };
}
