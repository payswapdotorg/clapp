// CLAPP-072 — the multi-tenant isolation tests.
//
// Eight named tests over the frozen §6 five-domain vocabulary:
// determinism (identical writes in any order → identical iso_
// snapshots), fail-closed malformed tenants/writes/options (never an
// exception), the (domain, key) immutability law (changed rewrite and
// duplicate both refused), the publish-leak guard (the §6 acceptance law
// made executable, and generalized), tenant scoping (one tenant's data
// invisible to another zone), honest queries (wrong-typed/missing →
// null, hits verbatim), leak-free content-addressed snapshots (any
// change moves the id), and the caller-injected/clock-free storedAt
// proof (the timestamp is content).

import { describe, expect, test } from 'bun:test';

import { ISOLATION_VERSION, ISO_SNAPSHOT_PATTERN, createTenantZone } from '../src/isolation';
import type { IsolatedDatum, IsolationZone, StoreResult } from '../src/isolation';
import {
  DEFAULT_VALUE,
  FIVE_DOMAINS,
  KEY_A,
  KEY_B,
  KEY_C,
  KEY_D,
  KEY_E,
  STORED_AT_A,
  STORED_AT_B,
  TENANT_A,
  TENANT_B,
  VALUES_BY_DOMAIN,
  storeOptions,
  write,
} from './fixtures/isolation-fixtures';

/** Creates a zone for a well-formed tenant (a refusal fails the test loudly). */
function zoneFor(tenantId: string): IsolationZone {
  const created = createTenantZone(tenantId);
  if (!created.ok) {
    throw new Error(`expected an ok zone for ${tenantId}, got errors: ${created.errors.join('; ')}`);
  }
  return created.zone;
}

/** Unwraps an ok store result (a refusal fails the test loudly, never silently). */
function stored(result: StoreResult): IsolatedDatum {
  if (!result.ok) {
    throw new Error(`expected an ok store result inside a fixture write, got errors: ${result.errors.join('; ')}`);
  }
  return result.datum;
}

describe('the multi-tenant isolation zone (CLAPP-072)', () => {
  test('isolation is deterministic — identical writes in any order produce identical snapshots', async () => {
    expect(ISOLATION_VERSION).toBe('0.1'); // the frozen v0.1 contract pin
    // the fixture vocabulary is exactly the five frozen §6 domains
    expect(Object.keys(VALUES_BY_DOMAIN).sort()).toEqual([...FIVE_DOMAINS].sort());
    // three writes across three domains, fixed values, fixed storedAt
    const writes = [
      write({ domain: 'user-project', key: KEY_A, value: VALUES_BY_DOMAIN['user-project'] }),
      write({ domain: 'package-library', key: KEY_D, value: VALUES_BY_DOMAIN['package-library'] }),
      write({ domain: 'target-evidence', key: KEY_B, value: VALUES_BY_DOMAIN['target-evidence'] }),
    ];
    const first = zoneFor(TENANT_A);
    const second = zoneFor(TENANT_B); // a different tenant, the same data content
    for (const input of writes) {
      stored(await first.put(input, storeOptions()));
    }
    // the permuted order: last first, first last, middle in the middle
    for (const input of [writes[2]!, writes[0]!, writes[1]!]) {
      stored(await second.put(input, storeOptions()));
    }
    // identical iso_ snapshots — the writes' input order never leaks
    const snapshotFirst = await first.snapshot();
    const snapshotSecond = await second.snapshot();
    expect(snapshotFirst).toMatch(ISO_SNAPSHOT_PATTERN);
    expect(snapshotSecond).toBe(snapshotFirst);
    // identical listings and measured counts
    for (const domain of ['user-project', 'package-library', 'target-evidence']) {
      expect(second.list(domain)).toEqual(first.list(domain));
    }
    expect(first.counts()).toEqual({ 'user-project': 1, 'package-library': 1, 'target-evidence': 1 });
    expect(second.counts()).toEqual(first.counts());
    // and the snapshot is stable across repeated calls
    expect(await first.snapshot()).toBe(snapshotFirst);
  });

  test('malformed tenants, writes, or options fail closed with named errors — never an exception', async () => {
    // ---- bad tenants: an empty string and a number → named errors, no zone ----
    for (const tenantId of ['', 42]) {
      // a throw would fail this test — never an exception
      const created = createTenantZone(tenantId);
      expect(created.ok).toBe(false);
      if (!created.ok) {
        expect(created.errors.length).toBeGreaterThan(0);
        expect(created.errors.some((e) => e.startsWith('tenantId:'))).toBe(true);
      }
    }

    // ---- malformed writes and options on a well-formed zone ----
    const zone = zoneFor(TENANT_A);
    const cases: ReadonlyArray<[input: unknown, options: unknown, field: string, fragment: string]> = [
      // a non-object input, then a null input, then an array masquerading as one
      ['not-a-write', storeOptions(), 'input', 'expected an object'],
      [null, storeOptions(), 'input', 'expected an object'],
      [[write()], storeOptions(), 'input', 'expected an object'],
      // a bad domain — the error NAMES the frozen vocabulary
      [write({ domain: 'shared-notes' }), storeOptions(), 'domain', 'user-project'],
      [write({ domain: 42 }), storeOptions(), 'domain', 'expected one of the frozen'],
      // an empty key, then a non-string key
      [write({ key: '' }), storeOptions(), 'key', 'expected a non-empty string'],
      [write({ key: 7 }), storeOptions(), 'key', 'expected a non-empty string'],
      // a value the snapshot channel could never hash
      [write({ value: new Date(0) }), storeOptions(), 'value', 'canonical-JSON'],
      [write({ value: () => 'nope' }), storeOptions(), 'value', 'canonical-JSON'],
      // a present-but-malformed origin domain
      [write({ originDomain: 'shared-notes' }), storeOptions(), 'originDomain', 'expected one of the frozen'],
      [write({ originDomain: 13 }), storeOptions(), 'originDomain', 'expected one of the frozen'],
      // malformed options: a non-object, a null, a missing storedAt
      [write(), 'not-options', 'options', 'expected an object'],
      [write(), null, 'options', 'expected an object'],
      [write(), {}, 'options.storedAt', 'RFC3339'],
      // a non-RFC3339 storedAt, then the 2026-02-30-style rollover date
      [write(), storeOptions({ storedAt: 'not-a-date' }), 'options.storedAt', 'RFC3339'],
      [write(), storeOptions({ storedAt: '2026-02-30T00:00:00Z' }), 'options.storedAt', 'RFC3339'],
    ];
    for (const [input, options, field, fragment] of cases) {
      // a throw would reject this await and fail the test — never an exception
      const result = await zone.put(input, options);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors.some((e) => e.startsWith(`${field}:`))).toBe(true);
        expect(result.errors.some((e) => e.includes(fragment))).toBe(true);
      }
    }
    // ALL errors are collected — a triple-defect write names all three fields
    const multi = await zone.put({ domain: 'bogus', key: '', value: 1 }, { storedAt: 'nope' });
    expect(multi.ok).toBe(false);
    if (!multi.ok) {
      expect(multi.errors.some((e) => e.startsWith('domain:'))).toBe(true);
      expect(multi.errors.some((e) => e.startsWith('key:'))).toBe(true);
      expect(multi.errors.some((e) => e.startsWith('options.storedAt:'))).toBe(true);
    }
    // and nothing was stored by any refused write — the zone stayed empty
    expect(zone.counts()).toEqual({});
  });

  test('same-domain keys are immutable — a changed rewrite is refused, a duplicate is refused', async () => {
    const zone = zoneFor(TENANT_A);
    const first = await zone.put(
      write({ domain: 'user-project', key: KEY_A, value: { revision: 1 } }),
      storeOptions(),
    );
    expect(first.ok).toBe(true);

    // a changed rewrite: the same (domain, key), a DIFFERENT value → refused
    // naming BOTH the key and the domain (the immutable-datum refusal)
    const changed = await zone.put(
      write({ domain: 'user-project', key: KEY_A, value: { revision: 2 } }),
      storeOptions(),
    );
    expect(changed.ok).toBe(false);
    if (!changed.ok) {
      expect(changed.errors.some((e) => e.startsWith('immutable datum:'))).toBe(true);
      expect(changed.errors.every((e) => e.includes(KEY_A) && e.includes('user-project'))).toBe(true);
    }

    // the identical write again (same value, same storedAt) → the duplicate refusal
    const duplicate = await zone.put(
      write({ domain: 'user-project', key: KEY_A, value: { revision: 1 } }),
      storeOptions(),
    );
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) {
      expect(duplicate.errors.some((e) => e.startsWith('duplicate datum:'))).toBe(true);
      expect(duplicate.errors.every((e) => e.includes(KEY_A) && e.includes('user-project'))).toBe(true);
    }

    // the SAME key in a DIFFERENT domain is a different datum — the
    // (domain, key) pair is the address; there is no cross-domain overwrite
    const otherDomain = await zone.put(
      write({ domain: 'target-evidence', key: KEY_A, value: { revision: 1 } }),
      storeOptions(),
    );
    expect(otherDomain.ok).toBe(true);

    // measured counts: two domains, one datum each — nothing moved or merged
    expect(zone.counts()).toEqual({ 'user-project': 1, 'target-evidence': 1 });
  });

  test('the publish-leak guard refuses cross-origin writes — the §6 acceptance law, executable', async () => {
    const zone = zoneFor(TENANT_A);

    // §6 verbatim: "Library promotion must never accidentally publish
    // private project data" — 'user-project' data into 'package-library'
    // → REFUSED with the cross-domain publication error naming BOTH
    const leak = await zone.put(
      write({
        domain: 'package-library',
        key: KEY_D,
        value: VALUES_BY_DOMAIN['user-project'],
        originDomain: 'user-project',
      }),
      storeOptions(),
    );
    expect(leak.ok).toBe(false);
    if (!leak.ok) {
      expect(leak.errors.some((e) => e.startsWith('cross-domain publication refused:'))).toBe(true);
      expect(leak.errors.every((e) => e.includes('user-project') && e.includes('package-library'))).toBe(true);
    }

    // the generalization: every domain pair is guarded, not just the one
    // §6 names — 'target-evidence' into 'generated-code' → likewise refused
    const generalized = await zone.put(
      write({
        domain: 'generated-code',
        key: KEY_C,
        value: VALUES_BY_DOMAIN['target-evidence'],
        originDomain: 'target-evidence',
      }),
      storeOptions(),
    );
    expect(generalized.ok).toBe(false);
    if (!generalized.ok) {
      expect(generalized.errors.some((e) => e.startsWith('cross-domain publication refused:'))).toBe(true);
      expect(generalized.errors.every((e) => e.includes('target-evidence') && e.includes('generated-code'))).toBe(true);
    }

    // a PRESENT originDomain EQUAL to the target domain is the explicit
    // same-origin assertion — the write proceeds
    const sameOrigin = await zone.put(
      write({
        domain: 'package-library',
        key: KEY_D,
        value: VALUES_BY_DOMAIN['package-library'],
        originDomain: 'package-library',
      }),
      storeOptions(),
    );
    expect(sameOrigin.ok).toBe(true);

    // an ABSENT originDomain → the write proceeds (same-origin asserted
    // by omission — the documented v0.1 honesty)
    const noOrigin = await zone.put(
      write({ domain: 'package-library', key: 'router-parity@1.0.0', value: VALUES_BY_DOMAIN['package-library'] }),
      storeOptions(),
    );
    expect(noOrigin.ok).toBe(true);

    // nothing from the refused writes landed — only the two accepted keys
    expect(zone.list('package-library')).toEqual([KEY_D, 'router-parity@1.0.0']);
    expect(zone.counts()).toEqual({ 'package-library': 2 });
  });

  test('zones are tenant-scoped — one tenant\'s data is invisible to another', async () => {
    const zoneA = zoneFor(TENANT_A);
    const zoneB = zoneFor(TENANT_B); // a fresh createTenantZone with a different tenantId
    stored(await zoneA.put(
      write({ domain: 'user-project', key: KEY_A, value: VALUES_BY_DOMAIN['user-project'] }),
      storeOptions(),
    ));
    stored(await zoneA.put(
      write({ domain: 'generated-code', key: KEY_C, value: VALUES_BY_DOMAIN['generated-code'] }),
      storeOptions(),
    ));

    // zone B sees NOTHING: get null, list [], counts {}
    expect(zoneB.get('user-project', KEY_A)).toBeNull();
    expect(zoneB.get('generated-code', KEY_C)).toBeNull();
    expect(zoneB.list('user-project')).toEqual([]);
    expect(zoneB.list('generated-code')).toEqual([]);
    expect(zoneB.counts()).toEqual({});
    // B's snapshot is the EMPTY-zone digest — A's data never leaks into it
    expect(await zoneB.snapshot()).toMatch(ISO_SNAPSHOT_PATTERN);

    // zone A still sees its data, unchanged by B's existence
    expect(zoneA.get('user-project', KEY_A)?.key).toBe(KEY_A);
    expect(zoneA.get('generated-code', KEY_C)?.key).toBe(KEY_C);
    expect(zoneA.counts()).toEqual({ 'user-project': 1, 'generated-code': 1 });

    // and B's OWN write never leaks into A — the isolation is symmetric
    stored(await zoneB.put(
      write({ domain: 'user-project', key: KEY_E, value: VALUES_BY_DOMAIN['user-project'] }),
      storeOptions(),
    ));
    expect(zoneA.get('user-project', KEY_E)).toBeNull();
    expect(zoneA.counts()).toEqual({ 'user-project': 1, 'generated-code': 1 });
    expect(zoneB.counts()).toEqual({ 'user-project': 1 });
  });

  test('queries are honest — wrong-typed or missing lookups are null, hits are the stored verbatim datum', async () => {
    const zone = zoneFor(TENANT_A);
    const value = { nested: { list: [1, 2, 3], flag: true }, note: 'verbatim' };
    const original: unknown = JSON.parse(JSON.stringify(value));
    const first = await zone.put(
      write({ domain: 'benchmark-corpus', key: KEY_E, value }),
      storeOptions(),
    );
    expect(first.ok).toBe(true);
    if (first.ok) {
      // put echoes the stored record: the exact verbatim value, the caller's storedAt
      expect(first.datum.value).toEqual(original);
      expect(first.datum.storedAt).toBe(STORED_AT_A);
      expect(first.datum.domain).toBe('benchmark-corpus');
      expect(first.datum.key).toBe(KEY_E);
    }

    // ---- wrong-typed or missing lookups → null (queries never error) ----
    expect(zone.get(42, KEY_E)).toBeNull(); // a non-string domain
    expect(zone.get('user-project', 42)).toBeNull(); // a non-string key
    expect(zone.get('user-project', '')).toBeNull(); // an empty key (never storable)
    expect(zone.get('user-project', 'no-such-key')).toBeNull(); // an honest miss
    expect(zone.get('not-a-domain', KEY_E)).toBeNull(); // an off-vocabulary domain is a miss
    expect(zone.list(42)).toEqual([]); // a non-string domain lists nothing
    expect(zone.list('not-a-domain')).toEqual([]); // an unknown domain lists nothing
    expect(zone.list('')).toEqual([]);

    // ---- the hit is the stored verbatim datum ----
    const hit = zone.get('benchmark-corpus', KEY_E);
    expect(hit).not.toBeNull();
    expect(hit?.key).toBe(KEY_E);
    expect(hit?.domain).toBe('benchmark-corpus');
    expect(hit?.storedAt).toBe(STORED_AT_A);
    expect(hit?.value).toEqual(original); // the exact stored value object

    // an alias by construction (the registry precedent): two gets return
    // the SAME stored record, never two copies
    expect(zone.get('benchmark-corpus', KEY_E)).toBe(hit);

    // and the caller's input object was never aliased: mutating it after
    // the write cannot change what the zone holds (verbatim BY VALUE)
    value.nested.flag = false;
    value.note = 'tampered';
    expect(zone.get('benchmark-corpus', KEY_E)?.value).toEqual(original);
  });

  test('snapshots are content-addressed and never leak values — any change moves the id', async () => {
    const zone = zoneFor(TENANT_A);

    // the empty zone snapshots to a valid iso_ digest
    const empty = await zone.snapshot();
    expect(empty).toMatch(ISO_SNAPSHOT_PATTERN);

    // a marker value that must NEVER appear in the snapshot string
    const MARKER = 'CLAPP-072-SECRET-MARKER-7f3a91';
    const before = await zone.snapshot();
    stored(await zone.put(
      write({ domain: 'user-project', key: KEY_A, value: { secret: MARKER, depth: 2 } }),
      storeOptions(),
    ));
    const after = await zone.snapshot();
    expect(after).toMatch(ISO_SNAPSHOT_PATTERN);
    expect(after).not.toBe(before); // the write moved the snapshot
    expect(after).not.toBe(empty);
    // leak-free: the marker appears NOWHERE in the snapshot (values are hashed, never serialized)
    expect(after.includes(MARKER)).toBe(false);
    expect(empty.includes(MARKER)).toBe(false);

    // a second datum in a second domain moves it again
    stored(await zone.put(
      write({ domain: 'package-library', key: KEY_D, value: VALUES_BY_DOMAIN['package-library'] }),
      storeOptions(),
    ));
    const twoDomains = await zone.snapshot();
    expect(twoDomains).toMatch(ISO_SNAPSHOT_PATTERN);
    expect(twoDomains).not.toBe(after);
    expect(twoDomains.includes(MARKER)).toBe(false);

    // and a DIFFERENT key in the same domain moves it yet again — the
    // key is part of the content address
    stored(await zone.put(
      write({ domain: 'package-library', key: 'form-parity@1.0.0', value: VALUES_BY_DOMAIN['package-library'] }),
      storeOptions(),
    ));
    const grown = await zone.snapshot();
    expect(grown).not.toBe(twoDomains);
    expect(grown).toMatch(ISO_SNAPSHOT_PATTERN);
  });

  test('storedAt is caller-injected and validated — the zone never reads a clock', async () => {
    const zone = zoneFor(TENANT_A);

    // a non-RFC3339 storedAt refuses (named) — including the rollover date
    for (const bad of ['not-a-date', '2026-02-30T00:00:00Z', '2026-13-01T00:00:00Z', 42]) {
      const refused = await zone.put(
        write({ domain: 'user-project', key: KEY_A, value: DEFAULT_VALUE }),
        storeOptions({ storedAt: bad }),
      );
      expect(refused.ok).toBe(false);
      if (!refused.ok) {
        expect(refused.errors.some((e) => e.startsWith('options.storedAt:'))).toBe(true);
      }
    }
    // nothing was stored by the refused writes — the zone never guessed a timestamp
    expect(zone.counts()).toEqual({});

    // the timestamp is CONTENT: two identical writes with different
    // storedAt values are DISTINCT writes — the first lands, the second
    // is the changed-rewrite refusal
    const first = await zone.put(
      write({ domain: 'user-project', key: KEY_B, value: { v: 1 } }),
      storeOptions({ storedAt: STORED_AT_A }),
    );
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.datum.storedAt).toBe(STORED_AT_A);
    }
    const second = await zone.put(
      write({ domain: 'user-project', key: KEY_B, value: { v: 1 } }),
      storeOptions({ storedAt: STORED_AT_B }),
    );
    expect(second.ok).toBe(false); // same value, different storedAt → a DIFFERENT write
    if (!second.ok) {
      expect(second.errors.some((e) => e.startsWith('immutable datum:'))).toBe(true);
    }
    // the stored datum keeps the FIRST write's timestamp — the zone never rewrites
    expect(zone.get('user-project', KEY_B)?.storedAt).toBe(STORED_AT_A);

    // and the fully identical write (same storedAt too) is the duplicate refusal
    const duplicate = await zone.put(
      write({ domain: 'user-project', key: KEY_B, value: { v: 1 } }),
      storeOptions({ storedAt: STORED_AT_A }),
    );
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) {
      expect(duplicate.errors.some((e) => e.startsWith('duplicate datum:'))).toBe(true);
    }
  });
});
