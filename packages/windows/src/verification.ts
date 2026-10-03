/**
 * @clapp/windows — the Windows verification adapter (CLAPP-082, the P8
 * third platform — the fifth of the five platform components).
 *
 * docs/WORK_ITEMS.md P8: each platform implements a verification
 * adapter. THIS MODULE IS THE WINDOWS ONE: `verifyWindowsJourneys`
 * runs a caller-supplied list of journeys through the host seam against
 * the synthesized target and returns the MEASURED outcomes — completed
 * and failed counted, failure reasons carried VERBATIM.
 *
 * THE HOST-SEAM LAW (the honest boundary): everything environment-
 * specific enters through ONE duck-typed seam —
 * WindowsVerificationHost ("an object with a callable runJourney()").
 * The journey ids are the @clapp/journey vocabulary this adapter RUNS
 * (TYPE-ONLY consumption — never redefined here; the journey lane owns
 * the ids); the tests fake the host; real Win32 SendInput synthesis
 * and UIA-driven target bindings are deployment scope (later lanes)
 * — never this module.
 *
 * THE MEASUREMENT LAW: completed and failed are MEASURED from the
 * host's outcomes (counted, never asserted, never derived from the
 * input list's length); the failure reasons ride VERBATIM in journey
 * order (the host's reason carried exactly — never re-worded, never
 * normalized; a failed journey whose host said nothing carries ''
 * — the host said nothing, and nothing is never invented).
 *
 * THE DIFF BOUNDARY (the no-fork law, documented as the boundary): the
 * run's data is the shape the diff lane consumes — the paired-run
 * evidence enters the frozen DiffReport (@clapp/diff's
 * PairedRun/DiffDimension/DiffSeverity vocabulary) through the diff
 * lane's EXISTING machinery; THIS ADAPTER NEVER CONSTRUCTS A
 * DiffReport. The journey outcomes this module measures are the facts
 * that machinery weighs — never the report itself.
 *
 * THE LOUD-HOST LAW: a THROWING host propagates loudly (never
 * swallowed, never a synthetic result — the replay-benchmark
 * precedent). A MALFORMED host outcome (not an object, completed not a
 * boolean, failureReason present but not a string) is a NAMED error
 * result — fail-closed, never guessed.
 *
 * Discipline (binding — the 070..081 house rules): no clock, no
 * randomness, no network, no filesystem, no global state; the module
 * never mutates its inputs; results, never exceptions (except the
 * loud-host law above).
 */

import { validateWindowsEnvironment } from './environment';
import type { WindowsEnvironment } from './environment';

// ---- the host seam (the honest boundary) -------------------------------------------

/** The verification host seam: runs ONE journey on the target (duck-typed; the test fakes it). */
export interface WindowsVerificationHost {
  /** Run a journey (a journey id) against the target; resolve with the outcome. */
  runJourney(journeyId: string): Promise<{ completed: boolean; failureReason?: string }>;
}

/** One verification run — the journey outcomes, MEASURED. */
export interface WindowsVerificationRun {
  /** The descriptor version the run executed under (WINDOWS_ENVIRONMENT_VERSION). */
  environmentVersion: string;
  /** The journey ids attempted (the caller's list, sorted). */
  journeyIds: string[];
  /** MEASURED: how many completed. */
  completed: number;
  /** MEASURED: how many failed. */
  failed: number;
  /** The host's failure reasons, VERBATIM, in journey order. */
  failures: Array<{ journeyId: string; reason: string }>;
}

/** The verification adapter's fail-closed result (the house shape). */
export type WindowsVerificationResult =
  | { ok: true; run: WindowsVerificationRun }
  | { ok: false; errors: string[] };

// ---- internal helpers (module-level; NOT re-exported by src/index.ts) --------------

/** Duck-typed host-seam guard: an object with a callable runJourney. */
function isVerificationHost(host: unknown): host is WindowsVerificationHost {
  return (
    typeof host === 'object' &&
    host !== null &&
    typeof (host as Record<string, unknown>).runJourney === 'function'
  );
}

/** Plain-object guard (arrays are NOT objects here — the house helper). */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Human preview of an unknown value, for error messages. */
function preview(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'undefined') return 'undefined';
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

// ---- the verification adapter --------------------------------------------------------

/**
 * Verify a list of journeys through the host seam — fail-closed,
 * measured, verbatim.
 *
 * The host must be an object with a callable runJourney; the journeys
 * must be an array of non-empty strings, deduped (a duplicate is a
 * named error) and sorted ascending; the env must pass
 * validateWindowsEnvironment (its errors are carried). Every journey
 * is then run through the host IN THE SORTED ORDER; completed/failed
 * are MEASURED from the host's outcomes; the failure reasons ride
 * VERBATIM in journey order. Results, never exceptions — a THROWING
 * host propagates loudly (never swallowed, never a synthetic result).
 */
export async function verifyWindowsJourneys(
  host: unknown,
  journeys: unknown,
  env: unknown,
): Promise<WindowsVerificationResult> {
  const errors: string[] = [];

  if (!isVerificationHost(host)) {
    errors.push(
      `verification host must be an object with a callable runJourney() method (observed: ${preview(host)})`,
    );
  }

  if (!Array.isArray(journeys)) {
    errors.push(`journeys must be an array of journey id strings (observed: ${preview(journeys)})`);
  } else {
    const ids: string[] = [];
    for (const [index, journeyId] of journeys.entries()) {
      if (typeof journeyId !== 'string' || journeyId.length === 0) {
        errors.push(`journeys[${index}] must be a non-empty string (observed: ${preview(journeyId)})`);
        continue;
      }
      ids.push(journeyId);
    }
    const seen = new Set<string>();
    for (const journeyId of ids) {
      if (seen.has(journeyId)) {
        errors.push(`journeys contains a duplicate journey id (observed: ${preview(journeyId)})`);
      } else {
        seen.add(journeyId);
      }
    }
    const sorted = [...ids].sort();
    if (ids.some((journeyId, index) => journeyId !== sorted[index])) {
      errors.push(`journeys must be sorted ascending (observed: ${preview(ids)})`);
    }
  }

  const environmentValidation = validateWindowsEnvironment(env);
  if (!environmentValidation.ok) {
    errors.push(...environmentValidation.errors);
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const environment = env as WindowsEnvironment;
  const verificationHost = host as WindowsVerificationHost;
  const journeyIds = journeys as string[];

  // The run — every journey through the host, in the sorted order. A
  // THROWING host propagates loudly (never swallowed: no synthetic
  // result is ever invented — the replay-benchmark precedent).
  const completedIds: string[] = [];
  const failures: Array<{ journeyId: string; reason: string }> = [];

  for (const journeyId of journeyIds) {
    const outcome: unknown = await verificationHost.runJourney(journeyId);

    if (!isObject(outcome) || typeof outcome.completed !== 'boolean') {
      return {
        ok: false,
        errors: [
          `host outcome for journey ${preview(journeyId)} must be an object with a boolean completed (observed: ${preview(outcome)})`,
        ],
      };
    }

    const failureReason = outcome.failureReason;
    if (failureReason !== undefined && typeof failureReason !== 'string') {
      return {
        ok: false,
        errors: [
          `host outcome failureReason for journey ${preview(journeyId)} must be a string when present (observed: ${preview(failureReason)})`,
        ],
      };
    }

    if (outcome.completed) {
      completedIds.push(journeyId);
    } else {
      // VERBATIM: the host's reason carried exactly, in journey order;
      // a failed journey whose host said nothing carries '' (the host
      // said nothing — never invented, never re-worded).
      failures.push({
        journeyId,
        reason: typeof failureReason === 'string' ? failureReason : '',
      });
    }
  }

  // MEASURED: completed/failed counted from the host's outcomes — never
  // asserted, never derived from the input list's length.
  const run: WindowsVerificationRun = {
    environmentVersion: environment.environmentVersion,
    journeyIds,
    completed: completedIds.length,
    failed: failures.length,
    failures,
  };
  return { ok: true, run };
}
