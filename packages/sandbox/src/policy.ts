/**
 * @clapp/sandbox — network policy helpers.
 *
 * The default posture of the platform is deny-all; allowlist/allow-all are
 * explicit opt-ins that must be justified by the caller. See the package
 * README ("Network policy — honest status") for what is and is not enforced
 * in v0.
 */

import type { NetworkPolicy } from './types';

/**
 * Returns the platform's default network posture: deny-all.
 * This is the posture every ExecutionProfile should be built from unless a
 * caller has an explicit, reviewed reason to open egress.
 */
export function defaultDenyAllNetwork(): NetworkPolicy {
  return { mode: 'deny-all' };
}
