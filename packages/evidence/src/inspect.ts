/**
 * Internal shared inspection helpers (NOT exported from the package root).
 *
 * Total over untrusted input: none of these ever throw, so callers can use
 * them inside validators and error-mapping paths where a crash would turn a
 * corruption report into a stack trace.
 */

/** Structural check for a JSON-object-shaped value (arrays excluded). */
export function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Non-throwing preview of an observed value for violation messages. */
export function preview(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  try {
    return String(value);
  } catch {
    return '<unprintable>';
  }
}

/** Error message extraction that never throws. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
