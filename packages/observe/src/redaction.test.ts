// CLAPP-010 unit tests — redaction policy.
//
// Constitution: fake credentials are ASSEMBLED AT RUNTIME from fragments —
// no secret-shaped literals in this file.

import { describe, expect, test } from 'bun:test';
import {
  defaultRedactionPolicy,
  policyIsActive,
  redactCookieString,
  redactValue,
  scrubString,
  type RedactionPolicy,
} from './redaction';

// --- runtime-assembled fake secrets (never whole literals) ---
const fakeEmail = ['worker', '.', 'one', '@', 'clapp-fixture', '.', 'example'].join('');
const fakeJwt = ['eyJhbGciOiJIUzI1NiIsInR5c3VhbHQifQ', '.', 'eyJzdWIiOiJmaXh0dXJlIn0', '.', 'ZmFrZXNpZ25hdHVyZQ'].join('');
const fakeBearer = ['Bearer ', 'abc123', 'def456', '_ghi789'].join('');
const fakeHex = ['0a1b2c3d4e5f', '60718293a4b5', 'c6d7e8f90123', '456789abcdef'].join('');
const fakePrefixed = ['sk', '_', 'live4x9m2p7q1z'].join('');
const replacement = defaultRedactionPolicy().replacement;

describe('scrubString — value-shape rules', () => {
  test('emails are scrubbed', () => {
    const text = `contact ${fakeEmail} for details`;
    const result = scrubString(text, defaultRedactionPolicy());
    expect(result.value).toBe(`contact ${replacement} for details`);
    expect(result.changed).toBe(true);
  });

  test('JWT-shaped strings are scrubbed (three base64url segments, eyJ head)', () => {
    expect(scrubString(`token=${fakeJwt}`, defaultRedactionPolicy()).value).toBe(`token=${replacement}`);
  });

  test('Bearer/Basic scheme credentials are scrubbed', () => {
    expect(scrubString(`Authorization: ${fakeBearer}`, defaultRedactionPolicy()).value).toBe(
      `Authorization: ${replacement}`,
    );
  });

  test('32+ char hex blobs are scrubbed (over-redaction by design)', () => {
    expect(scrubString(`digest ${fakeHex}`, defaultRedactionPolicy()).value).toBe(`digest ${replacement}`);
  });

  test('prefixed api keys (sk_/api_/...) are scrubbed', () => {
    expect(scrubString(`key: ${fakePrefixed}`, defaultRedactionPolicy()).value).toBe(`key: ${replacement}`);
  });

  test('benign text passes through unchanged', () => {
    const text = 'the quick brown fox jumps over 13 lazy dogs';
    const result = scrubString(text, defaultRedactionPolicy());
    expect(result.value).toBe(text);
    expect(result.changed).toBe(false);
  });

  test('scrubbing is idempotent (already-scrubbed text is stable)', () => {
    const once = scrubString(`user ${fakeEmail} token ${fakeJwt}`, defaultRedactionPolicy()).value;
    expect(scrubString(once, defaultRedactionPolicy()).value).toBe(once);
  });
});

describe('scrubString — URL-aware rules', () => {
  test('URL userinfo (user AND password) is scrubbed whole, URL structure preserved', () => {
    // userinfo as a whole is credential-shaped: over-redaction is safe
    const text = 'https://admin:hunter2@example.test/path';
    const result = scrubString(text, defaultRedactionPolicy());
    expect(result.value).toBe(`https://${replacement}@example.test/path`);
  });

  test('secret query parameter values are scrubbed, other params preserved', () => {
    const text = 'https://api.example.test/v1?token=abc123xyz456&page=2';
    const result = scrubString(text, defaultRedactionPolicy());
    expect(result.value).toBe(`https://api.example.test/v1?token=${replacement}&page=2`);
  });
});

describe('scrubString — policy flags', () => {
  test('scrubEmails=false keeps emails', () => {
    const policy = { ...defaultRedactionPolicy(), scrubEmails: false };
    expect(scrubString(`mail ${fakeEmail}`, policy).value).toBe(`mail ${fakeEmail}`);
  });

  test('scrubTokens=false keeps token-shaped strings', () => {
    const policy = { ...defaultRedactionPolicy(), scrubTokens: false };
    expect(scrubString(`jwt ${fakeJwt}`, policy).value).toBe(`jwt ${fakeJwt}`);
  });

  test('extraPatterns are applied after built-ins', () => {
    const policy = { ...defaultRedactionPolicy(), extraPatterns: [/\bCLAPP-SECRET-\d+\b/g] };
    const result = scrubString('leak CLAPP-SECRET-999 here', policy);
    expect(result.value).toBe(`leak ${replacement} here`);
  });

  test('policyIsActive reflects any active rule', () => {
    const allOff: RedactionPolicy = {
      ...defaultRedactionPolicy(),
      scrubEmails: false,
      scrubTokens: false,
      scrubSecretKeys: false,
      scrubUrlCredentials: false,
      scrubQuerySecrets: false,
      scrubCookieValues: false,
      extraPatterns: [],
    };
    expect(policyIsActive(defaultRedactionPolicy())).toBe(true);
    expect(policyIsActive(allOff)).toBe(false);
    expect(policyIsActive({ ...allOff, scrubEmails: true })).toBe(true);
    expect(policyIsActive({ ...allOff, extraPatterns: [/x/g] })).toBe(true);
  });
});

describe('redactValue — deep walk', () => {
  test('strings inside nested objects and arrays are scrubbed', () => {
    const payload = { user: { email: fakeEmail, tokens: [fakeJwt, 'ok'] }, note: 'plain' };
    const result = redactValue(payload, defaultRedactionPolicy());
    expect(result.value).toEqual({ user: { email: replacement, tokens: [replacement, 'ok'] }, note: 'plain' });
    expect(result.changed).toBe(true);
  });

  test('secret-named keys have their values replaced wholesale (any type)', () => {
    const payload = { headers: { authorization: 'Basic abc', 'x-trace': 'keep' }, password: 12345, ok: true };
    const result = redactValue(payload, defaultRedactionPolicy());
    const value = result.value as typeof payload;
    expect(value.headers['authorization']).toBe(replacement);
    expect(value.headers['x-trace']).toBe('keep');
    expect(value.password as unknown as string).toBe(replacement);
  });

  test('empty/null secret-named values are left alone (nothing to hide)', () => {
    const payload = { token: '', secret: null, password: undefined };
    const result = redactValue(payload, defaultRedactionPolicy());
    const value = result.value as typeof payload;
    expect(value.token).toBe('');
    expect(value.secret).toBeNull();
  });

  test('scrubSecretKeys=false keeps secret-named values', () => {
    const policy = { ...defaultRedactionPolicy(), scrubSecretKeys: false };
    const result = redactValue({ api_key: 'abcdefgh12345678' }, policy);
    expect((result.value as { api_key: string }).api_key).toBe('abcdefgh12345678');
  });

  test('cycles collapse to the replacement instead of hanging', () => {
    const cyclic: Record<string, unknown> = { name: fakeEmail };
    cyclic['self'] = cyclic;
    const result = redactValue(cyclic, defaultRedactionPolicy());
    const value = result.value as Record<string, unknown>;
    expect(value['name']).toBe(replacement);
    expect(value['self']).toBe(replacement);
  });

  test('primitives pass through untouched', () => {
    expect(redactValue(42, defaultRedactionPolicy()).value).toBe(42);
    expect(redactValue(null, defaultRedactionPolicy()).value).toBeNull();
    expect(redactValue(true, defaultRedactionPolicy()).value).toBe(true);
  });
});

describe('redactCookieString', () => {
  test('values replaced, names and pair structure kept', () => {
    const raw = 'theme=dark; fixture_session=abc123def456; empty=';
    const result = redactCookieString(raw, defaultRedactionPolicy());
    expect(result).toBe(`theme=${replacement}; fixture_session=${replacement}; empty=`);
  });

  test('scrubCookieValues=false keeps values verbatim', () => {
    const policy = { ...defaultRedactionPolicy(), scrubCookieValues: false };
    expect(redactCookieString('a=b', policy)).toBe('a=b');
  });
});
