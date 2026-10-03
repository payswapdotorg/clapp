// CLAPP-080 — synthesis-target fixtures.
//
// A well-formed v0.1 AndroidSynthesisTarget (sorted activities, sorted
// densities from the frozen five buckets, minApiLevel within the
// fixture environment's API level) and a permissive malformed(...)
// builder (the same discipline as the environment fixtures).

import type { AndroidSynthesisTarget } from '../../src/synthesis-target';

/** The well-formed fixture target (sorted activities, sorted frozen densities). */
export const VALID_TARGET: AndroidSynthesisTarget = {
  targetVersion: '0.1',
  platform: 'android',
  applicationId: 'org.clapp.example',
  activities: ['MainActivity', 'SettingsActivity'],
  densities: ['hdpi', 'xhdpi', 'xxxhdpi'],
  minApiLevel: 26,
};

/** Overriding builder: the valid fixture with contract-violating DATA injected on purpose. */
export function malformedTarget(patch: Record<string, unknown>): unknown {
  return { ...VALID_TARGET, ...patch };
}
