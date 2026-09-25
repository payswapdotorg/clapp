// ================= SHARED CONTRACT: journey-contract.ts =================
// CLAPP journey contract v0 — declared by the tech lead (P1 wave, 2026-09-25).
// Canonical owner: @clapp/journey (CLAPP-012). Byte-identical mirrors are
// carried by every package that needs the types; the tech lead freezes at
// integration. Changes require an ADR.

export type JourneyAction =
  | { type: 'navigate'; url: string }
  | { type: 'click'; target: TargetSelector }
  | { type: 'fill'; target: TargetSelector; value: string }
  | { type: 'press'; key: string }
  | { type: 'wait'; ms: number }
  | { type: 'assert-visible'; target: TargetSelector };

/**
 * How a recorded action names its element — role/anchor based (no brittle
 * XPath); resolved against the live DOM at replay time.
 */
export interface TargetSelector {
  role?: string;     // semantic role (a11y/DOM role table)
  name?: string;     // accessible name / text anchor
  testId?: string;   // data-testid when present
  nth?: number;      // disambiguator among matches (0-based)
}

export interface Journey {
  id: string;        // "journey_" + uuid v4
  name: string;
  targetId: string;  // e.g. "bench/b01-static"
  actions: JourneyAction[];
}

/** Structural validation (module-level function contract):
 *  export function validateJourney(j: unknown): j is Journey
 *  — implemented in @clapp/journey.
 */

/** Executes journey actions against the current page/adapter. */
export interface ActionApplier {
  apply(action: JourneyAction): Promise<void>;
}

/** Records a live session into a Journey. */
export interface JourneyRecorder {
  start(targetId: string): void;
  record(action: JourneyAction): void;
  finish(): Journey;
}
