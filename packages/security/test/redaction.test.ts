// CLAPP-071 — the secret redaction tests.
//
// Eight named tests over the frozen §3 six-class vocabulary: determinism,
// the frozen rule table (in order, with its honest misses), fail-closed
// malformed roots and cycles (never an exception), visible non-reversible
// markers (raw values never ride into the report), the never-mutated
// input with verbatim non-sensitive values, honest nested/array path
// naming, measured counts and digests, and content-addressed report ids
// that move with ANY input change.

import { describe, expect, test } from 'bun:test';

import { REDACTION_VERSION, classifyFieldName, redactSensitiveFields } from '../src/redaction';
import type { RedactionReport, RedactionResult } from '../src/redaction';
import {
  cyclicEvidence,
  mixedEvidence,
  nestedEvidence,
  nothingSensitiveEvidence,
  sensitiveEvidence,
} from './fixtures/redaction-fixtures';
import type { MixedEvidence, NestedEvidence, SensitiveEvidence } from './fixtures/redaction-fixtures';

/** Unwraps an ok result (a refusal fails the test loudly, never silently). */
function unwrap(result: RedactionResult): RedactionReport {
  if (!result.ok) {
    throw new Error(`expected an ok redaction result, got errors: ${result.errors.join('; ')}`);
  }
  return result.report;
}

describe('secret redaction (CLAPP-071)', () => {
  test('redaction is deterministic — identical inputs produce identical reports', async () => {
    const input = sensitiveEvidence();
    const inputSnapshot: SensitiveEvidence = JSON.parse(JSON.stringify(input));
    const first = await redactSensitiveFields(input);
    // a structurally identical but DISTINCT object yields the identical report
    const second = await redactSensitiveFields(sensitiveEvidence());
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.report).toEqual(first.report); // deep-equal reports
      expect(second.report.id).toBe(first.report.id); // identical redct_ id
      expect(second.report.id.startsWith('redct_')).toBe(true);
      expect(second.report.redactionVersion).toBe(REDACTION_VERSION);
      expect(first.report.entries.length).toBeGreaterThan(0); // something fired
      // identical fingerprints, element-wise
      expect(second.report.entries.map((entry) => entry.marker)).toEqual(
        first.report.entries.map((entry) => entry.marker),
      );
    }
    // the engine never mutates its inputs — the evidence is unchanged after redaction
    expect(input).toEqual(inputSnapshot);
  });

  test('the six §3 classes classify by the frozen rule table in order', () => {
    // 1. cookies — the name IS 'cookie'/'cookies' or ends with either
    expect(classifyFieldName('cookie')).toBe('cookie');
    expect(classifyFieldName('cookies')).toBe('cookie');
    expect(classifyFieldName('session-cookie')).toBe('cookie');
    expect(classifyFieldName('SESSION-COOKIE')).toBe('cookie'); // case-insensitive
    // 2. authorization headers
    expect(classifyFieldName('authorization')).toBe('authorization-header');
    expect(classifyFieldName('Authorization')).toBe('authorization-header');
    expect(classifyFieldName('authorization-header')).toBe('authorization-header');
    // 3. bearer tokens
    expect(classifyFieldName('token')).toBe('bearer-token');
    expect(classifyFieldName('bearer')).toBe('bearer-token');
    expect(classifyFieldName('bearer-token')).toBe('bearer-token');
    expect(classifyFieldName('access-token')).toBe('bearer-token');
    expect(classifyFieldName('sessionToken')).toBe('bearer-token'); // ends with 'token'
    expect(classifyFieldName('apiToken')).toBe('bearer-token'); // ends with 'token'
    // 4. api keys — ORDER: 'secretKey' ends with 'key' → 'api-key' (it never
    //    reaches the 'password' rule)
    expect(classifyFieldName('key')).toBe('api-key');
    expect(classifyFieldName('apikey')).toBe('api-key');
    expect(classifyFieldName('api-key')).toBe('api-key');
    expect(classifyFieldName('apiKey')).toBe('api-key');
    expect(classifyFieldName('secretKey')).toBe('api-key');
    // 5. passwords
    expect(classifyFieldName('password')).toBe('password');
    expect(classifyFieldName('pass')).toBe('password');
    expect(classifyFieldName('userPassword')).toBe('password'); // ends with 'password'
    // 6. private user data
    expect(classifyFieldName('email')).toBe('private-user-data');
    expect(classifyFieldName('phone')).toBe('private-user-data');
    expect(classifyFieldName('ssn')).toBe('private-user-data');
    expect(classifyFieldName('address')).toBe('private-user-data');
    expect(classifyFieldName('birthdate')).toBe('private-user-data');
    expect(classifyFieldName('userEmail')).toBe('private-user-data'); // ends with 'email'
    // the honest misses — the classifier never guesses
    expect(classifyFieldName('value')).toBeNull();
    expect(classifyFieldName('name')).toBeNull();
    expect(classifyFieldName('route')).toBeNull();
    expect(classifyFieldName('title')).toBeNull();
  });

  test('malformed roots and cycles fail closed with named errors — never an exception', async () => {
    // a scalar root holds no fields to redact and the report contract demands
    // a walkable root — each refuses, named (a throw would reject this await
    // and fail the test: never an exception)
    const malformedRoots: ReadonlyArray<unknown> = [null, undefined, 'string', 42];
    for (const root of malformedRoots) {
      const result = await redactSensitiveFields(root);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.length).toBeGreaterThan(0);
        expect(
          result.errors.some((e) => e.startsWith('input: expected an object or array to walk, got')),
        ).toBe(true);
      }
    }
    // a cyclic input is detected and refused — no infinite loop, no crash
    // (completing this await at all is the no-hang proof)
    const cyclic = await redactSensitiveFields(cyclicEvidence());
    expect(cyclic.ok).toBe(false);
    if (!cyclic.ok) {
      expect(cyclic.errors.length).toBeGreaterThan(0);
      expect(cyclic.errors.some((e) => e.includes('cyclic'))).toBe(true);
    }
  });

  test('sensitive values become visible markers and never ride into the redacted copy', async () => {
    const input = { apiToken: 'sekret', password: 'hunter2' };
    const report = unwrap(await redactSensitiveFields(input));
    const redacted = report.redacted as { apiToken: string; password: string };
    // the copy carries the visible markers, kind named, fingerprint 8 hex chars
    expect(redacted.apiToken).toMatch(/^REDACTED:bearer-token:[0-9a-f]{8}$/);
    expect(redacted.password).toMatch(/^REDACTED:password:[0-9a-f]{8}$/);
    // distinct secrets → distinct fingerprints (with overwhelming probability)
    expect(redacted.apiToken).not.toBe(redacted.password);
    // the raw values appear NOWHERE in the serialized report
    const serialized = JSON.stringify(report);
    expect(serialized.includes('sekret')).toBe(false);
    expect(serialized.includes('hunter2')).toBe(false);
  });

  test('the input is never mutated and non-sensitive values ride verbatim', async () => {
    const input = mixedEvidence();
    const before: MixedEvidence = JSON.parse(JSON.stringify(input));
    const report = unwrap(await redactSensitiveFields(input));
    // the ORIGINAL is deep-unchanged — it still carries its raw values
    expect(input).toEqual(before);
    expect(input.password).toBe('hunter2');
    expect(input.apiKey).toBe('sk-live-4f0e');
    // the copy: non-sensitive fields ride verbatim, byte-identical
    const redacted = report.redacted as MixedEvidence;
    expect(redacted.sessionId).toBe(input.sessionId);
    expect(redacted.route).toBe(input.route);
    expect(redacted.title).toBe(input.title);
    expect(JSON.stringify(redacted.items)).toBe(JSON.stringify(input.items));
    expect(redacted.user.displayName).toBe(input.user.displayName);
    // and the sensitive fields are markers in the copy — only there
    expect(redacted.apiKey).toMatch(/^REDACTED:api-key:[0-9a-f]{8}$/);
    expect(redacted.password).toMatch(/^REDACTED:password:[0-9a-f]{8}$/);
  });

  test('nested paths and array indexes are named honestly in the entries', async () => {
    const input = nestedEvidence();
    const report = unwrap(await redactSensitiveFields(input));
    // exactly the two entries the contract names — in canonical path order
    expect(report.entries.map((entry) => entry.path)).toEqual([
      'cookies[0].sessionToken',
      'user.email',
    ]);
    const byPath = new Map(report.entries.map((entry) => [entry.path, entry] as const));
    expect(byPath.get('cookies[0].sessionToken')?.kind).toBe('bearer-token');
    expect(byPath.get('user.email')?.kind).toBe('private-user-data');
    // the markers carry their kind visibly
    expect(byPath.get('cookies[0].sessionToken')?.marker.startsWith('REDACTED:bearer-token:')).toBe(
      true,
    );
    expect(byPath.get('user.email')?.marker.startsWith('REDACTED:private-user-data:')).toBe(true);
    // and the redacted copy carries exactly those markers at those paths
    const cookieMarker = byPath.get('cookies[0].sessionToken')?.marker;
    const emailMarker = byPath.get('user.email')?.marker;
    if (cookieMarker === undefined || emailMarker === undefined) {
      throw new Error('fixture redaction entries unexpectedly missing');
    }
    const redacted = report.redacted as NestedEvidence;
    expect(redacted.cookies[0]!.sessionToken).toBe(cookieMarker);
    expect(redacted.user.email).toBe(emailMarker);
  });

  test('counts and digests are measured — the report proves the change', async () => {
    const report = unwrap(await redactSensitiveFields(sensitiveEvidence()));
    // countsByKind recomputed INDEPENDENTLY from the entries — measured, not asserted
    const recomputed: Record<string, number> = {};
    for (const entry of report.entries) {
      recomputed[entry.kind] = (recomputed[entry.kind] ?? 0) + 1;
    }
    expect(report.countsByKind).toEqual(recomputed);
    expect(report.entries.length).toBeGreaterThan(0);
    expect(Object.keys(report.countsByKind).length).toBeGreaterThan(0);
    // something was redacted → the MEASURED digests differ
    expect(report.originalDigest).not.toBe(report.redactedDigest);
    // the honest no-op: nothing sensitive → empty entries, EQUAL digests, {} counts
    const clean = unwrap(await redactSensitiveFields(nothingSensitiveEvidence()));
    expect(clean.entries).toEqual([]);
    expect(clean.countsByKind).toEqual({});
    expect(clean.originalDigest).toBe(clean.redactedDigest);
  });

  test('report ids are content-addressed — any input change moves the id', async () => {
    const baselineReport = unwrap(
      await redactSensitiveFields({ apiToken: 'sekret', password: 'hunter2', note: 'hello' }),
    );
    expect(baselineReport.id.startsWith('redct_')).toBe(true);
    // determinism anchor: a fresh, deep-equal input mints the identical id
    const rerunReport = unwrap(
      await redactSensitiveFields({ apiToken: 'sekret', password: 'hunter2', note: 'hello' }),
    );
    expect(rerunReport.id).toBe(baselineReport.id);
    // change one secret's VALUE → the fingerprint moves → the id moves
    const changedSecret = unwrap(
      await redactSensitiveFields({ apiToken: 'sekret2', password: 'hunter2', note: 'hello' }),
    );
    expect(changedSecret.id).not.toBe(baselineReport.id);
    const baselineToken = baselineReport.entries.find((entry) => entry.path === 'apiToken');
    const changedToken = changedSecret.entries.find((entry) => entry.path === 'apiToken');
    expect(changedToken?.marker).not.toBe(baselineToken?.marker);
    expect(changedToken?.marker.startsWith('REDACTED:bearer-token:')).toBe(true);
    // add a NON-sensitive field → the digests move → the id moves
    const addedField = unwrap(
      await redactSensitiveFields({
        apiToken: 'sekret',
        password: 'hunter2',
        note: 'hello',
        extra: 'visible',
      }),
    );
    expect(addedField.originalDigest).not.toBe(baselineReport.originalDigest);
    expect(addedField.redactedDigest).not.toBe(baselineReport.redactedDigest);
    expect(addedField.id).not.toBe(baselineReport.id);
  });
});
