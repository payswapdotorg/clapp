// CLAPP-082 — host-seam fakes.
//
// THE HOST-SEAM LAW: everything environment-specific enters through
// the two duck-typed seams; the tests fake them here (real
// Win32/UIA/COM bindings are deployment scope — never this package).
// The observation fake resolves a fixed tree and RECORDS every call
// (the UIA law's "the host never called" is asserted from the
// recording, never trusted); the verification fake plays a script of
// outcomes and RECORDS the call order (the sorted-order law is
// asserted from the recording, never trusted).

import type { WindowsObservationHost, WindowsViewNode } from '../../src/observation';
import type { WindowsVerificationHost } from '../../src/verification';

/** One scripted journey outcome (the host contract's own shape). */
export type ScriptedOutcome = { completed: boolean; failureReason?: string };

/**
 * A fake observation host: captureScreen resolves the given tree and
 * records every call.
 */
export function fakeObservationHost(tree: WindowsViewNode): {
  host: WindowsObservationHost;
  calls: string[];
} {
  const calls: string[] = [];
  const host: WindowsObservationHost = {
    async captureScreen(): Promise<WindowsViewNode> {
      calls.push('captureScreen');
      return tree;
    },
  };
  return { host, calls };
}

/** A fake verification host: runJourney plays the script and records every call. */
export function fakeVerificationHost(script: Record<string, ScriptedOutcome>): {
  host: WindowsVerificationHost;
  calls: string[];
} {
  const calls: string[] = [];
  const host: WindowsVerificationHost = {
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
