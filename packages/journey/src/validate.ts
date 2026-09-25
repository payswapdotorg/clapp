/**
 * @clapp/journey — structural validation for Journey / JourneyAction /
 * TargetSelector (journey contract v0).
 *
 * Design notes (honest scope):
 * - Validation is STRUCTURAL: it checks that a value matches the declared
 *   TypeScript shapes so untrusted JSON can be narrowed safely. It does not
 *   judge whether a journey is semantically useful (e.g. an empty
 *   `actions` array, or a TargetSelector with no role/name/testId, are both
 *   structurally valid — the contract declares all selector fields
 *   optional; an empty selector simply matches every element and is left
 *   to the replayer's ambiguity rules).
 * - Extra properties beyond the declared fields are ALLOWED (forward
 *   compatibility with contract extensions); only declared fields are
 *   type-checked.
 * - `id` must match "journey_" + a uuid-shaped string (8-4-4-4-12 hex).
 *   The uuid version/variant bits are not pinned — any uuid-shaped hex is
 *   accepted, which keeps imported journeys from other v0 tools valid.
 * - Error messages are precise and path-qualified (`actions[2].target.nth`)
 *   so callers can point at the exact malformed field.
 */

import type { Journey, JourneyAction, TargetSelector } from './journey-contract';

/** Result of a detailed (non-predicate) journey validation. */
export interface JourneyValidationResult {
  valid: boolean;
  /** Path-qualified human-readable messages; empty iff valid. */
  errors: string[];
}

/** Shape enforced for `Journey.id`: "journey_" + uuid (8-4-4-4-12 hex). */
export const JOURNEY_ID_PATTERN =
  /^journey_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ACTION_TYPES = ['navigate', 'click', 'fill', 'press', 'wait', 'assert-visible'] as const;

export type JourneyActionType = (typeof ACTION_TYPES)[number];

const MAX_PREVIEW_CHARS = 60;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function kindOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function preview(value: unknown): string {
  // Strings are quoted so message readers can tell "" from null from undefined.
  const text = typeof value === 'string' ? JSON.stringify(value) : (JSON.stringify(value) ?? String(value));
  return text.length > MAX_PREVIEW_CHARS ? `${text.slice(0, MAX_PREVIEW_CHARS)}...` : text;
}

function requireString(
  container: Record<string, unknown>,
  field: string,
  errors: string[],
  options: { nonEmpty?: boolean; prefix?: string } = {},
): void {
  const label = options.prefix ?? field;
  const value = container[field];
  if (typeof value !== 'string') {
    errors.push(`${label}: expected a string, got ${kindOf(value)}`);
    return;
  }
  if (options.nonEmpty === true && value.trim() === '') {
    errors.push(`${label}: expected a non-empty string, got ${JSON.stringify(value)}`);
  }
}

// ---------------------------------------------------------------------------
// TargetSelector
// ---------------------------------------------------------------------------

/**
 * Validates a TargetSelector structurally. Returns path-qualified messages
 * relative to the selector itself (e.g. `nth: expected a non-negative
 * integer, got -1`).
 */
export function validateTargetSelector(target: unknown): string[] {
  return targetSelectorErrors(target, '');
}

function targetSelectorErrors(target: unknown, prefix: string): string[] {
  const errors: string[] = [];
  const at = (field: string): string => (prefix === '' ? field : `${prefix}.${field}`);
  if (!isObject(target)) {
    errors.push(
      prefix === ''
        ? `expected a non-null object, got ${kindOf(target)}`
        : `${prefix}: expected a non-null object, got ${kindOf(target)}`,
    );
    return errors;
  }
  for (const field of ['role', 'name', 'testId'] as const) {
    const value = target[field];
    if (value !== undefined && typeof value !== 'string') {
      errors.push(`${at(field)}: expected a string, got ${kindOf(value)}`);
    }
  }
  const nth = target['nth'];
  if (nth !== undefined) {
    if (typeof nth !== 'number') {
      errors.push(`${at('nth')}: expected a number, got ${kindOf(nth)}`);
    } else if (!Number.isInteger(nth) || nth < 0) {
      errors.push(`${at('nth')}: expected a non-negative integer, got ${preview(nth)}`);
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// JourneyAction
// ---------------------------------------------------------------------------

/**
 * Validates a single JourneyAction structurally. Returns path-qualified
 * messages relative to the action itself (e.g. `target.name: expected a
 * string, got number`).
 */
export function validateJourneyAction(action: unknown): string[] {
  return actionErrors(action, '');
}

function actionErrors(action: unknown, prefix: string): string[] {
  const errors: string[] = [];
  const at = (field: string): string => (prefix === '' ? field : `${prefix}.${field}`);
  if (!isObject(action)) {
    errors.push(
      prefix === ''
        ? `expected a non-null object, got ${kindOf(action)}`
        : `${prefix}: expected a non-null object, got ${kindOf(action)}`,
    );
    return errors;
  }
  const type = action['type'];
  if (typeof type !== 'string' || !(ACTION_TYPES as readonly string[]).includes(type)) {
    errors.push(`${at('type')}: expected one of ${ACTION_TYPES.join(' | ')}, got ${preview(type)}`);
    // Field shape depends on the type; a wrong type makes the remaining
    // fields meaningless, so validation stops here for this action.
    return errors;
  }
  switch (type as JourneyActionType) {
    case 'navigate':
      requireString(action, 'url', errors, { nonEmpty: true, prefix: at('url') });
      break;
    case 'click':
    case 'assert-visible':
      errors.push(...targetSelectorErrors(action['target'], at('target')));
      break;
    case 'fill':
      errors.push(...targetSelectorErrors(action['target'], at('target')));
      // Empty values are legitimate (clearing a field).
      requireString(action, 'value', errors, { prefix: at('value') });
      break;
    case 'press':
      requireString(action, 'key', errors, { nonEmpty: true, prefix: at('key') });
      break;
    case 'wait': {
      const ms = action['ms'];
      if (typeof ms !== 'number') {
        errors.push(`${at('ms')}: expected a number, got ${kindOf(ms)}`);
      } else if (!Number.isInteger(ms) || ms < 0) {
        errors.push(`${at('ms')}: expected a non-negative integer, got ${preview(ms)}`);
      }
      break;
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Journey
// ---------------------------------------------------------------------------

/** Detailed validation: collects every structural error with its path. */
export function validateJourneyDetailed(journey: unknown): JourneyValidationResult {
  const errors: string[] = [];
  if (!isObject(journey)) {
    errors.push(`journey: expected a non-null object, got ${kindOf(journey)}`);
    return { valid: false, errors };
  }
  const id = journey['id'];
  if (typeof id !== 'string') {
    errors.push(`id: expected a string, got ${kindOf(id)}`);
  } else if (!JOURNEY_ID_PATTERN.test(id)) {
    errors.push(`id: expected "journey_" + uuid (8-4-4-4-12 hex), got ${preview(id)}`);
  }
  requireString(journey, 'name', errors, { nonEmpty: true });
  requireString(journey, 'targetId', errors, { nonEmpty: true });
  const actions = journey['actions'];
  if (!Array.isArray(actions)) {
    errors.push(`actions: expected an array, got ${kindOf(actions)}`);
    return { valid: false, errors };
  }
  for (const [index, action] of actions.entries()) {
    errors.push(...actionErrors(action, `actions[${index}]`));
  }
  return { valid: errors.length === 0, errors };
}

/** Type-safe structural predicate for the journey contract v0. */
export function validateJourney(journey: unknown): journey is Journey {
  return validateJourneyDetailed(journey).valid;
}

// ---------------------------------------------------------------------------
// Compile-time shape witnesses (fail to compile if the contract drifts)
// ---------------------------------------------------------------------------

const _witnessAction: JourneyAction = { type: 'wait', ms: 0 };
const _witnessSelector: TargetSelector = {};
void _witnessAction;
void _witnessSelector;
