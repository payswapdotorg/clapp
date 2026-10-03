// CLAPP-081 — synthesis-target fixtures.
//
// A well-formed v0.1 LinuxSynthesisTarget (sorted window classes,
// sorted packaging formats from the frozen five-format vocabulary,
// minKernelMajor within the fixture environment's kernel major) and a
// permissive malformed(...) builder (the same discipline as the
// environment fixtures).

import type { LinuxSynthesisTarget } from '../../src/synthesis-target';

/** The well-formed fixture target (sorted window classes, sorted frozen packaging formats). */
export const VALID_TARGET: LinuxSynthesisTarget = {
  targetVersion: '0.1',
  platform: 'linux',
  binaryName: 'clapp-example',
  windowClasses: ['Clapp-example', 'org.clapp.example'],
  packagingFormats: ['appimage', 'deb', 'tarball'],
  minKernelMajor: 5,
};

/** Overriding builder: the valid fixture with contract-violating DATA injected on purpose. */
export function malformedTarget(patch: Record<string, unknown>): unknown {
  return { ...VALID_TARGET, ...patch };
}
