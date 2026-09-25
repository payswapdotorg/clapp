/**
 * @clapp/journey — identifier helper for the journey contract.
 *
 * Journey ids are prefixed uuid v4 strings so stored journeys are
 * self-describing at a glance, mirroring the run/artifact/evidence id
 * conventions in @clapp/core.
 */

import type { Journey } from './journey-contract';

/** Fresh `Journey['id']`: `"journey_" + uuid v4`. */
export function newJourneyId(): Journey['id'] {
  return `journey_${crypto.randomUUID()}`;
}
