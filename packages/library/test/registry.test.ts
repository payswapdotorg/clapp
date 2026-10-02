// CLAPP-055 — the package registry tests (the W2 registry lane).
//
// Fixtures: test/fixtures/registry-fixtures.ts (NEW builders composing the
// shared replay-parity fixtures — candidates with REAL digests, promotions
// minted by the landed replayCandidate + promoteCandidate). The killer
// cases specialize exactly the registry axes: admission shape, caller-
// injected options, duplicate (id, version) keys, stage filter, query
// honesty, canonical order, defensive listings, and the content-addressed
// snapshot.

import { describe, expect, test } from 'bun:test';

import { createRegistry } from '../src/registry';
import type { PackageRegistry, RegistryRecord } from '../src/registry';
import { EXTRACTED_BY } from '../src/record';
import { PROMOTED_BY } from '../src/promotion';
import {
  REGISTERED_AT_A,
  REGISTERED_AT_B,
  REGISTERED_AT_C,
  registryCandidate,
  registryPromotion,
} from './fixtures/registry-fixtures';

/** Register and be loud about it — a fixture failure must not pass silently. */
async function admit(
  registry: PackageRegistry,
  input: unknown,
  registeredAt: string,
): Promise<RegistryRecord> {
  const result = await registry.register(input, { registeredAt });
  if (!result.ok) {
    throw new Error(`admission failed: ${result.errors.join('; ')}`);
  }
  return result.record;
}

describe('the package registry (CLAPP-055)', () => {
  test('the registry is deterministic — identical registrations in any order produce identical snapshots', async () => {
    const alpha = await registryCandidate({ idSeed: 'a1' });
    const beta = await registryCandidate({ idSeed: 'b2', version: '2.0.0' });
    const gamma = await registryPromotion({ idSeed: 'c3' });

    const forward = createRegistry();
    await admit(forward, alpha, REGISTERED_AT_A);
    await admit(forward, beta, REGISTERED_AT_B);
    await admit(forward, gamma, REGISTERED_AT_C);

    const reverse = createRegistry();
    await admit(reverse, gamma, REGISTERED_AT_C);
    await admit(reverse, beta, REGISTERED_AT_B);
    await admit(reverse, alpha, REGISTERED_AT_A);

    const rotated = createRegistry();
    await admit(rotated, beta, REGISTERED_AT_B);
    await admit(rotated, gamma, REGISTERED_AT_C);
    await admit(rotated, alpha, REGISTERED_AT_A);

    const forwardSnapshot = await forward.snapshot();
    expect(await reverse.snapshot()).toBe(forwardSnapshot);
    expect(await rotated.snapshot()).toBe(forwardSnapshot);
    expect(reverse.list()).toEqual(forward.list());
    expect(rotated.list()).toEqual(forward.list());
  });

  test('malformed inputs fail closed with named errors — never an exception', async () => {
    const registry = createRegistry();

    // A non-object input (each awaited call resolving is itself the
    // never-an-exception proof — a rejection would fail this test).
    const nonObject = await registry.register(42, { registeredAt: REGISTERED_AT_A });
    expect(nonObject.ok).toBe(false);
    if (!nonObject.ok) {
      expect(nonObject.errors.length).toBeGreaterThan(0);
      expect(nonObject.errors.some((error) => error.includes('input'))).toBe(true);
    }

    // A manifest failing the frozen validator (unsorted capabilities).
    const badManifest = await registryCandidate({
      idSeed: 'b2',
      overrides: { capabilities: ['form', 'api-mock'] }, // deliberately unsorted
    });
    const badManifestResult = await registry.register(badManifest, {
      registeredAt: REGISTERED_AT_A,
    });
    expect(badManifestResult.ok).toBe(false);
    if (!badManifestResult.ok) {
      expect(badManifestResult.errors.some((error) => error.includes('capabilities'))).toBe(true);
    }

    // A wrong promotionVersion.
    const wrongPromotionVersion = await registry.register(
      { ...(await registryPromotion({ idSeed: 'e5' })), promotionVersion: '0.9' },
      { registeredAt: REGISTERED_AT_A },
    );
    expect(wrongPromotionVersion.ok).toBe(false);
    if (!wrongPromotionVersion.ok) {
      expect(
        wrongPromotionVersion.errors.some((error) => error.includes('promotionVersion')),
      ).toBe(true);
    }

    // A non-RFC3339 registeredAt.
    const badTimestamp = await registry.register(await registryCandidate({ idSeed: 'd4' }), {
      registeredAt: 'not-a-timestamp',
    });
    expect(badTimestamp.ok).toBe(false);
    if (!badTimestamp.ok) {
      expect(badTimestamp.errors.some((error) => error.includes('registeredAt'))).toBe(true);
    }

    // Missing options.
    const missingOptions = await registry.register(
      await registryCandidate({ idSeed: 'f6' }),
      undefined,
    );
    expect(missingOptions.ok).toBe(false);
    if (!missingOptions.ok) {
      expect(missingOptions.errors.some((error) => error.includes('options'))).toBe(true);
    }

    // Fail closed: nothing above was stored.
    expect(registry.size()).toBe(0);
    expect(registry.list()).toEqual([]);
  });

  test('duplicate registration is refused — versions are immutable, the registry never overwrites', async () => {
    const registry = createRegistry();

    const first = await admit(registry, await registryCandidate({ idSeed: 'a1' }), REGISTERED_AT_A);
    expect(first.stage).toBe('candidate');

    // The same (id, version) — even via the other admission shape, with a
    // later timestamp — is refused with a named error carrying the EXISTING
    // stage ('candidate'), never an overwrite.
    const second = await registry.register(await registryPromotion({ idSeed: 'a1' }), {
      registeredAt: REGISTERED_AT_B,
    });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(
        second.errors.some(
          (error) =>
            error.includes('duplicate registration') &&
            error.includes(first.manifest.id) &&
            error.includes(first.manifest.version) &&
            error.includes('candidate'),
        ),
      ).toBe(true);
    }

    // The stored record is untouched: the original registration survives.
    const stored = registry.get(first.manifest.id, first.manifest.version);
    expect(stored).not.toBeNull();
    expect(stored?.registeredAt).toBe(REGISTERED_AT_A);
    expect(stored?.stage).toBe('candidate');

    // A DIFFERENT version of the same id is a legal sibling.
    await admit(registry, await registryCandidate({ idSeed: 'a1', version: '1.1.0' }), REGISTERED_AT_B);

    expect(registry.size()).toBe(2);
    expect(registry.entries()).toBe(2);
    expect(registry.list().map((record) => [record.manifest.id, record.manifest.version])).toEqual([
      [first.manifest.id, '1.0.0'],
      [first.manifest.id, '1.1.0'],
    ]);
  });

  test('candidate-shaped and promotion-shaped admissions both land at their stages', async () => {
    const registry = createRegistry();
    const candidate = await registryCandidate({ idSeed: 'a1' });
    const promotion = await registryPromotion({ idSeed: 'b2' });

    await admit(registry, candidate, REGISTERED_AT_A);
    await admit(registry, promotion, REGISTERED_AT_B);

    expect(registry.list({ stage: 'candidate' }).map((record) => record.manifest.id)).toEqual([
      candidate.manifest.id,
    ]);
    expect(registry.list({ stage: 'replayed' }).map((record) => record.manifest.id)).toEqual([
      promotion.manifest.id,
    ]);
    expect(registry.list().map((record) => record.stage).sort()).toEqual(['candidate', 'replayed']);

    const storedCandidate = registry.get(candidate.manifest.id, candidate.manifest.version);
    expect(storedCandidate?.stage).toBe('candidate');
    expect(storedCandidate?.registeredBy).toBe(EXTRACTED_BY);

    const storedPromotion = registry.get(promotion.manifest.id, promotion.manifest.version);
    expect(storedPromotion?.stage).toBe('replayed');
    expect(storedPromotion?.registeredBy).toBe(PROMOTED_BY);
    expect(storedPromotion?.registeredAt).toBe(REGISTERED_AT_B);
  });

  test('get queries honestly — non-string inputs and misses are null, hits are the record', async () => {
    const registry = createRegistry();
    const candidate = await registryCandidate({ idSeed: 'a1' });
    await admit(registry, candidate, REGISTERED_AT_A);

    expect(registry.get(42, '1.0.0')).toBeNull();
    expect(registry.get(candidate.manifest.id, 7)).toBeNull();
    expect(registry.get(null, '1.0.0')).toBeNull();
    expect(registry.get(candidate.manifest.id, undefined)).toBeNull();
    expect(registry.get('pkg_missing', '9.9.9')).toBeNull();
    expect(registry.get(candidate.manifest.id, '9.9.9')).toBeNull();

    const expected: RegistryRecord = {
      manifest: candidate.manifest,
      stage: 'candidate',
      registeredAt: REGISTERED_AT_A,
      registeredBy: EXTRACTED_BY,
    };
    expect(registry.get(candidate.manifest.id, candidate.manifest.version)).toEqual(expected);
  });

  test('listings are canonically ordered and defensively copied', async () => {
    const registry = createRegistry();
    const alphaV2 = await registryCandidate({ idSeed: 'a1', version: '2.0.0' });
    const alphaV1 = await registryCandidate({ idSeed: 'a1' });
    const mid = await registryCandidate({ idSeed: 'c3' });
    const zeta = await registryCandidate({ idSeed: 'f6' });

    // Registered in deliberately unsorted (id, version) order.
    await admit(registry, zeta, REGISTERED_AT_A);
    await admit(registry, alphaV2, REGISTERED_AT_A);
    await admit(registry, alphaV1, REGISTERED_AT_A);
    await admit(registry, mid, REGISTERED_AT_B);

    const listing = registry.list();
    expect(listing.map((record) => [record.manifest.id, record.manifest.version])).toEqual([
      [alphaV1.manifest.id, '1.0.0'],
      [alphaV2.manifest.id, '2.0.0'],
      [mid.manifest.id, '1.0.0'],
      [zeta.manifest.id, '1.0.0'],
    ]);

    // Mutating a returned record's arrays must not change the registry's
    // subsequent listings — nor may mutating the listing array itself.
    listing[0].manifest.interface.push('EVIL /route');
    listing[0].manifest.capabilities.push('mutated');
    listing.push({} as RegistryRecord);

    const after = registry.list();
    expect(after.length).toBe(4);
    expect(after[0].manifest.interface).toEqual([]);
    expect(after[0].manifest.capabilities).toEqual([]);
  });

  test('the snapshot is content-addressed — any change moves it, and the empty registry is valid', async () => {
    const registry = createRegistry();

    const empty = await registry.snapshot();
    expect(empty.startsWith('creg_')).toBe(true);
    expect(empty.length).toBeGreaterThan('creg_'.length);
    expect(await createRegistry().snapshot()).toBe(empty);

    await admit(registry, await registryCandidate({ idSeed: 'a1' }), REGISTERED_AT_A);
    const one = await registry.snapshot();
    expect(one).not.toBe(empty);
    expect(one.startsWith('creg_')).toBe(true);

    await admit(registry, await registryPromotion({ idSeed: 'b2' }), REGISTERED_AT_B);
    const two = await registry.snapshot();
    expect(two).not.toBe(one);

    // The same set, rebuilt in a different order, yields the same digest.
    const rebuilt = createRegistry();
    await admit(rebuilt, await registryPromotion({ idSeed: 'b2' }), REGISTERED_AT_B);
    await admit(rebuilt, await registryCandidate({ idSeed: 'a1' }), REGISTERED_AT_A);
    expect(await rebuilt.snapshot()).toBe(two);
  });

  test('registeredAt is caller-injected and the registry never reads a clock', async () => {
    const early = createRegistry();
    await admit(early, await registryCandidate({ idSeed: 'a1' }), '2025-01-01T00:00:00Z');
    const late = createRegistry();
    await admit(late, await registryCandidate({ idSeed: 'a1' }), '2030-06-15T12:30:00Z');

    // The timestamp is content: different caller-injected registeredAt values
    // produce different snapshots (and identical inputs and options always
    // produce identical ones — the determinism test — so no hidden clock).
    expect(await early.snapshot()).not.toBe(await late.snapshot());
    expect(early.list()[0]?.registeredAt).toBe('2025-01-01T00:00:00Z');
    expect(late.list()[0]?.registeredAt).toBe('2030-06-15T12:30:00Z');

    // A missing registeredAt is a named error, never a default.
    const missing = await createRegistry().register(await registryCandidate({ idSeed: 'b2' }), {});
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.errors.some((error) => error.includes('registeredAt'))).toBe(true);
    }

    // An invalid registeredAt (Feb 30 — a real calendar violation the frozen
    // isRfc3339 rejects) is a named error too.
    const invalid = await createRegistry().register(await registryCandidate({ idSeed: 'c3' }), {
      registeredAt: '2026-02-30T00:00:00Z',
    });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) {
      expect(invalid.errors.some((error) => error.includes('registeredAt'))).toBe(true);
    }
  });
});
