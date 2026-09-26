/**
 * @clapp/diffext — identifier helpers (CLAPP-041).
 *
 * DiffFinding ids are prefixed uuid v4 strings ("diff_" + uuid v4), per the
 * differential verification contract v0.1 mirror. Kept beside the mirror so
 * finding construction stays contract-shaped in one place.
 */

/** Fresh DiffFinding id: `"diff_" + uuid v4`. */
export function newDiffFindingId(): string {
  return `diff_${crypto.randomUUID()}`;
}
