// CLAPP-084 — synthesis-target fixtures.
//
// A well-formed v0.1 IOSSynthesisTarget (sorted bundle identifiers,
// sorted packaging formats from the frozen five-format vocabulary —
// note 'dSYM' sorts after 'app' and before 'ipa' in code-unit order,
// never case-folded — minOsMajor within the fixture environment's
// osMajor) and a permissive malformed(...) builder (the same
// discipline as the environment fixtures).

import type { IOSSynthesisTarget } from '../../src/synthesis-target';

/** The well-formed fixture target (sorted bundle identifiers, sorted frozen packaging formats). */
export const VALID_TARGET: IOSSynthesisTarget = {
  targetVersion: '0.1',
  platform: 'ios',
  productName: 'ClappExample',
  bundleIdentifiers: ['org.clapp.example', 'org.clapp.example.helper'],
  packagingFormats: ['app', 'dSYM', 'ipa'],
  minOsMajor: 16,
};

/** Overriding builder: the valid fixture with contract-violating DATA injected on purpose. */
export function malformedTarget(patch: Record<string, unknown>): unknown {
  return { ...VALID_TARGET, ...patch };
}
