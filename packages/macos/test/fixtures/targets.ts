// CLAPP-083 — synthesis-target fixtures.
//
// A well-formed v0.1 MacOSSynthesisTarget (sorted bundle identifiers,
// sorted packaging formats from the frozen five-format vocabulary,
// minOsMajor within the fixture environment's osMajor) and a
// permissive malformed(...) builder (the same discipline as the
// environment fixtures).

import type { MacOSSynthesisTarget } from '../../src/synthesis-target';

/** The well-formed fixture target (sorted bundle identifiers, sorted frozen packaging formats). */
export const VALID_TARGET: MacOSSynthesisTarget = {
  targetVersion: '0.1',
  platform: 'macos',
  bundleName: 'ClappExample.app',
  bundleIdentifiers: ['org.clapp.example', 'org.clapp.example.helper'],
  packagingFormats: ['app', 'dmg', 'zip'],
  minOsMajor: 13,
};

/** Overriding builder: the valid fixture with contract-violating DATA injected on purpose. */
export function malformedTarget(patch: Record<string, unknown>): unknown {
  return { ...VALID_TARGET, ...patch };
}
