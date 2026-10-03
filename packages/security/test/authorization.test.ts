// CLAPP-070 — the authorized-session boundary tests.
//
// Eight named tests over the frozen §1 vocabulary: admission determinism,
// fail-closed statement validation (never an exception), the five-kind
// coverage, the boundary's distrust of malformed sessions, the per-target
// law (BOTH identifiers named on refusal), honest refusal facts for
// malformed targets, content-addressed identities (any statement change
// moves the id), and the caller-injected/clock-free grantedAt proof.

import { describe, expect, test } from 'bun:test';

import {
  AUTHZ_ID_PATTERN,
  AUTHZ_VERSION,
  assertObservationAuthorized,
  createAuthorizedSession,
} from '../src/authorization';
import type { AuthorizationSession, AuthorizationStatement } from '../src/authorization';
import {
  FIVE_KINDS,
  GRANTED_AT_A,
  GRANTED_AT_B,
  STATEMENTS_BY_KIND,
  TARGET_A,
  TARGET_B,
  statement,
} from './fixtures/authorization-fixtures';

describe('the authorized-session boundary (CLAPP-070)', () => {
  test('session admission is deterministic — identical statements produce identical sessions', async () => {
    const input = statement();
    const inputSnapshot: AuthorizationStatement = JSON.parse(JSON.stringify(input));
    const first = await createAuthorizedSession(input);
    // a structurally identical but DISTINCT object admits the identical session
    const second = await createAuthorizedSession(statement());
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.session).toEqual(first.session); // deep-equal sessions
      expect(second.session.sessionId).toBe(first.session.sessionId); // identical authz_ id
      expect(second.session.sessionId).toMatch(AUTHZ_ID_PATTERN);
      expect(second.session.authzVersion).toBe(AUTHZ_VERSION);
    }
    // the module never mutates its inputs — the statement is byte-identical after admission
    expect(input).toEqual(inputSnapshot);
  });

  test('malformed statements fail closed with named errors — never an exception', async () => {
    const cases: ReadonlyArray<[input: unknown, field: string, fragment: string]> = [
      // a non-object, then a null statement
      ['not-a-statement', 'statement', 'expected an object'],
      [null, 'statement', 'expected an object'],
      // an unknown kind (the observed value is listed in the error)
      [statement({ authorizationKind: 'public-domain' }), 'authorizationKind', 'public-domain'],
      // the three string fields, each emptied
      [statement({ targetIdentifier: '' }), 'targetIdentifier', 'expected a non-empty string'],
      [statement({ ownerIdentity: '' }), 'ownerIdentity', 'expected a non-empty string'],
      [statement({ grantReference: '' }), 'grantReference', 'expected a non-empty string'],
      // a non-RFC3339 grantedAt, then the 2026-02-30-style rollover date
      [statement({ grantedAt: 'not-a-date' }), 'grantedAt', 'RFC3339'],
      [statement({ grantedAt: '2026-02-30T00:00:00Z' }), 'grantedAt', 'RFC3339'],
    ];
    for (const [input, field, fragment] of cases) {
      // a throw would reject this await and fail the test — never an exception
      const result = await createAuthorizedSession(input);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors.some((e) => e.startsWith(`${field}:`))).toBe(true);
        expect(result.errors.some((e) => e.includes(fragment))).toBe(true);
      }
    }
    // ALL errors are collected — a triple-defect statement names all three fields
    const multi = await createAuthorizedSession({
      authorizationKind: 'guessed',
      targetIdentifier: '',
      grantedAt: '2026-02-30T00:00:00Z',
    });
    expect(multi.ok).toBe(false);
    if (!multi.ok) {
      expect(multi.errors.some((e) => e.startsWith('authorizationKind:'))).toBe(true);
      expect(multi.errors.some((e) => e.startsWith('targetIdentifier:'))).toBe(true);
      expect(multi.errors.some((e) => e.startsWith('grantedAt:'))).toBe(true);
    }
  });

  test('all five §1 authorization kinds admit sessions', async () => {
    // the fixture vocabulary is exactly the five frozen §1 kinds
    expect(Object.keys(STATEMENTS_BY_KIND).sort()).toEqual([...FIVE_KINDS].sort());
    for (const kind of FIVE_KINDS) {
      const result = await createAuthorizedSession(STATEMENTS_BY_KIND[kind]);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.session.statement.authorizationKind).toBe(kind);
        expect(result.session.statement).toEqual(STATEMENTS_BY_KIND[kind]); // verbatim
        expect(result.session.scopes).toEqual(['observe']); // observation-only
        expect(result.session.authzVersion).toBe(AUTHZ_VERSION);
        expect(result.session.sessionId).toMatch(AUTHZ_ID_PATTERN);
      }
    }
    // distinct kinds mint distinct content-addressed ids
    const ids = new Set<string>();
    for (const kind of FIVE_KINDS) {
      const result = await createAuthorizedSession(STATEMENTS_BY_KIND[kind]);
      if (result.ok) ids.add(result.session.sessionId);
    }
    expect(ids.size).toBe(FIVE_KINDS.length);
  });

  test('the boundary refuses without a well-formed session — everything is distrusted', async () => {
    const admitted = await createAuthorizedSession(statement());
    expect(admitted.ok).toBe(true);
    if (!admitted.ok) throw new Error('fixture admission unexpectedly failed');
    const session: AuthorizationSession = admitted.session;

    const refused: ReadonlyArray<[candidate: unknown, fragment: string]> = [
      // no session at all (undefined, null), then an array masquerading as one
      [undefined, 'session: expected an AuthorizationSession object'],
      [null, 'session: expected an AuthorizationSession object'],
      [[session], 'session: expected an AuthorizationSession object'],
      // a session that is structurally present but WRONG
      [{ ...session, authzVersion: '0.2' }, 'authzVersion'],
      [{ ...session, sessionId: 'not-an-id' }, 'sessionId'],
      [{ ...session, sessionId: undefined }, 'sessionId'],
      // scopes that are not exactly ['observe'] (widened / emptied / non-array / case-mangled)
      [{ ...session, scopes: ['observe', 'execute'] }, 'scopes'],
      [{ ...session, scopes: [] }, 'scopes'],
      [{ ...session, scopes: 'observe' }, 'scopes'],
      [{ ...session, scopes: ['Observe'] }, 'scopes'],
      // malformed statements inside a structurally present session
      [{ ...session, statement: 'not-an-object' }, 'statement'],
      [{ ...session, statement: statement({ authorizationKind: 'guessed' }) }, 'authorizationKind'],
      [{ ...session, statement: statement({ targetIdentifier: '' }) }, 'targetIdentifier'],
    ];
    for (const [candidate, fragment] of refused) {
      // a throw would fail this test — never an exception
      const verdict = assertObservationAuthorized(candidate, TARGET_A);
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) {
        expect(verdict.reason.length).toBeGreaterThan(0);
        expect(verdict.reason.includes(fragment)).toBe(true);
      }
    }
    // the untampered session still passes (the control)
    const control = assertObservationAuthorized(session, TARGET_A);
    expect(control.ok).toBe(true);
  });

  test('the boundary is per-target — a statement for one app never authorizes another', async () => {
    const result = await createAuthorizedSession(statement({ targetIdentifier: TARGET_A }));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('fixture admission unexpectedly failed');
    const session = result.session;

    // a session for target A asserted against target B → refused with BOTH named
    const cross = assertObservationAuthorized(session, TARGET_B);
    expect(cross.ok).toBe(false);
    if (!cross.ok) {
      expect(cross.reason.includes(TARGET_A)).toBe(true);
      expect(cross.reason.includes(TARGET_B)).toBe(true);
    }

    // asserted against A → ok with the sessionId carried
    const own = assertObservationAuthorized(session, TARGET_A);
    expect(own.ok).toBe(true);
    if (own.ok) {
      expect(own.sessionId).toBe(session.sessionId);
      expect(own.targetIdentifier).toBe(TARGET_A);
    }
  });

  test('boundary refusals name the observed facts — empty or non-string targets refuse honestly', async () => {
    const result = await createAuthorizedSession(statement());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('fixture admission unexpectedly failed');
    const session = result.session;

    for (const target of ['', 42, null]) {
      // a throw would fail this test — never an exception
      const verdict = assertObservationAuthorized(session, target);
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) {
        expect(verdict.reason.length).toBeGreaterThan(0);
        expect(verdict.reason.startsWith('targetIdentifier:')).toBe(true); // the field is named
      }
    }
  });

  test('session ids are content-addressed — any statement change moves the id', async () => {
    const baseline = await createAuthorizedSession(statement());
    const changed = await createAuthorizedSession(
      statement({ grantReference: 'permission/letter-2026-10-01' }),
    );
    expect(baseline.ok).toBe(true);
    expect(changed.ok).toBe(true);
    if (baseline.ok && changed.ok) {
      // the grant change moves the id
      expect(changed.session.sessionId).toMatch(AUTHZ_ID_PATTERN);
      expect(changed.session.sessionId).not.toBe(baseline.session.sessionId);
      // the statement is carried verbatim — only the changed field differs
      expect(changed.session.statement.grantReference).not.toBe(baseline.session.statement.grantReference);
      expect(changed.session.statement.targetIdentifier).toBe(baseline.session.statement.targetIdentifier);
      expect(changed.session.statement.authorizationKind).toBe(baseline.session.statement.authorizationKind);
      expect(changed.session.statement.ownerIdentity).toBe(baseline.session.statement.ownerIdentity);
      // the unchanged kind/target/owner keep the boundary verdict byte-stable:
      // both sessions authorize the SAME target, and the verdict is identical
      // in every byte except the content-addressed sessionId each echoes
      // (the id moved with the grant — the decision did not)
      const verdictA = assertObservationAuthorized(baseline.session, TARGET_A);
      const verdictB = assertObservationAuthorized(changed.session, TARGET_A);
      expect(verdictA.ok).toBe(true);
      expect(verdictB.ok).toBe(true);
      if (verdictA.ok && verdictB.ok) {
        expect(verdictB.targetIdentifier).toBe(verdictA.targetIdentifier);
        expect(verdictA.sessionId).toBe(baseline.session.sessionId);
        expect(verdictB.sessionId).toBe(changed.session.sessionId);
        expect(verdictB.sessionId).not.toBe(verdictA.sessionId);
        // byte-stable modulo the echoed id: the verdict minus sessionId is byte-identical
        expect(JSON.stringify({ ...verdictA, sessionId: undefined })).toBe(
          JSON.stringify({ ...verdictB, sessionId: undefined }),
        );
      }
    }
  });

  test('grantedAt is caller-injected and validated — the module never reads a clock', async () => {
    const first = await createAuthorizedSession(statement({ grantedAt: GRANTED_AT_A }));
    const second = await createAuthorizedSession(statement({ grantedAt: GRANTED_AT_B }));
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      // the timestamp is content: a different grantedAt moves the id
      expect(second.session.sessionId).not.toBe(first.session.sessionId);
      expect(first.session.statement.grantedAt).toBe(GRANTED_AT_A);
      expect(second.session.statement.grantedAt).toBe(GRANTED_AT_B);
      // the boundary verdict is identical for both (the check is clock-free):
      // both authorize the SAME target with the identical decision — the
      // verdicts' sessionId fields necessarily differ, being content-addressed
      // over the different grantedAt values
      const verdictA = assertObservationAuthorized(first.session, TARGET_A);
      const verdictB = assertObservationAuthorized(second.session, TARGET_A);
      expect(verdictA.ok).toBe(true);
      expect(verdictB.ok).toBe(true);
      if (verdictA.ok && verdictB.ok) {
        expect(verdictB.ok).toBe(verdictA.ok);
        expect(verdictB.targetIdentifier).toBe(verdictA.targetIdentifier);
      }
    }
    // and the module never reads a clock: grantedAt must come from the caller —
    // a calendar-invalid timestamp (month 13) is refused, named
    const invalid = await createAuthorizedSession(statement({ grantedAt: '2026-13-01T00:00:00Z' }));
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) {
      expect(invalid.errors.some((e) => e.startsWith('grantedAt:'))).toBe(true);
    }
  });
});
