/**
 * @clapp/repair — directive id minting (CLAPP-042).
 *
 * Directive ids follow the contract convention ("repd_" + uuid v4). The
 * factory is injectable (see clusterFindings / runRepairLoop) so callers
 * that need deterministic runs — tests, reproducibility tooling — can
 * supply a counter-based sequence; the default mints real uuid v4 ids via
 * WebCrypto (no dependency).
 */

/** Fresh directive id: `"repd_" + uuid v4`. */
export function newDirectiveId(): string {
  return `repd_${crypto.randomUUID()}`;
}

/** A directive id factory (determinism hook). */
export type DirectiveIdFactory = () => string;

/** A deterministic counting factory: repd_000001, repd_000002, … */
export function countingDirectiveIdFactory(prefix = 'repd_'): DirectiveIdFactory {
  let counter = 0;
  return () => {
    counter += 1;
    return `${prefix}${String(counter).padStart(6, '0')}`;
  };
}
