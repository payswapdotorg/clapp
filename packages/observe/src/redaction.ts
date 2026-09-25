/**
 * @clapp/observe — redaction policy (CLAPP security foundation).
 *
 * Scrubs secret-shaped values from text and payloads BEFORE they enter a
 * CaptureRecord (the contract's `redacted` flag means: the redaction pass
 * ran with an active policy before the record reached the recorder — it
 * does NOT claim that secret-shaped content was found; see README).
 *
 * Design posture — over-redaction is safe, under-redaction is a leak:
 *  - value-shape rules match tokens that LOOK like credentials (JWTs,
 *    bearer schemes, 32+ hex blobs, prefixed api keys, emails);
 *  - a long hex digest (e.g. a sha256) WILL be scrubbed by the hex rule —
 *    acceptable: observation evidence does not need raw hashes;
 *  - key-shape rules replace the VALUE of any secret-named field
 *    (authorization, cookie, token, password, ...) wholesale;
 *  - URL credential userinfo and secret query parameters are scrubbed
 *    while preserving the rest of the URL for behavioral fidelity.
 *
 * Determinism: rules apply in a fixed order (documented below) and every
 * regex is global + left-to-right, so identical inputs always produce
 * identical outputs.
 *
 * Honest limitation: redaction is pattern-based; a secret that does not
 * match any shape and does not sit under a secret-named key will pass
 * through. Pixel content of screenshots CANNOT be redacted at all — the
 * screenshot channel is marked non-redactable and fixture apps must not
 * render secret material.
 */

import { isPlainObject } from './canonical-json';

/** Configurable redaction policy. Every scrub rule can be turned off. */
export interface RedactionPolicy {
  /** scrub email-shaped strings (default true) */
  scrubEmails: boolean;
  /** scrub token-shaped strings: bearer schemes, JWTs, prefixed keys, 32+ hex blobs (default true) */
  scrubTokens: boolean;
  /** replace values of secret-named keys wholesale (default true) */
  scrubSecretKeys: boolean;
  /** scrub `user:pass@` URL userinfo (default true) */
  scrubUrlCredentials: boolean;
  /** scrub secret query parameter values like `?token=...` (default true) */
  scrubQuerySecrets: boolean;
  /** replace cookie VALUES (keeping names) when building cookie inventories (default true) */
  scrubCookieValues: boolean;
  /** literal replacement inserted for scrubbed content (default '[REDACTED]') */
  replacement: string;
  /** caller-supplied extra patterns, applied after the built-ins (default none) */
  extraPatterns: RegExp[];
}

/** The default policy: every scrub rule active, `[REDACTED]` replacement. */
export function defaultRedactionPolicy(): RedactionPolicy {
  return {
    scrubEmails: true,
    scrubTokens: true,
    scrubSecretKeys: true,
    scrubUrlCredentials: true,
    scrubQuerySecrets: true,
    scrubCookieValues: true,
    replacement: '[REDACTED]',
    extraPatterns: [],
  };
}

/** True when at least one scrubbing rule is active (drives CaptureRecord.redacted). */
export function policyIsActive(policy: RedactionPolicy): boolean {
  return (
    policy.scrubEmails ||
    policy.scrubTokens ||
    policy.scrubSecretKeys ||
    policy.scrubUrlCredentials ||
    policy.scrubQuerySecrets ||
    policy.scrubCookieValues ||
    policy.extraPatterns.length > 0
  );
}

/** Result of a redaction pass: the (possibly unchanged) value + whether anything changed. */
export interface RedactionResult {
  value: unknown;
  changed: boolean;
}

// ---------------------------------------------------------------------------
// Patterns — fixed application order (url credentials → query secrets →
// auth schemes → JWTs → prefixed keys → hex blobs → emails → extras).
// ---------------------------------------------------------------------------

const URL_CREDENTIALS_RE = /([A-Za-z][A-Za-z0-9+.-]*:\/\/)([^/?#\s:]+):([^@/?#\s]+)@/g;

const QUERY_SECRET_KEYS = 'token|api_key|apikey|access_token|refresh_token|secret|signature|password|client_secret|session';
const QUERY_SECRET_RE = new RegExp(`([?&])(${QUERY_SECRET_KEYS})=([^&\\s]+)`, 'gi');

const AUTH_SCHEME_RE = /\b(?:Bearer|Basic|Token)\s+[A-Za-z0-9\-._~+/]+=*/gi;

const JWT_RE = /\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\b/g;

const PREFIXED_KEY_RE = /\b(?:sk|pk|rk|api|auth|pat)_[A-Za-z0-9]{12,}\b/g;

const HEX_BLOB_RE = /\b[0-9a-fA-F]{32,}\b/g;

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;

const SECRET_KEY_RE =
  /^(?:authorization|proxy-authorization|cookie|set-cookie|token|access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|apikey|secret|client[_-]?secret|password|passwd|pwd|session|sessionid|session[_-]?id|bearer|credentials?|private[_-]?key)$/i;

/**
 * Scrubs one string. Returns the scrubbed value and whether it changed.
 * All rules are idempotent — scrubbing already-scrubbed text is a no-op,
 * so a second pass over a payload (defense in depth) is harmless.
 */
export function scrubString(text: string, policy: RedactionPolicy): { value: string; changed: boolean } {
  let out = text;
  if (policy.scrubUrlCredentials) {
    out = out.replace(URL_CREDENTIALS_RE, (_match, scheme: string) => `${scheme}${policy.replacement}@`);
  }
  if (policy.scrubQuerySecrets) {
    out = out.replace(QUERY_SECRET_RE, (_match, sep: string, key: string) => `${sep}${key}=${policy.replacement}`);
  }
  if (policy.scrubTokens) {
    out = out.replace(AUTH_SCHEME_RE, () => policy.replacement);
    out = out.replace(JWT_RE, () => policy.replacement);
    out = out.replace(PREFIXED_KEY_RE, () => policy.replacement);
    out = out.replace(HEX_BLOB_RE, () => policy.replacement);
  }
  if (policy.scrubEmails) {
    out = out.replace(EMAIL_RE, () => policy.replacement);
  }
  for (const pattern of policy.extraPatterns) {
    out = out.replace(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g'), () => policy.replacement);
  }
  return { value: out, changed: out !== text };
}

/** Convenience: scrub a string, returning only the value. */
export function scrubText(text: string, policy: RedactionPolicy): string {
  return scrubString(text, policy).value;
}

/**
 * Deep redaction over a payload: strings get pattern-scrubbed, secret-named
 * keys get their values replaced wholesale, arrays and plain objects are
 * walked. Non-plain objects pass through untouched (canonicalization will
 * reject them loudly if they ever reach a record). Cycles collapse to the
 * replacement marker rather than looping forever.
 */
export function redactValue(value: unknown, policy: RedactionPolicy): RedactionResult {
  let changed = false;
  const seen = new WeakSet<object>();

  const walk = (input: unknown): unknown => {
    if (typeof input === 'string') {
      const result = scrubString(input, policy);
      if (result.changed) {
        changed = true;
        return result.value;
      }
      return input;
    }
    if (input === null || typeof input !== 'object') {
      return input;
    }
    if (seen.has(input)) {
      changed = true;
      return policy.replacement;
    }
    seen.add(input);

    if (Array.isArray(input)) {
      return input.map((element) => walk(element));
    }
    if (!isPlainObject(input)) {
      return input;
    }
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(input)) {
      const inner = input[key];
      if (policy.scrubSecretKeys && SECRET_KEY_RE.test(key) && inner !== undefined && inner !== null && inner !== '') {
        out[key] = policy.replacement;
        changed = true;
        continue;
      }
      out[key] = walk(inner);
    }
    return out;
  };

  return { value: walk(value), changed };
}

/**
 * Redacts the VALUES of a raw cookie string ("a=1; b=2"), keeping names.
 * Cookie values are session-shaped by default, so wholesale value
 * replacement is the honest posture (used by the storage inventory).
 */
export function redactCookieString(cookieString: string, policy: RedactionPolicy): string {
  if (!policy.scrubCookieValues) {
    return cookieString;
  }
  return cookieString
    .split(';')
    .map((part) => {
      const eq = part.indexOf('=');
      if (eq < 0) return part.trim();
      const name = part.slice(0, eq).trim();
      const value = part.slice(eq + 1).trim();
      return value === '' ? `${name}=` : `${name}=${policy.replacement}`;
    })
    .join('; ');
}
