/**
 * @clapp/plan — deterministic canonical serialization for Synthesis Plans.
 *
 * - `serializeSynthesisPlan` produces the CANONICAL JSON text of a plan
 *   (sorted keys, stable escapes, compact, array order preserved) using
 *   @clapp/ir's `canonicalJson` — the packet-declared platform semantics,
 *   deliberately REUSED rather than reimplemented (the plan is a consumer of
 *   the IR's serialization discipline, not a second implementation of it).
 *   It VALIDATES first and refuses to serialize an invalid plan: anything it
 *   emits is guaranteed to round-trip through `parseSynthesisPlan`, so a
 *   serialized plan can never be a one-way door.
 * - `parseSynthesisPlan` is JSON.parse + `validateSynthesisPlanDetailed`; on
 *   failure it throws a SINGLE `PlanSerializationError` whose message joins
 *   every path-qualified validation error (so the caller sees the whole
 *   picture, not just the first).
 * - Round-trip byte-stability (the binding contract): for a valid plan p,
 *   `serialize(parse(serialize(p))) === serialize(p)`. This holds because
 *   canonical JSON is a function of VALUE only (insertion order of keys never
 *   leaks into the output) and JSON.parse reconstructs values faithfully.
 *
 * There is deliberately NO fs persistence here (unlike @clapp/ir's
 * saveIrModel/loadIrModel): the plan is handed to @clapp/codegen and
 * @clapp/gentests in-process in v0.1, and adding an fs surface now would be
 * speculative. An ADR can add it when a consumer actually needs it.
 */

import { canonicalJson } from '@clapp/ir';
import type { SynthesisPlan } from './synthesis-contract';
import { validateSynthesisPlanDetailed } from './validate';

/** Thrown when a plan cannot be serialized or parsed. */
export class PlanSerializationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlanSerializationError';
  }
}

function joinErrors(errors: readonly string[]): string {
  return errors.length === 1 ? (errors[0] ?? '') : errors.map((e) => `- ${e}`).join('\n');
}

/**
 * Canonical JSON text of `plan`. Throws {@link PlanSerializationError} when
 * the plan fails validation (never serialize an invalid plan — the validation
 * pass already probes canonical-JSON serializability, so in practice the
 * validation error surfaces first).
 */
export function serializeSynthesisPlan(plan: SynthesisPlan): string {
  const result = validateSynthesisPlanDetailed(plan);
  if (!result.valid) {
    throw new PlanSerializationError(
      `cannot serialize an invalid SynthesisPlan (${result.errors.length} validation error(s)):\n${joinErrors(result.errors)}`,
    );
  }
  try {
    return canonicalJson(plan);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PlanSerializationError(`SynthesisPlan is not canonical-JSON serializable: ${message}`);
  }
}

/**
 * Parse canonical (or any) JSON text into a validated `SynthesisPlan`.
 * Throws a single {@link PlanSerializationError} — with every path-qualified
 * violation joined into the message — when the text is not valid JSON or
 * does not validate as a SynthesisPlan v0.1.
 */
export function parseSynthesisPlan(text: string): SynthesisPlan {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PlanSerializationError(`text is not valid JSON: ${message}`);
  }
  const result = validateSynthesisPlanDetailed(parsed);
  if (!result.valid) {
    throw new PlanSerializationError(
      `parsed value is not a valid SynthesisPlan v0.1 (${result.errors.length} validation error(s)):\n${joinErrors(result.errors)}`,
    );
  }
  return parsed as SynthesisPlan;
}
