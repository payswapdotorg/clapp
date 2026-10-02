// CLAPP-052 — retrieval manifest fixtures.
//
// NEW builder exports for the retrieval tests; the existing fixture exports
// (test/fixtures/golden.ts, test/fixtures/compat-manifests.ts) are untouched.
// Same conventions as both lanes: every sha256-shaped value is a hex
// placeholder (never a real content-address — retrieval consumes the
// manifest's DERIVED SIGNALS, not its provenance truth), every id is
// minted-SHAPED with a SHORT lowercase-hex seed so the ids sort
// lexicographically in a stable, predictable order ('a1' < 'b2' < …), and
// `generatedAt` is a fixed caller-injected constant (fixtures never read
// the clock).
//
// `retrievalManifest` builds a TYPE-COMPLETE, VALID PackageManifest v0.1 by
// default (it passes the frozen validator exactly as landed in CLAPP-050).
// The builder specializes exactly the retrieval-relevant axes: `purpose`
// (the lexical-similarity source), `capabilities` (the coverage source),
// `supportedTargets` (the candidacy gate), `evidenceCount` (parity history —
// real EvidenceRef entries, so the measured count is a list length, never an
// asserted number), `failureModeCount` (repair cost — same discipline), and
// `generatedAt` (recency). The `overrides` argument deliberately permits
// INVALID values (wrong packageVersion, unsorted capabilities, …) because
// the fail-closed tests inject them on purpose.

import type { EvidenceRef } from '@clapp/core';
import type { PackageManifest } from '../../src/package-contract';
import { PACKAGE_VERSION } from '../../src/package-contract';

/** 64-char lowercase-hex placeholder (the golden fixture's convention). */
export function hex64(seed: string): string {
  return seed.padEnd(64, '0');
}

/**
 * The frozen @clapp/core v0 EvidenceKind vocabulary, mirrored locally so the
 * fixture mints TYPE-COMPLETE evidence entries (the validator checks kind
 * membership; the mirror must stay in sync with EVIDENCE_KINDS — the
 * package-contract.test.ts suite pins the real vocabulary).
 */
const EVIDENCE_KIND_CYCLE: EvidenceRef['kind'][] = [
  'dom',
  'runtime',
  'network',
  'storage',
  'screenshot',
  'static',
  'user',
];

/**
 * One type-complete, valid EvidenceRef with a hex-placeholder digest — the
 * parity-history signal MEASURES list length, so the entries just need to be
 * real, distinct, validator-passing refs.
 */
function evidenceEntry(evidenceId: string, index: number, idSeed: string): EvidenceRef {
  return {
    evidenceId: `ev_${idSeed}_${index}`,
    kind: EVIDENCE_KIND_CYCLE[index % EVIDENCE_KIND_CYCLE.length]!,
    sha256: hex64(`e${index}`),
  };
}

/** Field overrides applied LAST over the default valid manifest. */
export type RetrievalManifestOverrides = Partial<PackageManifest>;

export interface RetrievalManifestSpec {
  /** Short lowercase-hex seed — the id is `'pkg_' + seed.padEnd(64, '0')`. */
  idSeed: string;
  /** The lexical-similarity source text (defaults to a seed-unique sentence). */
  purpose?: string;
  /** Sorted capability names (the manifest contract demands canonical order). */
  capabilities?: string[];
  /** Defaults to `['web']` (the frozen v0.1 extraction target). */
  supportedTargets?: string[];
  /** Mint this many valid evidence entries (parity history = list length). */
  evidenceCount?: number;
  /** Mint this many failure-mode ids (repair cost = list length). */
  failureModeCount?: number;
  /** Fixed RFC3339 constant (fixtures never read the clock). */
  generatedAt?: string;
  /** Applied after the defaults; deliberately-invalid values are the fail-closed tests' job. */
  overrides?: RetrievalManifestOverrides;
}

/**
 * A type-complete, VALID PackageManifest v0.1 (unless overridden), with the
 * retrieval-relevant facts left at honest, boring defaults the caller
 * specializes. `evidenceCount` / `failureModeCount` mint real list entries —
 * the measured signals are list lengths, never asserted numbers.
 */
export function retrievalManifest({
  idSeed,
  purpose,
  capabilities = [],
  supportedTargets = ['web'],
  evidenceCount = 0,
  failureModeCount = 0,
  generatedAt = '2026-10-02T12:00:00Z',
  overrides = {},
}: RetrievalManifestSpec): PackageManifest {
  const manifest: PackageManifest = {
    packageVersion: PACKAGE_VERSION,
    id: `pkg_${hex64(idSeed)}`,
    version: '1.0.0',
    category: 'application',
    purpose: purpose ?? `A retrieval fixture package (seed ${idSeed}).`,
    interface: [],
    capabilities: [...capabilities],
    constraints: [],
    dependencies: [],
    supportedTargets: [...supportedTargets],
    provenance: {
      // hex-shaped placeholders (fixture convention — provenance is not a
      // retrieval signal, so retrieval never reads it)
      planSha256: hex64('c0de'),
      appManifestSha256: hex64('face'),
      diffReportId: `diffr_00000000-0000-4000-8000-${idSeed.padStart(12, '0')}`,
      repairConverged: true,
      candidateBaseSha: null,
    },
    evidence: Array.from({ length: evidenceCount }, (_, index) =>
      evidenceEntry(`ev_${idSeed}_${index}`, index, idSeed),
    ),
    tests: [],
    benchmark: null,
    examples: [],
    failureModes: Array.from({ length: failureModeCount }, (_, index) => `finding_${idSeed}_${index}`),
    generatedAt,
  };
  return { ...manifest, ...overrides };
}

/**
 * The shared fixture corpus (fresh objects every call — no shared mutable
 * state): five manifests exercising every retrieval axis —
 *
 *   'a1' alpha   — web, {api-mock, form, route}, 3 evidence, 1 failure mode, newest-but-one
 *   'b2' beta    — web, {form, navigation, route}, 1 evidence, 0 failure modes, newest
 *   'c3' gamma   — web, {navigation}, 0 evidence, 4 failure modes, oldest
 *   'd4' delta   — DESKTOP-only, {storage:local} — the target-gate mismatch fixture
 *   'e5' epsilon — web, {} (no capabilities), 0 evidence, 0 failure modes
 *
 * The capability union across the corpus is {api-mock, form, navigation,
 * route, storage:local}; 'storage:local' lives ONLY on the desktop-target
 * manifest, so it is honestly UNSATISFIABLE for a 'web' query (the
 * satisfiability test's empty-with-reasons case).
 */
export function retrievalCorpus(): PackageManifest[] {
  return [
    retrievalManifest({
      idSeed: 'a1',
      purpose: 'A web form and route application with mocked api endpoints.',
      capabilities: ['api-mock', 'form', 'route'],
      evidenceCount: 3,
      failureModeCount: 1,
      generatedAt: '2026-10-04T12:00:00Z',
    }),
    retrievalManifest({
      idSeed: 'b2',
      purpose: 'A web application with forms, routes and navigation menus.',
      capabilities: ['form', 'navigation', 'route'],
      evidenceCount: 1,
      failureModeCount: 0,
      generatedAt: '2026-10-05T09:00:00Z',
    }),
    retrievalManifest({
      idSeed: 'c3',
      purpose: 'A minimal web navigation shell.',
      capabilities: ['navigation'],
      evidenceCount: 0,
      failureModeCount: 4,
      generatedAt: '2026-10-01T08:00:00Z',
    }),
    retrievalManifest({
      idSeed: 'd4',
      purpose: 'A desktop application with local storage bindings.',
      capabilities: ['storage:local'],
      supportedTargets: ['desktop'],
      evidenceCount: 2,
      failureModeCount: 2,
      generatedAt: '2026-10-03T12:00:00Z',
    }),
    retrievalManifest({
      idSeed: 'e5',
      purpose: 'A bare web shell with no declared capabilities.',
      capabilities: [],
      evidenceCount: 0,
      failureModeCount: 0,
      generatedAt: '2026-10-02T12:00:00Z',
    }),
  ];
}
