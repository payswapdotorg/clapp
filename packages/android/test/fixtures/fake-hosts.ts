// CLAPP-080 — host-seam fakes.
//
// THE HOST-SEAM LAW: everything environment-specific enters through
// the two duck-typed seams; the tests fake them here (real adb/
// uiautomator/emulator bindings are deployment scope — never this
// package). The observation fake resolves a fixed tree; the
// verification fake plays a script of outcomes and RECORDS the call
// order (the sorted-order law is asserted from the recording, never
// trusted).

import type { AndroidObservationHost, AndroidViewNode } from '../../src/observation';
import type { AndroidVerificationHost } from '../../src/verification';

/** One scripted journey outcome (the host contract's own shape). */
export type ScriptedOutcome = { completed: boolean; failureReason?: string };

/** A fake observation host: captureScreen resolves the given tree. */
export function fakeObservationHost(tree: AndroidViewNode): AndroidObservationHost {
  return {
    async captureScreen(): Promise<AndroidViewNode> {
      return tree;
    },
  };
}

/** A fake verification host: runJourney plays the script and records every call. */
export function fakeVerificationHost(script: Record<string, ScriptedOutcome>): {
  host: AndroidVerificationHost;
  calls: string[];
} {
  const calls: string[] = [];
  const host: AndroidVerificationHost = {
    async runJourney(journeyId: string): Promise<ScriptedOutcome> {
      calls.push(journeyId);
      const outcome = script[journeyId];
      if (outcome === undefined) {
        return { completed: false, failureReason: `no scripted outcome for ${journeyId}` };
      }
      return { ...outcome };
    },
  };
  return { host, calls };
}
