// CLAPP-073 — the audit trail and cancellation/resume tests.
//
// Eight named tests over the frozen seven-kind v0.1 vocabulary:
// determinism (identical events in any order → identical atrail_
// snapshots), fail-closed malformed events/options (never an exception),
// the append-only law (duplicates refused, the timestamp is content,
// ids recomputed independently), the honest state machine (running →
// cancelled → resumed → cancelled … with MEASURED counts), the illegal
// transitions refused with named reasons, the trail-and-state-machine
// move TOGETHER (exactly the cancelled/resumed events, facts asserted
// by recomputation), canonically-ordered defensively-copied listings
// with never-erroring queries, and content-addressed snapshots (the
// empty trail is valid, any change moves the id).

import { describe, expect, test } from 'bun:test';
import { sha256Hex } from '@clapp/core';
import { canonicalJson } from '@clapp/observe';

import {
  ATRAIL_SNAPSHOT_PATTERN,
  AUDIT_EVENT_ID_PATTERN,
  AUDIT_VERSION,
  createAuditTrail,
} from '../src/audit';
import type { AuditEvent, AuditResult, CancellableOperation, OperationResult } from '../src/audit';
import {
  ACTOR_A,
  ACTOR_B,
  CANCELLED_AT_A,
  CANCELLED_AT_B,
  FACTS_BY_KIND,
  OPERATION_ID_A,
  OPERATION_ID_B,
  RECORDED_AT_A,
  RECORDED_AT_B,
  RECORDED_AT_C,
  RESUMED_AT_A,
  RESUMED_AT_B,
  SEVEN_KINDS,
  SUBJECT_A,
  SUBJECT_B,
  cancelOptions,
  event,
  recordOptions,
  registerOptions,
  resumeOptions,
} from './fixtures/audit-fixtures';

/** Unwraps an ok record() result (a refusal fails the test loudly, never silently). */
function recorded(result: AuditResult): AuditEvent {
  if (!result.ok) {
    throw new Error(`expected an ok record result, got errors: ${result.errors.join('; ')}`);
  }
  return result.event;
}

/** Unwraps an ok operation result's operation record (a refusal fails the test loudly). */
function operationOf(result: OperationResult): CancellableOperation {
  if (!result.ok) {
    throw new Error(`expected an ok operation result, got errors: ${result.errors.join('; ')}`);
  }
  return result.operation;
}

/** Unwraps an ok cancel/resume result — the event and the operation record together. */
function transitionOf(result: OperationResult): { event: AuditEvent; operation: CancellableOperation } {
  if (result.ok) {
    if (result.event !== undefined) {
      return { event: result.event, operation: result.operation };
    }
    throw new Error('expected the ok transition to carry its recorded event — none present');
  }
  throw new Error(`expected an ok transition result, got errors: ${result.errors.join('; ')}`);
}

describe('the audit trail and cancellation state machine (CLAPP-073)', () => {
  test('the audit trail is deterministic — identical events in any order produce identical snapshots', async () => {
    expect(AUDIT_VERSION).toBe('0.1'); // the frozen v0.1 contract pin
    // the fixture vocabulary is exactly the seven frozen kinds
    expect(Object.keys(FACTS_BY_KIND).sort()).toEqual([...SEVEN_KINDS].sort());

    // three events, fixed content, fixed caller-injected timestamps
    const inputs = [
      event({ kind: 'session-admitted', actor: ACTOR_A, subject: SUBJECT_A, facts: FACTS_BY_KIND['session-admitted'] }),
      event({ kind: 'redaction-applied', actor: ACTOR_B, subject: SUBJECT_B, facts: FACTS_BY_KIND['redaction-applied'] }),
      event({ kind: 'zone-write', actor: ACTOR_A, subject: SUBJECT_B, facts: FACTS_BY_KIND['zone-write'] }),
    ];
    const timestamps = [RECORDED_AT_A, RECORDED_AT_B, RECORDED_AT_C];

    const first = createAuditTrail();
    const second = createAuditTrail(); // a separate instance — the same event content
    for (let i = 0; i < inputs.length; i++) {
      recorded(await first.record(inputs[i], recordOptions({ recordedAt: timestamps[i] })));
    }
    // the permuted order: last first, first last, middle in the middle
    for (const i of [2, 0, 1]) {
      recorded(await second.record(inputs[i], recordOptions({ recordedAt: timestamps[i] })));
    }

    // identical atrail_ snapshots — the events' input order never leaks
    const snapshotFirst = await first.snapshot();
    const snapshotSecond = await second.snapshot();
    expect(snapshotFirst).toMatch(ATRAIL_SNAPSHOT_PATTERN);
    expect(snapshotSecond).toBe(snapshotFirst);

    // deep-equal listings, every id audit_-shaped
    const listingFirst = first.list();
    const listingSecond = second.list();
    expect(listingSecond).toEqual(listingFirst);
    expect(listingFirst).toHaveLength(3);
    for (const e of listingFirst) {
      expect(e.id).toMatch(AUDIT_EVENT_ID_PATTERN);
    }

    // identical MEASURED counts per kind
    expect(first.countsByKind()).toEqual({
      'session-admitted': 1,
      'redaction-applied': 1,
      'zone-write': 1,
    });
    expect(second.countsByKind()).toEqual(first.countsByKind());

    // and the snapshot is stable across repeated calls
    expect(await first.snapshot()).toBe(snapshotFirst);
  });

  test('malformed events or options fail closed with named errors — never an exception', async () => {
    const trail = createAuditTrail();

    // ---- malformed record() inputs and options ----
    const cases: ReadonlyArray<[input: unknown, options: unknown, field: string, fragment: string]> = [
      // a non-object input, then a null input, then an array masquerading as one
      ['not-an-event', recordOptions(), 'input', 'expected an object'],
      [null, recordOptions(), 'input', 'expected an object'],
      [[event()], recordOptions(), 'input', 'expected an object'],
      // an unknown kind — the error NAMES the frozen vocabulary and the observed value
      [event({ kind: 'zone-evicted' }), recordOptions(), 'kind', 'zone-evicted'],
      [event({ kind: 42 }), recordOptions(), 'kind', 'expected one of the frozen'],
      // an empty actor, then a non-string actor
      [event({ actor: '' }), recordOptions(), 'actor', 'expected a non-empty string'],
      [event({ actor: 7 }), recordOptions(), 'actor', 'expected a non-empty string'],
      // an empty subject, then a non-string subject
      [event({ subject: '' }), recordOptions(), 'subject', 'expected a non-empty string'],
      [event({ subject: 7 }), recordOptions(), 'subject', 'expected a non-empty string'],
      // an array as facts (arrays are not facts objects), then a scalar as facts
      [event({ facts: ['not', 'facts'] }), recordOptions(), 'facts', 'arrays are not facts objects'],
      [event({ facts: 'nope' }), recordOptions(), 'facts', 'arrays are not facts objects'],
      // facts the id channel could never hash
      [event({ facts: { when: new Date(0) } }), recordOptions(), 'facts', 'canonical-JSON'],
      [event({ facts: { fn: () => 'nope' } }), recordOptions(), 'facts', 'canonical-JSON'],
      // malformed options: a non-object, a null, a missing recordedAt
      [event(), 'not-options', 'options', 'expected an object'],
      [event(), null, 'options', 'expected an object'],
      [event(), {}, 'options.recordedAt', 'RFC3339'],
      // a non-RFC3339 recordedAt, then the 2026-02-30-style rollover date
      [event(), recordOptions({ recordedAt: 'not-a-date' }), 'options.recordedAt', 'RFC3339'],
      [event(), recordOptions({ recordedAt: '2026-02-30T00:00:00Z' }), 'options.recordedAt', 'RFC3339'],
      [event(), recordOptions({ recordedAt: '2026-13-01T00:00:00Z' }), 'options.recordedAt', 'RFC3339'],
      [event(), recordOptions({ recordedAt: 42 }), 'options.recordedAt', 'RFC3339'],
    ];
    for (const [input, options, field, fragment] of cases) {
      // a throw would reject this await and fail the test — never an exception
      const result = await trail.record(input, options);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors.some((e) => e.startsWith(`${field}:`))).toBe(true);
        expect(result.errors.some((e) => e.includes(fragment))).toBe(true);
      }
    }

    // ALL errors are collected — a quadruple-defect record names all four fields
    const multi = await trail.record(event({ kind: 'nope', actor: '', subject: '' }), {});
    expect(multi.ok).toBe(false);
    if (!multi.ok) {
      expect(multi.errors.some((e) => e.startsWith('kind:'))).toBe(true);
      expect(multi.errors.some((e) => e.startsWith('actor:'))).toBe(true);
      expect(multi.errors.some((e) => e.startsWith('subject:'))).toBe(true);
      expect(multi.errors.some((e) => e.startsWith('options.recordedAt:'))).toBe(true);
    }

    // ---- the operation side's malformed inputs/options fail closed too ----
    const badRegister = await trail.registerOperation('not-an-input', registerOptions());
    expect(badRegister.ok).toBe(false);
    const badOperationId = await trail.registerOperation({ operationId: '' }, registerOptions());
    expect(badOperationId.ok).toBe(false);
    if (!badOperationId.ok) {
      expect(badOperationId.errors.some((e) => e.startsWith('operationId:'))).toBe(true);
    }
    const badRegisterOptions = await trail.registerOperation({ operationId: OPERATION_ID_A }, {});
    expect(badRegisterOptions.ok).toBe(false);
    if (!badRegisterOptions.ok) {
      expect(badRegisterOptions.errors.some((e) => e.startsWith('options.registeredAt:'))).toBe(true);
    }

    operationOf(await trail.registerOperation({ operationId: OPERATION_ID_A }, registerOptions()));
    const badCancel = await trail.cancel(OPERATION_ID_A, { cancelledAt: 'not-a-date' });
    expect(badCancel.ok).toBe(false);
    if (!badCancel.ok) {
      expect(badCancel.errors.some((e) => e.startsWith('options.cancelledAt:'))).toBe(true);
    }
    const badResume = await trail.resume(OPERATION_ID_A, 42);
    expect(badResume.ok).toBe(false);
    if (!badResume.ok) {
      expect(badResume.errors.some((e) => e.startsWith('options:'))).toBe(true);
    }

    // ---- and nothing was recorded by any refused write — the trail stayed empty ----
    expect(trail.list()).toEqual([]);
    expect(trail.countsByKind()).toEqual({});
  });

  test('events are append-only and content-addressed — duplicates refused, timestamps are content', async () => {
    const trail = createAuditTrail();

    const first = recorded(
      await trail.record(
        event({ kind: 'session-admitted', facts: FACTS_BY_KIND['session-admitted'] }),
        recordOptions(),
      ),
    );
    expect(first.id).toMatch(AUDIT_EVENT_ID_PATTERN);

    // the IDENTICAL event again (same content including recordedAt) → the
    // duplicate refusal, naming the already-recorded id — nothing re-recorded
    const duplicate = await trail.record(
      event({ kind: 'session-admitted', facts: FACTS_BY_KIND['session-admitted'] }),
      recordOptions(),
    );
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) {
      expect(duplicate.errors.some((e) => e.startsWith('duplicate event:'))).toBe(true);
      expect(duplicate.errors.some((e) => e.includes(first.id))).toBe(true);
    }
    expect(trail.list()).toHaveLength(1); // append-only: the duplicate appended nothing

    // the SAME content under a DIFFERENT recordedAt → a DISTINCT event — the
    // timestamp is content — and BOTH are stored
    const later = recorded(
      await trail.record(
        event({ kind: 'session-admitted', facts: FACTS_BY_KIND['session-admitted'] }),
        recordOptions({ recordedAt: RECORDED_AT_B }),
      ),
    );
    expect(later.id).toMatch(AUDIT_EVENT_ID_PATTERN);
    expect(later.id).not.toBe(first.id);
    expect(trail.list()).toHaveLength(2);

    // and the same recordedAt under DIFFERENT facts → likewise distinct (facts are content)
    const otherFacts = recorded(
      await trail.record(
        event({ kind: 'session-admitted', facts: { scopes: ['observe'], extra: 1 } }),
        recordOptions(),
      ),
    );
    expect(otherFacts.id).not.toBe(first.id);
    expect(trail.list()).toHaveLength(3);

    // the ids are content-addressed — RECOMPUTED independently from the
    // sibling packages' own primitives (the honesty law): 'audit_' +
    // sha256Hex(canonicalJson(event minus id))
    for (const e of trail.list()) {
      const { id, ...unsigned } = e;
      expect(id).toBe(`audit_${await sha256Hex(canonicalJson(unsigned))}`);
    }
  });

  test('cancellation and resume follow the honest state machine with measured counts', async () => {
    const trail = createAuditTrail();

    // register → running, cancellationCount 0, no timestamps
    const registered = operationOf(
      await trail.registerOperation({ operationId: OPERATION_ID_A }, registerOptions()),
    );
    expect(registered).toEqual({
      operationId: OPERATION_ID_A,
      state: 'running',
      cancelledAt: null,
      resumedAt: null,
      cancellationCount: 0,
    });
    expect(trail.operation(OPERATION_ID_A)).toEqual(registered);

    // cancel → cancelled, the MEASURED count 1
    const cancelled = operationOf(
      await trail.cancel(OPERATION_ID_A, cancelOptions({ cancelledAt: CANCELLED_AT_A })),
    );
    expect(cancelled.state).toBe('cancelled');
    expect(cancelled.cancellationCount).toBe(1); // MEASURED
    expect(cancelled.cancelledAt).toBe(CANCELLED_AT_A);
    expect(cancelled.resumedAt).toBeNull();

    // resume → resumed, the count STANDS (resume measures nothing new)
    const resumed = operationOf(
      await trail.resume(OPERATION_ID_A, resumeOptions({ resumedAt: RESUMED_AT_A })),
    );
    expect(resumed.state).toBe('resumed');
    expect(resumed.cancellationCount).toBe(1);
    expect(resumed.resumedAt).toBe(RESUMED_AT_A);
    expect(resumed.cancelledAt).toBe(CANCELLED_AT_A); // the earlier transition's timestamp stands

    // cancel again (resumed → cancelled is LEGAL — the cycle continues) →
    // the MEASURED count 2
    const cancelledAgain = operationOf(
      await trail.cancel(OPERATION_ID_A, cancelOptions({ cancelledAt: CANCELLED_AT_B })),
    );
    expect(cancelledAgain.state).toBe('cancelled');
    expect(cancelledAgain.cancellationCount).toBe(2); // MEASURED — each cancellation bumps it
    expect(cancelledAgain.cancelledAt).toBe(CANCELLED_AT_B); // the LATEST cancellation's timestamp
    expect(cancelledAgain.resumedAt).toBe(RESUMED_AT_A);

    // the state carried in every result AND observable through the query
    expect(trail.operation(OPERATION_ID_A)).toEqual(cancelledAgain);

    // the cycle continues past two: resume again is legal
    const resumedAgain = operationOf(
      await trail.resume(OPERATION_ID_A, resumeOptions({ resumedAt: RESUMED_AT_B })),
    );
    expect(resumedAgain.state).toBe('resumed');
    expect(resumedAgain.cancellationCount).toBe(2); // the count stands on resume

    // a SECOND operation's lifecycle is independent bookkeeping
    operationOf(await trail.registerOperation({ operationId: OPERATION_ID_B }, registerOptions()));
    const otherCancelled = operationOf(await trail.cancel(OPERATION_ID_B, cancelOptions()));
    expect(otherCancelled.cancellationCount).toBe(1);
    expect(trail.operation(OPERATION_ID_A)?.cancellationCount).toBe(2); // untouched by B's lifecycle
    expect(trail.operation(OPERATION_ID_B)?.cancellationCount).toBe(1);
  });

  test('illegal transitions are refused with named reasons', async () => {
    const trail = createAuditTrail();
    operationOf(await trail.registerOperation({ operationId: OPERATION_ID_A }, registerOptions()));

    // resume a RUNNING operation → refused, "not cancelled", the state carried
    const tooEarly = await trail.resume(OPERATION_ID_A, resumeOptions());
    expect(tooEarly.ok).toBe(false);
    if (!tooEarly.ok) {
      expect(tooEarly.errors.some((e) => e.includes('not cancelled'))).toBe(true);
      expect(tooEarly.operation?.state).toBe('running'); // the state carried
    }

    // cancel → cancelled; then cancel the CANCELLED operation → refused,
    // "already cancelled", the count unmoved
    operationOf(await trail.cancel(OPERATION_ID_A, cancelOptions()));
    const doubleCancel = await trail.cancel(OPERATION_ID_A, cancelOptions({ cancelledAt: CANCELLED_AT_B }));
    expect(doubleCancel.ok).toBe(false);
    if (!doubleCancel.ok) {
      expect(doubleCancel.errors.some((e) => e.includes('already cancelled'))).toBe(true);
      expect(doubleCancel.operation?.state).toBe('cancelled'); // the state carried
      expect(doubleCancel.operation?.cancellationCount).toBe(1); // the measured count unmoved
    }

    // resume → resumed; then resume the RESUMED operation → refused, "already resumed"
    operationOf(await trail.resume(OPERATION_ID_A, resumeOptions()));
    const doubleResume = await trail.resume(OPERATION_ID_A, resumeOptions());
    expect(doubleResume.ok).toBe(false);
    if (!doubleResume.ok) {
      expect(doubleResume.errors.some((e) => e.includes('already resumed'))).toBe(true);
      expect(doubleResume.operation?.state).toBe('resumed'); // the state carried
    }

    // an unknown operationId is a named refusal, never an exception
    const ghostCancel = await trail.cancel('never-registered', cancelOptions());
    expect(ghostCancel.ok).toBe(false);
    if (!ghostCancel.ok) {
      expect(ghostCancel.errors.some((e) => e.startsWith('unknown operation:'))).toBe(true);
    }
    const ghostResume = await trail.resume('never-registered', resumeOptions());
    expect(ghostResume.ok).toBe(false);
    // a non-string operationId is a named field error
    const nonString = await trail.cancel(42, cancelOptions());
    expect(nonString.ok).toBe(false);
    if (!nonString.ok) {
      expect(nonString.errors.some((e) => e.startsWith('operationId:'))).toBe(true);
    }

    // a duplicate registration is refused (named), the existing record carried
    const duplicate = await trail.registerOperation({ operationId: OPERATION_ID_A }, registerOptions());
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) {
      expect(duplicate.errors.some((e) => e.startsWith('duplicate operation:'))).toBe(true);
      expect(duplicate.operation?.state).toBe('resumed');
    }

    // the refusals never moved the state machine's events: exactly ONE
    // cancel and ONE resume fired for OPERATION_ID_A
    const kinds = trail.list().map((e) => e.kind);
    expect(kinds.filter((k) => k === 'operation-cancelled')).toHaveLength(1);
    expect(kinds.filter((k) => k === 'operation-resumed')).toHaveLength(1);
    expect(trail.operation(OPERATION_ID_A)?.cancellationCount).toBe(1);
  });

  test('cancel and resume write audit events together with the state change', async () => {
    const trail = createAuditTrail();

    // registration records NO event — the trail is empty after it
    operationOf(await trail.registerOperation({ operationId: OPERATION_ID_A }, registerOptions()));
    expect(trail.list()).toEqual([]);

    const cancelled = transitionOf(await trail.cancel(OPERATION_ID_A, cancelOptions({ cancelledAt: CANCELLED_AT_A })));
    const resumed = transitionOf(await trail.resume(OPERATION_ID_A, resumeOptions({ resumedAt: RESUMED_AT_A })));

    // the trail holds EXACTLY the operation-cancelled and operation-resumed events
    const events = trail.list();
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.kind).sort()).toEqual(['operation-cancelled', 'operation-resumed']);
    expect(events).toEqual([cancelled.event, resumed.event].sort((a, b) => (a.id < b.id ? -1 : 1)));

    // the recomputed expectation: exactly ONE legal cancellation of
    // OPERATION_ID_A has happened so far
    const recomputedCancellations = 1;
    for (const e of events) {
      expect(e.subject).toBe(OPERATION_ID_A);
      expect(e.actor).toBe('system');
      expect(e.auditVersion).toBe(AUDIT_VERSION);
      expect(e.id).toMatch(AUDIT_EVENT_ID_PATTERN);
      // the transition's caller-injected timestamp IS the event's recordedAt
      // (the trail never reads a clock)
      expect(e.recordedAt).toBe(e.kind === 'operation-cancelled' ? CANCELLED_AT_A : RESUMED_AT_A);
      // MEASURED cancellationCount facts, asserted by recomputation from
      // the test's own observed transitions
      expect(e.facts['cancellationCount']).toBe(recomputedCancellations);
      // and the event id is content-addressed — recomputed independently
      const { id, ...unsigned } = e;
      expect(id).toBe(`audit_${await sha256Hex(canonicalJson(unsigned))}`);
    }
    expect(trail.countsByKind()).toEqual({ 'operation-cancelled': 1, 'operation-resumed': 1 });

    // the trail moves WITH the state: a second cancel (resumed → cancelled)
    // records a SECOND cancelled event whose measured count is the recomputed 2
    operationOf(await trail.cancel(OPERATION_ID_A, cancelOptions({ cancelledAt: CANCELLED_AT_B })));
    const after = trail.list();
    expect(after).toHaveLength(3);
    expect(trail.countsByKind()).toEqual({ 'operation-cancelled': 2, 'operation-resumed': 1 });
    const second = after.find((e) => e.kind === 'operation-cancelled' && e.recordedAt === CANCELLED_AT_B);
    expect(second).toBeDefined();
    if (second !== undefined) {
      expect(second.facts['cancellationCount']).toBe(2); // MEASURED — recomputed (two cancels)
    }
    // and the observable operation record agrees with the events' measured count
    expect(trail.operation(OPERATION_ID_A)?.cancellationCount).toBe(2);
  });

  test('listings are canonically ordered and defensively copied; queries never error', async () => {
    const trail = createAuditTrail();

    // three events, recorded in a scrambled content order
    const inputs = [
      event({ kind: 'redaction-applied', actor: ACTOR_B, subject: SUBJECT_B, facts: { fieldsRedacted: 3 } }),
      event({ kind: 'session-admitted', facts: FACTS_BY_KIND['session-admitted'] }),
      event({ kind: 'zone-refused', subject: SUBJECT_B, facts: FACTS_BY_KIND['zone-refused'] }),
    ];
    for (const input of inputs) {
      recorded(await trail.record(input, recordOptions()));
    }

    // list() is canonically ordered by id — ascending, every id audit_-shaped
    const ids = trail.list().map((e) => e.id);
    expect(ids).toEqual([...ids].sort());
    expect(trail.list()).toHaveLength(3);
    for (const e of trail.list()) {
      expect(e.id).toMatch(AUDIT_EVENT_ID_PATTERN);
      expect(e.auditVersion).toBe(AUDIT_VERSION);
    }

    // defensively copied: mutating a returned event's ARRAYS (its nested
    // facts) changes nothing the trail holds — and the tamper-evidence
    // channel (the snapshot) is unmoved
    const snapshotBefore = await trail.snapshot();
    const victim = trail.list().find((e) => e.kind === 'session-admitted');
    expect(victim).toBeDefined();
    if (victim !== undefined) {
      (victim.facts['scopes'] as string[]).push('tampered');
    }
    const afterTamper = trail.list();
    expect(afterTamper.map((e) => e.id)).toEqual(ids);
    expect(afterTamper.find((e) => e.kind === 'session-admitted')?.facts['scopes']).toEqual(['observe']);
    expect(await trail.snapshot()).toBe(snapshotBefore);

    // mutating the returned listing ARRAY itself changes nothing either
    const listing = trail.list();
    listing.pop();
    expect(trail.list()).toHaveLength(3);
    expect(await trail.snapshot()).toBe(snapshotBefore);

    // two list() calls return DISTINCT fresh arrays (never a shared alias)
    expect(trail.list()).not.toBe(trail.list());
    expect(trail.list()).toEqual(trail.list()); // but deep-equal content

    // mutating a returned operation record changes nothing (the sealed trail)
    operationOf(await trail.registerOperation({ operationId: OPERATION_ID_A }, registerOptions()));
    const op = trail.operation(OPERATION_ID_A);
    expect(op).not.toBeNull();
    if (op !== null) {
      op.cancellationCount = 99;
      op.state = 'resumed';
    }
    expect(trail.operation(OPERATION_ID_A)?.cancellationCount).toBe(0);
    expect(trail.operation(OPERATION_ID_A)?.state).toBe('running');

    // queries never error: non-string / empty / unknown → null
    expect(trail.operation(42)).toBeNull();
    expect(trail.operation(null)).toBeNull();
    expect(trail.operation('')).toBeNull();
    expect(trail.operation('unknown-operation')).toBeNull();
  });

  test('snapshots are content-addressed — any trail change moves the id and the empty trail is valid', async () => {
    const trail = createAuditTrail();

    // the empty trail snapshots to a valid atrail_ digest — and it is the
    // content address of the empty event list, recomputed independently
    const empty = await trail.snapshot();
    expect(empty).toMatch(ATRAIL_SNAPSHOT_PATTERN);
    expect(empty).toBe(`atrail_${await sha256Hex(canonicalJson([]))}`);

    // each new event moves the id
    recorded(await trail.record(event({ kind: 'session-admitted' }), recordOptions({ recordedAt: RECORDED_AT_A })));
    const one = await trail.snapshot();
    expect(one).toMatch(ATRAIL_SNAPSHOT_PATTERN);
    expect(one).not.toBe(empty);
    recorded(
      await trail.record(
        event({ kind: 'redaction-applied', actor: ACTOR_B, subject: SUBJECT_B }),
        recordOptions({ recordedAt: RECORDED_AT_B }),
      ),
    );
    const two = await trail.snapshot();
    expect(two).toMatch(ATRAIL_SNAPSHOT_PATTERN);
    expect(two).not.toBe(one);

    // a refused record moves nothing (a rejected write stores nothing) —
    // the duplicate of the first event is refused and the snapshot stands
    const refused = await trail.record(event({ kind: 'session-admitted' }), recordOptions({ recordedAt: RECORDED_AT_A }));
    expect(refused.ok).toBe(false);
    expect(await trail.snapshot()).toBe(two);

    // the same set rebuilt in ANY order → the same digest
    const rebuilt = createAuditTrail();
    recorded(
      await rebuilt.record(
        event({ kind: 'redaction-applied', actor: ACTOR_B, subject: SUBJECT_B }),
        recordOptions({ recordedAt: RECORDED_AT_B }),
      ),
    );
    recorded(await rebuilt.record(event({ kind: 'session-admitted' }), recordOptions({ recordedAt: RECORDED_AT_A })));
    expect(await rebuilt.snapshot()).toBe(two);

    // a registration records no event — the events-only digest is unmoved
    const withOperation = createAuditTrail();
    recorded(await withOperation.record(event({ kind: 'zone-write' }), recordOptions()));
    const before = await withOperation.snapshot();
    operationOf(await withOperation.registerOperation({ operationId: OPERATION_ID_A }, registerOptions()));
    expect(await withOperation.snapshot()).toBe(before); // a registration is not a trail change
    // but a cancel IS — it records its event
    operationOf(await withOperation.cancel(OPERATION_ID_A, cancelOptions()));
    const afterCancel = await withOperation.snapshot();
    expect(afterCancel).toMatch(ATRAIL_SNAPSHOT_PATTERN);
    expect(afterCancel).not.toBe(before);
  });
});
