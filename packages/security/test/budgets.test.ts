// CLAPP-075 — the resource budgets tests (the P7 closing lane — Worker 1).
//
// Eight named tests over the frozen six-axis v0.1 vocabulary:
// determinism (identical usage multisets in any order → identical
// budget_ snapshots, the digest recomputed independently from the
// multiset + envelope + version), fail-closed malformed envelopes/
// usages/timestamps (never an exception, nothing recorded), the
// MEASURED remaining on within-budget usage (exactly-at-limit allowed,
// remaining 0), the over-budget refusal that NEVER consumes (the named
// exceedance, used/remaining standing, a subsequent usage succeeding),
// per-axis independence (all six axes, exact per their own limits),
// used()/remaining() measured-fresh-defensive (a shadow ledger, mutated
// returns changing nothing), the verbatim envelope + content-addressed
// snapshots (the empty account valid, any charge moving the digest,
// rebuilt multisets digesting identically), and the caller-injected
// validated usedAt (distinct charges at distinct timestamps, the
// rollover date refusing).

import { describe, expect, test } from 'bun:test';
import { sha256Hex } from '@clapp/core';
import { canonicalJson } from '@clapp/observe';

import { BUDGET_SNAPSHOT_PATTERN, BUDGETS_VERSION, createBudgetAccount } from '../src/budgets';
import type {
  BudgetAccount,
  BudgetAccountResult,
  BudgetAxis,
  BudgetEnvelope,
  BudgetUsage,
} from '../src/budgets';
import {
  SAMPLE_ENVELOPE,
  SIX_AXES,
  USED_AT_A,
  USED_AT_B,
  USED_AT_C,
  envelope,
  usage,
} from './fixtures/budgets-fixtures';

/** Unwraps an ok account admission (a refusal fails the test loudly, never silently). */
function accountOf(result: BudgetAccountResult): BudgetAccount {
  if (!result.ok) {
    throw new Error(`expected an ok account admission, got errors: ${result.errors.join('; ')}`);
  }
  return result.account;
}

/** The snapshot's canonical usage order — (axis, usedAt, amount) — recomputed independently here. */
function canonicalUsageOrder(a: BudgetUsage, b: BudgetUsage): number {
  if (a.axis !== b.axis) return a.axis < b.axis ? -1 : 1;
  if (a.usedAt !== b.usedAt) return a.usedAt < b.usedAt ? -1 : 1;
  return a.amount < b.amount ? -1 : a.amount > b.amount ? 1 : 0;
}

/** A per-axis limit table for the independence/defense tests (the envelope is built FROM it). */
function limitByAxis(): Record<BudgetAxis, number> {
  return {
    'cpu-ms': SAMPLE_ENVELOPE.cpuMs,
    'memory-mb': SAMPLE_ENVELOPE.memoryMb,
    'process-count': SAMPLE_ENVELOPE.processCount,
    'filesystem-bytes': SAMPLE_ENVELOPE.filesystemBytes,
    'network-egress-count': SAMPLE_ENVELOPE.networkEgressCount,
    'timeout-ms': SAMPLE_ENVELOPE.timeoutMs,
  };
}

describe('resource budgets (CLAPP-075)', () => {
  test('budget accounting is deterministic — identical usage multisets in any order produce identical snapshots', async () => {
    expect(BUDGETS_VERSION).toBe('0.1'); // the frozen v0.1 contract pin
    // the fixture vocabulary is exactly the six frozen §4 axes
    expect(SIX_AXES.length).toBe(6);

    const env = envelope();
    const charges: BudgetUsage[] = [
      { axis: 'cpu-ms', amount: 120, usedAt: USED_AT_B },
      { axis: 'memory-mb', amount: 64, usedAt: USED_AT_A },
      { axis: 'timeout-ms', amount: 300, usedAt: USED_AT_C },
    ];

    const first = accountOf(createBudgetAccount(env));
    const second = accountOf(createBudgetAccount(envelope()));
    for (const charge of charges) {
      expect((await first.use(charge)).ok).toBe(true);
    }
    // a full reversal — the same multiset, the opposite accounting order
    for (const charge of [...charges].reverse()) {
      expect((await second.use(charge)).ok).toBe(true);
    }

    // identical snapshots, used(), and remaining()
    expect(await second.snapshot()).toBe(await first.snapshot());
    expect(second.used()).toEqual(first.used());
    expect(second.remaining()).toEqual(first.remaining());

    // and the snapshot is the digest recomputed INDEPENDENTLY here,
    // from the multiset, the envelope, and the contract version (the
    // content-addressing proof — the account's canonical state)
    const expected = `budget_${await sha256Hex(
      canonicalJson({
        budgetsVersion: BUDGETS_VERSION,
        envelope: env,
        usages: [...charges].sort(canonicalUsageOrder),
      }),
    )}`;
    expect(await first.snapshot()).toBe(expected);
    expect(await second.snapshot()).toBe(expected);
  });

  test('malformed envelopes, usages, or timestamps fail closed with named errors — never an exception', async () => {
    // ---- envelopes: a non-object; a zero / negative / fractional / missing limit ----
    const missingFilesystem = envelope();
    delete missingFilesystem['filesystemBytes'];

    const envelopeCases: Array<[unknown, string]> = [
      ['not-an-object', 'envelope:'],
      [envelope({ cpuMs: 0 }), 'envelope.cpuMs'],
      [envelope({ memoryMb: -5 }), 'envelope.memoryMb'],
      [envelope({ processCount: 1.5 }), 'envelope.processCount'],
      [missingFilesystem, 'envelope.filesystemBytes'],
    ];
    for (const [bad, named] of envelopeCases) {
      const result = createBudgetAccount(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors.some((e) => e.includes(named))).toBe(true);
      }
    }

    // ALL errors collected — two bad limits name BOTH fields
    const twoBad = createBudgetAccount(envelope({ cpuMs: 0, networkEgressCount: 2.5 }));
    expect(twoBad.ok).toBe(false);
    if (!twoBad.ok) {
      expect(twoBad.errors.some((e) => e.includes('envelope.cpuMs'))).toBe(true);
      expect(twoBad.errors.some((e) => e.includes('envelope.networkEgressCount'))).toBe(true);
    }

    // ---- usages: an unknown axis (the observed value named), a negative
    // or fractional amount, a non-RFC3339 usedAt, the rollover date, a
    // non-object — every case a named error, never an exception ----
    const account = accountOf(createBudgetAccount(envelope()));
    const usageCases: Array<[unknown, string]> = [
      ['not-an-object', 'usage:'],
      [usage({ axis: 'gpu-ms' }), 'gpu-ms'],
      [usage({ amount: -1 }), 'amount'],
      [usage({ amount: 0.5 }), 'amount'],
      [usage({ usedAt: 'not-a-timestamp' }), 'usedAt'],
      [usage({ usedAt: '2026-02-30T00:00:00Z' }), 'usedAt'], // the rollover date — calendar-invalid
    ];
    for (const [bad, named] of usageCases) {
      const result = await account.use(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors.some((e) => e.includes(named))).toBe(true);
      }
    }

    // the refusals recorded NOTHING (fail-closed stores nothing)
    expect(account.used()).toEqual({});
    expect(account.remaining()).toEqual({});
  });

  test('within-budget usage records and reports the MEASURED remaining', async () => {
    const TIMEOUT_LIMIT = 1000;
    const account = accountOf(createBudgetAccount(envelope({ timeoutMs: TIMEOUT_LIMIT })));

    // use 400 → remaining 600, recomputed from the envelope and the
    // account's own measured total (never asserted as a literal)
    const first = await account.use(usage({ axis: 'timeout-ms', amount: 400 }));
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.remaining).toBe(TIMEOUT_LIMIT - (account.used()['timeout-ms'] ?? 0));
    }

    // use 600 → EXACTLY at the limit: allowed, remaining 0. (The
    // packet's literally-worded "use 400 again → remaining 0" is
    // arithmetically inconsistent with its own test-4 premise "after
    // 800 used" — 1000−400−400 = 200 — so the exactly-at-limit charge
    // here is the 600 that lands on the limit; the 400+400=800 premise
    // belongs to test 4. Resolution disclosed in DELIVERY.md.)
    const second = await account.use(usage({ axis: 'timeout-ms', amount: 600, usedAt: USED_AT_B }));
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.remaining).toBe(0);
      expect(second.remaining).toBe(TIMEOUT_LIMIT - (account.used()['timeout-ms'] ?? 0));
      expect(account.remaining()['timeout-ms']).toBe(0);
    }

    // and the measured remaining agrees with the measured used at every step
    expect((account.used()['timeout-ms'] ?? 0) + (account.remaining()['timeout-ms'] ?? 0)).toBe(TIMEOUT_LIMIT);

    // exactly at the limit → the NEXT usage on that axis refuses (the boundary law)
    const beyond = await account.use(usage({ axis: 'timeout-ms', amount: 1, usedAt: USED_AT_C }));
    expect(beyond.ok).toBe(false);
  });

  test('over-budget usage refuses and never consumes', async () => {
    const TIMEOUT_LIMIT = 1000;
    const account = accountOf(createBudgetAccount(envelope({ timeoutMs: TIMEOUT_LIMIT })));

    expect((await account.use(usage({ axis: 'timeout-ms', amount: 400 }))).ok).toBe(true);
    expect((await account.use(usage({ axis: 'timeout-ms', amount: 400, usedAt: USED_AT_B }))).ok).toBe(true);

    // the measured facts BEFORE the refused charge
    const usedBefore = account.used()['timeout-ms'] ?? 0; // 800, measured
    const remainingBefore = account.remaining()['timeout-ms'] ?? 0; // 200, measured

    // the third 400 would total 1200 over the 1000 limit → REFUSED with the named exceedance
    const third = await account.use(usage({ axis: 'timeout-ms', amount: 400, usedAt: USED_AT_C }));
    expect(third.ok).toBe(false);
    if (!third.ok) {
      expect(third.errors).toContain(
        `budget exceeded: timeout-ms usage 400 would total ${usedBefore + 400} over the ${TIMEOUT_LIMIT} limit`,
      );
    }

    // a refused charge NEVER consumes — used and remaining stand exactly where they were
    expect(account.used()['timeout-ms']).toBe(usedBefore);
    expect(account.remaining()['timeout-ms']).toBe(remainingBefore);

    // and a subsequent within-budget usage still succeeds (the account was not poisoned)
    const tail = await account.use(usage({ axis: 'timeout-ms', amount: 200, usedAt: USED_AT_C }));
    expect(tail.ok).toBe(true);
    if (tail.ok) {
      expect(tail.remaining).toBe(remainingBefore - 200); // recomputed from the measured remaining
    }
  });

  test('every axis accounts independently', async () => {
    const limits = limitByAxis();
    const account = accountOf(
      createBudgetAccount({
        cpuMs: limits['cpu-ms'],
        memoryMb: limits['memory-mb'],
        processCount: limits['process-count'],
        filesystemBytes: limits['filesystem-bytes'],
        networkEgressCount: limits['network-egress-count'],
        timeoutMs: limits['timeout-ms'],
      }),
    );

    // one within-limit usage per axis — accounted in an order that is
    // neither the envelope order nor the axis order, on purpose
    const charges: BudgetUsage[] = [
      { axis: 'network-egress-count', amount: 4, usedAt: USED_AT_A },
      { axis: 'cpu-ms', amount: 350, usedAt: USED_AT_A },
      { axis: 'timeout-ms', amount: 250, usedAt: USED_AT_B },
      { axis: 'memory-mb', amount: 128, usedAt: USED_AT_A },
      { axis: 'process-count', amount: 2, usedAt: USED_AT_C },
      { axis: 'filesystem-bytes', amount: 4096, usedAt: USED_AT_B },
    ];
    for (const charge of charges) {
      const applied = await account.use(charge);
      expect(applied.ok).toBe(true);
      if (applied.ok) {
        // the MEASURED remaining, recomputed per the axis's OWN limit
        expect(applied.remaining).toBe(limits[charge.axis] - charge.amount);
      }
    }

    // every axis's used/remaining is exact per its own envelope limit — no cross-axis bleed
    for (const charge of charges) {
      expect(account.used()[charge.axis]).toBe(charge.amount);
      expect(account.remaining()[charge.axis]).toBe(limits[charge.axis] - charge.amount);
    }
    // all six axes are present, and nothing else
    expect(Object.keys(account.used()).sort()).toEqual([...SIX_AXES].sort());
    expect(Object.keys(account.remaining()).sort()).toEqual([...SIX_AXES].sort());
  });

  test('used and remaining are measured, fresh, and defensive', async () => {
    const limits = limitByAxis();
    const account = accountOf(
      createBudgetAccount({
        cpuMs: limits['cpu-ms'],
        memoryMb: limits['memory-mb'],
        processCount: limits['process-count'],
        filesystemBytes: limits['filesystem-bytes'],
        networkEgressCount: limits['network-egress-count'],
        timeoutMs: limits['timeout-ms'],
      }),
    );

    // a shadow ledger the test maintains INDEPENDENTLY of the account
    const charges: BudgetUsage[] = [
      { axis: 'cpu-ms', amount: 150, usedAt: USED_AT_A },
      { axis: 'cpu-ms', amount: 250, usedAt: USED_AT_B },
      { axis: 'memory-mb', amount: 64, usedAt: USED_AT_A },
    ];
    const shadow = new Map<BudgetAxis, number>();
    for (const charge of charges) {
      expect((await account.use(charge)).ok).toBe(true);
      shadow.set(charge.axis, (shadow.get(charge.axis) ?? 0) + charge.amount);
    }

    // used() recomputes to the shadow ledger's independent sums
    const measured = account.used();
    for (const [axis, total] of shadow) {
      expect(measured[axis]).toBe(total);
    }
    expect(Object.keys(measured).sort()).toEqual([...shadow.keys()].sort());

    // remaining() recomputes to each axis's own limit minus the shadow sum
    const remainders = account.remaining();
    for (const [axis, total] of shadow) {
      expect(remainders[axis]).toBe(limits[axis] - total);
    }
    expect(Object.keys(remainders).sort()).toEqual([...shadow.keys()].sort());

    // mutating the returned objects changes NOTHING — fresh defensive copies
    measured['cpu-ms'] = 9_999_999; // a forged total
    delete measured['memory-mb']; // a deleted axis
    remainders['cpu-ms'] = -1; // a forged remaining
    remainders['network-egress-count'] = 0; // a PLANTED axis that was never used

    const usedAgain = account.used();
    for (const [axis, total] of shadow) {
      expect(usedAgain[axis]).toBe(total);
    }
    expect(Object.keys(usedAgain).sort()).toEqual([...shadow.keys()].sort());

    const remaindersAgain = account.remaining();
    for (const [axis, total] of shadow) {
      expect(remaindersAgain[axis]).toBe(limits[axis] - total);
    }
    expect(Object.keys(remaindersAgain).sort()).toEqual([...shadow.keys()].sort());
  });

  test('the envelope rides verbatim and snapshots are content-addressed', async () => {
    const CPU_LIMIT = SAMPLE_ENVELOPE.cpuMs;
    const input: BudgetEnvelope = {
      cpuMs: CPU_LIMIT,
      memoryMb: SAMPLE_ENVELOPE.memoryMb,
      processCount: SAMPLE_ENVELOPE.processCount,
      filesystemBytes: SAMPLE_ENVELOPE.filesystemBytes,
      networkEgressCount: SAMPLE_ENVELOPE.networkEgressCount,
      timeoutMs: SAMPLE_ENVELOPE.timeoutMs,
    };
    const account = accountOf(createBudgetAccount(input));

    // verbatim — deep-equals the input
    expect(account.envelope()).toEqual(input);

    // stored by VALUE: mutating the caller's object afterwards changes nothing
    input['cpuMs'] = 0;
    expect(account.envelope()['cpuMs']).toBe(CPU_LIMIT);
    input['cpuMs'] = CPU_LIMIT; // restored — the rebuild below uses a fresh envelope anyway

    // and the handed-out envelope is a fresh copy: mutating it changes nothing either
    const handed = account.envelope();
    handed['memoryMb'] = 1;
    expect(account.envelope()['memoryMb']).toBe(SAMPLE_ENVELOPE.memoryMb);

    // the EMPTY account (no charges) is a valid budget_ digest
    const empty = await account.snapshot();
    expect(empty).toMatch(BUDGET_SNAPSHOT_PATTERN);

    // a usage MOVES the snapshot
    const charge = usage({ axis: 'timeout-ms', amount: 100 });
    expect((await account.use(charge)).ok).toBe(true);
    const moved = await account.snapshot();
    expect(moved).toMatch(BUDGET_SNAPSHOT_PATTERN);
    expect(moved).not.toBe(empty);

    // the same multiset rebuilt in a second account (a fresh, identical
    // envelope + the same charge) → the SAME digest
    const rebuilt = accountOf(createBudgetAccount({ ...input }));
    expect((await rebuilt.use(charge)).ok).toBe(true);
    expect(await rebuilt.snapshot()).toBe(moved);
  });

  test('usedAt is caller-injected and validated — the account never reads a clock', async () => {
    const account = accountOf(createBudgetAccount(envelope()));

    // the same axis+amount at two DIFFERENT usedAt values are DISTINCT charges — both recorded
    const AMOUNT = 1;
    expect((await account.use({ axis: 'process-count', amount: AMOUNT, usedAt: USED_AT_A })).ok).toBe(true);
    expect((await account.use({ axis: 'process-count', amount: AMOUNT, usedAt: USED_AT_B })).ok).toBe(true);
    // the axis's measured total counts BOTH charges
    expect(account.used()['process-count']).toBe(AMOUNT + AMOUNT);

    // and they are distinct CONTENT: one doubled charge is a different multiset — a different snapshot
    const single = accountOf(createBudgetAccount(envelope()));
    expect((await single.use({ axis: 'process-count', amount: AMOUNT + AMOUNT, usedAt: USED_AT_A })).ok).toBe(true);
    expect(await single.snapshot()).not.toBe(await account.snapshot());

    // a non-RFC3339 usedAt REFUSES (caller-injected AND validated) — the rollover date too
    for (const bad of ['not-a-timestamp', '2026-02-30T00:00:00Z']) {
      const refused = await account.use({ axis: 'process-count', amount: AMOUNT, usedAt: bad });
      expect(refused.ok).toBe(false);
      if (!refused.ok) {
        expect(refused.errors.some((e) => e.includes('usedAt'))).toBe(true);
        // the observed value is named in the refusal
        expect(refused.errors.some((e) => e.includes(JSON.stringify(bad)))).toBe(true);
      }
    }

    // the refusals recorded nothing beyond the two admitted charges
    expect(account.used()['process-count']).toBe(AMOUNT + AMOUNT);
  });
});
