// CLAPP-050 — the manifest contract tests: fail-closed field-by-field
// validation (every malformed class names its field, ALL errors collected),
// content-addressed id stability, canonical byte-stability + round-trip.

import { describe, expect, test } from 'bun:test';
import { canonicalPackageJson, mintPackageId, validatePackageManifest } from '../src/package-contract';
import type { PackageManifest } from '../src/package-contract';
import { extractPackages } from '../src/extract';
import { goldenPorts } from './fixtures/golden';

const GOLDEN_OPTIONS = { generatedAt: '2026-09-28T12:00:00Z', version: '1.0.0' } as const;

/** The manifest the extractor mints from the golden ports (verified gate). */
async function goldenManifest(): Promise<PackageManifest> {
  const result = await extractPackages(goldenPorts, GOLDEN_OPTIONS);
  if (result.gate !== 'verified' || result.packages.length !== 1) {
    throw new Error(`golden extraction unexpectedly gate '${result.gate}': ${result.reason}`);
  }
  return result.packages[0]!.manifest;
}

describe('the package manifest contract v0.1', () => {
  test('the manifest contract validates a well-formed package and rejects every malformed shape by field', async () => {
    // ---- happy path: the extractor-minted golden manifest is well-formed ----
    const good = await goldenManifest();
    expect(validatePackageManifest(good)).toEqual({ ok: true });
    const base: Record<string, unknown> = { ...good };

    // ---- missing field (top-level) ----
    const missingPurpose = { ...base };
    delete missingPurpose.purpose;
    const missing = validatePackageManifest(missingPurpose);
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.errors.length).toBeGreaterThan(0);
      expect(missing.errors.some((error) => error.includes('purpose'))).toBe(true);
    }

    // ---- missing field (nested provenance) ----
    const missingPlanSha = { ...base, provenance: { ...(base.provenance as object) } };
    delete (missingPlanSha.provenance as Record<string, unknown>).planSha256;
    const missingNested = validatePackageManifest(missingPlanSha);
    expect(missingNested.ok).toBe(false);
    if (!missingNested.ok) {
      expect(missingNested.errors.some((error) => error.includes('provenance.planSha256'))).toBe(true);
    }

    // ---- wrong packageVersion ----
    const wrongVersion = validatePackageManifest({ ...base, packageVersion: '0.2' });
    expect(wrongVersion.ok).toBe(false);
    if (!wrongVersion.ok) {
      expect(wrongVersion.errors.some((error) => error.includes('packageVersion'))).toBe(true);
    }

    // ---- unsorted arrays: all four canonical-order fields at once ----
    const unsorted = validatePackageManifest({
      ...base,
      interface: ['/pricing', '/', '/api/status'],
      capabilities: ['route', 'api-mock'],
      constraints: ['writes storage key "x" (cookie)', 'alpha'],
      supportedTargets: ['web', 'native'],
    });
    expect(unsorted.ok).toBe(false);
    if (!unsorted.ok) {
      for (const field of ['interface', 'capabilities', 'constraints', 'supportedTargets']) {
        expect(unsorted.errors.some((error) => error.includes(field))).toBe(true);
      }
    }

    // ---- non-RFC3339 generatedAt (lexically bad + calendar-invalid + space-separated) ----
    for (const bad of ['not-rfc3339', '2026-02-30T00:00:00Z', '2026-09-28 12:00:00']) {
      const check = validatePackageManifest({ ...base, generatedAt: bad });
      expect(check.ok).toBe(false);
      if (!check.ok) {
        expect(check.errors.some((error) => error.includes('generatedAt'))).toBe(true);
      }
    }

    // ---- benchmark as number (NEVER acceptable — a benchmark is a reference) ----
    const benchmarkNumber = validatePackageManifest({ ...base, benchmark: 1234 });
    expect(benchmarkNumber.ok).toBe(false);
    if (!benchmarkNumber.ok) {
      expect(benchmarkNumber.errors.some((error) => error.includes('benchmark'))).toBe(true);
    }

    // ---- collect ALL errors: two independent defects are BOTH reported ----
    const combined = validatePackageManifest({ ...base, packageVersion: '0.2', benchmark: 1234 });
    expect(combined.ok).toBe(false);
    if (!combined.ok) {
      expect(combined.errors.some((error) => error.includes('packageVersion'))).toBe(true);
      expect(combined.errors.some((error) => error.includes('benchmark'))).toBe(true);
    }

    // ---- not an object at all ----
    expect(validatePackageManifest(null).ok).toBe(false);
    expect(validatePackageManifest('nope').ok).toBe(false);
  });

  test('package ids are content-addressed and stable across identical inputs', async () => {
    const manifest = await goldenManifest();

    // same manifest twice → the same id
    const first = await mintPackageId(manifest);
    const second = await mintPackageId(manifest);
    expect(first).toBe(second);
    expect(first).toMatch(/^pkg_[0-9a-f]{64}$/);

    // one capability changed → a different id
    const changed: PackageManifest = {
      ...manifest,
      capabilities: [...manifest.capabilities, 'storage:localStorage'].sort(),
    };
    const third = await mintPackageId(changed);
    expect(third).toMatch(/^pkg_[0-9a-f]{64}$/);
    expect(third).not.toBe(first);

    // the hash function is injectable (deterministic consumers)
    const fakeHash = async (): Promise<string> => 'f'.repeat(64);
    expect(await mintPackageId(manifest, fakeHash)).toBe(`pkg_${'f'.repeat(64)}`);
  });

  test('canonical serialization is byte-stable and round-trips', async () => {
    const manifest = await goldenManifest();

    // serialize twice → identical strings
    const text1 = canonicalPackageJson(manifest);
    const text2 = canonicalPackageJson(manifest);
    expect(text1).toBe(text2);

    // key-insertion-order independence: a reversed-key clone → identical bytes
    const asRecord: Record<string, unknown> = { ...manifest };
    const reordered: Record<string, unknown> = {};
    for (const key of Object.keys(manifest).reverse()) {
      reordered[key] = asRecord[key];
    }
    expect(canonicalPackageJson(reordered as unknown as PackageManifest)).toBe(text1);

    // the id field is excluded from the canonical form
    expect(text1).not.toContain('"id"');
    expect(Object.keys(JSON.parse(text1))).not.toContain('id');

    // parse round-trip preserves every field (deep equality, id aside)
    const parsed = JSON.parse(text1) as Record<string, unknown>;
    const expected: Record<string, unknown> = { ...manifest };
    delete expected.id;
    expect(parsed).toEqual(expected);
  });
});
