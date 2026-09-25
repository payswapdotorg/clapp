/**
 * @clapp/journey — JourneyRecorder implementation (journey contract v0).
 *
 * Records a live interaction session into a well-formed Journey:
 *
 *   const recorder = createRecorder({ name: 'checkout-happy-path' });
 *   recorder.start('bench/b01-static');
 *   recorder.record({ type: 'navigate', url: '/' });
 *   recorder.record({ type: 'click', target: { testId: 'cta-pricing' } });
 *   const journey = recorder.finish();
 *
 * Determinism: the Journey shape carries no timestamps and no random data
 * except the id, so two sessions that record the same action sequence
 * produce identical journeys (module the id — inject `newId` for fully
 * deterministic output in tests). Recorded actions are deep-copied on the
 * way in, so later mutation of the caller's action objects cannot rewrite
 * history.
 *
 * Sequencing rules (violations throw):
 * - start() while recording        → throws (finish() first)
 * - record() while idle/finished   → throws (start() first)
 * - finish() while idle            → throws (start() first)
 * - start() after finish()         → allowed; begins a FRESH session
 * - record() of a structurally invalid action → throws with the precise
 *   validation messages from validate.ts
 */

import type { Journey, JourneyAction, JourneyRecorder } from './journey-contract';
import { newJourneyId } from './ids';
import { validateJourney, validateJourneyAction } from './validate';

export interface RecorderOptions {
  /** Journey name; defaults to `Recorded journey for <targetId>`. */
  name?: string;
  /**
   * id generator override — inject a fixed generator for deterministic
   * output in tests. Defaults to {@link newJourneyId}.
   */
  newId?: () => string;
}

type RecorderState = 'idle' | 'recording' | 'finished';

/** Creates a stateful JourneyRecorder (see module doc for sequencing). */
export function createRecorder(options: RecorderOptions = {}): JourneyRecorder {
  let state: RecorderState = 'idle';
  let targetId: string | null = null;
  const actions: JourneyAction[] = [];

  return {
    start(nextTargetId: string): void {
      if (typeof nextTargetId !== 'string' || nextTargetId.trim() === '') {
        throw new Error('JourneyRecorder: start(targetId) requires a non-empty string.');
      }
      if (state === 'recording') {
        throw new Error('JourneyRecorder: start() called while recording — call finish() first.');
      }
      state = 'recording';
      targetId = nextTargetId;
      actions.length = 0;
    },

    record(action: JourneyAction): void {
      if (state === 'idle') {
        throw new Error('JourneyRecorder: record() called while idle — call start() first.');
      }
      if (state === 'finished') {
        throw new Error(
          'JourneyRecorder: record() called after finish() — call start() to begin a new session.',
        );
      }
      const errors = validateJourneyAction(action);
      if (errors.length > 0) {
        throw new Error(
          `JourneyRecorder: refusing to record an invalid action — ${errors.join('; ')}`,
        );
      }
      // Deep copy so the journey owns its actions outright.
      actions.push(structuredClone(action));
    },

    finish(): Journey {
      if (state !== 'recording' || targetId === null) {
        throw new Error('JourneyRecorder: finish() called while not recording — call start() first.');
      }
      const journey: Journey = {
        id: options.newId !== undefined ? options.newId() : newJourneyId(),
        name: options.name ?? `Recorded journey for ${targetId}`,
        targetId,
        actions: [...actions],
      };
      // Defense in depth: the recorder promises a well-formed Journey.
      if (!validateJourney(journey)) {
        throw new Error('JourneyRecorder: internal error — recorded journey failed validation.');
      }
      state = 'finished';
      return journey;
    },
  };
}
