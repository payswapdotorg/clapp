// CLAPP-082 — synthesis-target fixtures.
//
// A well-formed v0.1 WindowsSynthesisTarget (sorted window classes,
// sorted packaging formats from the frozen five-format vocabulary,
// minOsBuild within the fixture environment's osBuild) and a
// permissive malformed(...) builder (the same discipline as the
// environment fixtures).

import type { WindowsSynthesisTarget } from '../../src/synthesis-target';

/** The well-formed fixture target (sorted window classes, sorted frozen packaging formats). */
export const VALID_TARGET: WindowsSynthesisTarget = {
  targetVersion: '0.1',
  platform: 'windows',
  binaryName: 'clapp-example.exe',
  windowClasses: ['ClappExample', 'ClappExampleMain'],
  packagingFormats: ['exe', 'msi', 'zip'],
  minOsBuild: 22000,
};

/** Overriding builder: the valid fixture with contract-violating DATA injected on purpose. */
export function malformedTarget(patch: Record<string, unknown>): unknown {
  return { ...VALID_TARGET, ...patch };
}
