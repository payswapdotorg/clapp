/**
 * @clapp/diff tests — report integrity, canonical serialization, determinism (CLAPP-040).
 *
 * - counts are COMPUTED from findings (verified on a divergent report from
 *   the mutated-candidate pipeline — the runner's own code path, never a
 *   hand-asserted table);
 * - serializeDiffReport/parseDiffReport round-trip byte-identical;
 * - parse rejects a wrong diffVersion, malformed input, tampered counts,
 *   a verdict that disagrees with the counts, and null-policy violations;
 * - determinism: same inputs + fixed id/time factories (fresh runners
 *   against the SAME servers) → byte-identical serialized reports;
 * - evidence discipline: capture entries + side bundle roots hash exactly
 *   as declared (cross-verified with @clapp/evidence's hashCanonicalJson —
 *   the devDependency's intended role).
 */

import { afterAll, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateApp, writeApp } from '@clapp/codegen';
import { hashCanonicalJson } from '@clapp/evidence';
import { sha256Hex } from '@clapp/core';
import { canonicalJson } from '@clapp/observe';
import { resolveFixtureRoot, startFixtureServer, type FixtureServer } from '@clapp/journey';
import { createPairedRunner } from './paired-runner';
import { createDeterministicDiffIdFactory } from './ids';
import { DiffReportError, parseDiffReport, serializeDiffReport } from './report';
import { CaptureCollector } from './capture';
import {
  GOLDEN_CANDIDATE_APP_ID,
  b01CorpusRootHash,
  buildGoldenB01Plan,
  loadSeededB01Journeys,
} from './golden-plan';
import { mutateGeneratedFile, spawnCandidate } from './test-support';

const FIXED_NOW = () => new Date('2026-09-27T00:00:00.000Z');

const scratchDirs: string[] = [];
let leftServer: FixtureServer | undefined;

afterAll(async () => {
  await leftServer?.close().catch(() => undefined);
  for (const dir of scratchDirs) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

/** A full dom-driver pipeline against the given (possibly mutated) candidate. */
async function runPipeline(mutations: Array<[string, Array<[string, string]>]> = []) {
  if (leftServer === undefined) {
    leftServer = await startFixtureServer({ root: resolveFixtureRoot() });
  }
  const [plan, journeys, baselineRootHash] = await Promise.all([
    buildGoldenB01Plan(),
    loadSeededB01Journeys(),
    b01CorpusRootHash(),
  ]);
  const app = generateApp(plan);
  const dir = await mkdtemp(join(tmpdir(), 'clapp-040-report-'));
  scratchDirs.push(dir);
  const root = await writeApp(app, dir);
  for (const [file, replacements] of mutations) {
    await mutateGeneratedFile(root, file, replacements);
  }
  const candidate = await spawnCandidate(root, app.manifest);
  const runner = createPairedRunner({
    journeys,
    left: { side: 'left', baseUrl: leftServer.url, targetId: 'bench/b01-static', driver: 'replayer-dom' },
    right: { side: 'right', baseUrl: candidate.url, targetId: GOLDEN_CANDIDATE_APP_ID, driver: 'replayer-dom' },
    candidateAppId: GOLDEN_CANDIDATE_APP_ID,
    baselineRootHash,
    plan,
    ids: createDeterministicDiffIdFactory(),
    now: FIXED_NOW,
  });
  try {
    const runs = [];
    for (const journey of journeys) {
      runs.push(await runner.runPair(journey.id));
    }
    const report = await runner.report(runs);
    return { report, runs };
  } finally {
    await candidate.close().catch(() => undefined);
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

describe('report integrity — counts are computed, verdicts are derived', () => {
  it(
    'a divergent report (mutated candidate, the runner code path) tallies its own findings',
    async () => {
      const { report } = await runPipeline([
        ['pages/pricing.html.ts', [['Simple, honest pricing', 'Simple, honest pricing!']]],
      ]);
      expect(report.findings.length).toBeGreaterThan(0);
      expect(report.counts.critical).toBeGreaterThanOrEqual(1);
      expect(report.verdict).toBe('divergent');
      // The counts equal the actual tallies of the findings list.
      const tally: Record<'critical' | 'major' | 'minor' | 'info', number> = {
        critical: 0,
        major: 0,
        minor: 0,
        info: 0,
      };
      for (const finding of report.findings) {
        tally[finding.severity] += 1;
      }
      expect(report.counts).toEqual(tally);
    },
    60_000,
  );

  it(
    'the equivalent golden report tallies zero everywhere',
    async () => {
      const { report } = await runPipeline();
      expect(report.counts).toEqual({ critical: 0, major: 0, minor: 0, info: 0 });
      expect(report.verdict).toBe('equivalent');
    },
    60_000,
  );
});

describe('serializeDiffReport / parseDiffReport — canonical round-trip', () => {
  it(
    'round-trips byte-identical (equivalent and divergent reports)',
    async () => {
      const [equivalent, divergent] = await Promise.all([
        runPipeline(),
        runPipeline([['pages/pricing.html.ts', [['Simple, honest pricing', 'Simple, honest pricing!']]]]),
      ]);
      for (const { report } of [equivalent, divergent]) {
        const text = serializeDiffReport(report);
        // Canonical form: object keys in sorted order, no whitespace between
        // tokens — the report's own first key proves the key ordering.
        expect(text.startsWith('{"baselineRootHash"')).toBe(true);
        expect(text.includes('\n')).toBe(false);
        const parsed = parseDiffReport(text);
        const reserialized = serializeDiffReport(parsed);
        expect(reserialized).toBe(text);
        // Absent per-step capture ids: null in JSON, undefined in memory.
        for (const run of parsed.runs) {
          for (const ids of [run.runs.left.stepPageIds, run.runs.right.stepPageIds]) {
            for (const entry of ids) {
              expect(entry === undefined || typeof entry === 'string').toBe(true);
            }
          }
          expect(run.runs.left.journeyId).toBe(run.journeyId);
        }
        expect(parsed.diffVersion).toBe('0.1');
        expect(parsed.counts).toEqual(report.counts);
        expect(parsed.verdict).toBe(report.verdict);
      }
    },
    60_000,
  );

  it('rejects a wrong diffVersion', () => {
    const base = serializeDiffReport(minimalValidReport());
    const tampered = JSON.parse(base) as Record<string, unknown>;
    tampered.diffVersion = '0.2';
    expect(() => parseDiffReport(JSON.stringify(tampered))).toThrow(DiffReportError);
    expect(() => parseDiffReport(JSON.stringify(tampered))).toThrow(/DIFF_VERSION/);
  });

  it('rejects malformed input', () => {
    expect(() => parseDiffReport('not json at all')).toThrow(DiffReportError);
    expect(() => parseDiffReport('null')).toThrow(DiffReportError);
    expect(() => parseDiffReport('{}')).toThrow(DiffReportError);
    expect(() => parseDiffReport('[]')).toThrow(DiffReportError);
  });

  it('rejects tampered counts (counts are computed, never asserted)', () => {
    const base = serializeDiffReport(minimalValidReport());
    const tampered = JSON.parse(base) as { counts: Record<string, number> };
    tampered.counts.info = 99;
    expect(() => parseDiffReport(JSON.stringify(tampered))).toThrow(DiffReportError);
    expect(() => parseDiffReport(JSON.stringify(tampered))).toThrow(/computed finding tally/);
  });

  it('rejects a verdict that disagrees with the critical count', () => {
    const base = serializeDiffReport(minimalValidReport());
    const tampered = JSON.parse(base) as { verdict: string };
    tampered.verdict = 'divergent';
    expect(() => parseDiffReport(JSON.stringify(tampered))).toThrow(DiffReportError);
    expect(() => parseDiffReport(JSON.stringify(tampered))).toThrow(/verdict/);
  });

  it('rejects null-policy and id-shape violations', () => {
    const base = serializeDiffReport(minimalValidReport());
    const nullSummary = JSON.parse(base) as { findings: Array<Record<string, unknown>> };
    nullSummary.findings[0]!.summary = null;
    expect(() => parseDiffReport(JSON.stringify(nullSummary))).toThrow(DiffReportError);

    const badId = JSON.parse(base) as { id: string };
    badId.id = 'diffr_not-a-uuid';
    expect(() => parseDiffReport(JSON.stringify(badId))).toThrow(DiffReportError);

    const badAppId = JSON.parse(base) as { candidateAppId: string };
    badAppId.candidateAppId = 'not-appsyn';
    expect(() => parseDiffReport(JSON.stringify(badAppId))).toThrow(DiffReportError);

    const badHash = JSON.parse(base) as { baselineRootHash: string };
    badHash.baselineRootHash = 'zz';
    expect(() => parseDiffReport(JSON.stringify(badHash))).toThrow(DiffReportError);
  });

  it('serializeDiffReport refuses to serialize a contract-violating report', () => {
    const report = minimalValidReport();
    report.counts = { critical: 5, major: 0, minor: 0, info: 0 }; // asserted, not computed
    expect(() => serializeDiffReport(report)).toThrow(DiffReportError);
  });
});

describe('determinism — fixed id/time factories ⇒ byte-identical reports', () => {
  it(
    'two independent pipelines against the same servers serialize identically',
    async () => {
      // One shared left server + one candidate server, used by both pipelines.
      const [plan, journeys, baselineRootHash] = await Promise.all([
        buildGoldenB01Plan(),
        loadSeededB01Journeys(),
        b01CorpusRootHash(),
      ]);
      if (leftServer === undefined) {
        leftServer = await startFixtureServer({ root: resolveFixtureRoot() });
      }
      const app = generateApp(plan);
      const dir = await mkdtemp(join(tmpdir(), 'clapp-040-det-'));
      scratchDirs.push(dir);
      const root = await writeApp(app, dir);
      const candidate = await spawnCandidate(root, app.manifest);
      try {
        const runOnce = async (): Promise<string> => {
          const runner = createPairedRunner({
            journeys,
            left: { side: 'left', baseUrl: leftServer!.url, targetId: 'bench/b01-static', driver: 'replayer-dom' },
            right: { side: 'right', baseUrl: candidate.url, targetId: GOLDEN_CANDIDATE_APP_ID, driver: 'replayer-dom' },
            candidateAppId: GOLDEN_CANDIDATE_APP_ID,
            baselineRootHash,
            plan,
            ids: createDeterministicDiffIdFactory(),
            now: FIXED_NOW,
          });
          const runs = [];
          for (const journey of journeys) {
            runs.push(await runner.runPair(journey.id));
          }
          return serializeDiffReport(await runner.report(runs));
        };

        const first = await runOnce();
        const second = await runOnce();
        expect(second).toBe(first);
      } finally {
        await candidate.close().catch(() => undefined);
        await rm(dir, { recursive: true, force: true }).catch(() => undefined);
      }
    },
    60_000,
  );
});

describe('evidence discipline — capture hashes verify exactly as declared', () => {
  it('entry refs and the side-bundle root hash re-verify (cross-checked with @clapp/evidence)', async () => {
    const collector = new CaptureCollector({
      side: 'right',
      targetId: GOLDEN_CANDIDATE_APP_ID,
      baseUrl: 'http://127.0.0.1:46240/',
      ids: createDeterministicDiffIdFactory(),
      now: FIXED_NOW,
    });
    collector.setActiveStep(0);
    await collector.recordPage({ subkind: 'page-html', stepIndex: 0, url: 'http://127.0.0.1:46240/', html: '<html><body><h1>x</h1></body></html>' });
    await collector.recordNetwork({
      subkind: 'http-transaction',
      stepIndex: 0,
      method: 'GET',
      url: 'http://127.0.0.1:46240/',
      status: 200,
      setCookie: ['k=v; Path=/'],
    });
    const bundle = await collector.sealBundle('journey_00000000-0000-4000-8000-000000000001', 'replayer-dom');

    // Every entry's EvidenceRef.sha256 is the sha256 of its canonical record…
    for (const entry of bundle.entries) {
      const record = { kind: entry.kind, ts: entry.ts, payload: entry.payload, redacted: entry.redacted };
      expect(await sha256Hex(canonicalJson(record))).toBe(entry.evidence.sha256);
      // …cross-verified with @clapp/evidence's canonical hashing.
      expect(await hashCanonicalJson(record)).toBe(entry.evidence.sha256);
    }
    // …and the side bundle root hash is the sha256 of its canonical manifest.
    const manifest = {
      side: bundle.side,
      journeyId: bundle.journeyId,
      targetId: bundle.targetId,
      driver: bundle.driver,
      entries: bundle.entries.map((entry) => entry.evidence),
    };
    expect(await sha256Hex(canonicalJson(manifest))).toBe(bundle.rootRef.sha256);
    expect(await hashCanonicalJson(manifest)).toBe(bundle.rootRef.sha256);
  });
});

/** The smallest contract-valid report (serialize/parse round-trip substrate). */
function minimalValidReport() {
  const evidence = {
    evidenceId: 'ev_00000000-0000-4000-8000-000000000001',
    kind: 'dom' as const,
    sha256: 'a'.repeat(64),
  };
  return {
    id: 'diffr_00000000-0000-4000-8000-000000000001',
    diffVersion: '0.1',
    candidateAppId: GOLDEN_CANDIDATE_APP_ID,
    baselineRootHash: 'b'.repeat(64),
    runs: [
      {
        journeyId: 'journey_00000000-0000-4000-8000-000000000001',
        transitionIds: [],
        left: { side: 'left' as const, baseUrl: 'http://127.0.0.1:1/', targetId: 'bench/b01-static', driver: 'replayer-dom' as const },
        right: { side: 'right' as const, baseUrl: 'http://127.0.0.1:2/', targetId: GOLDEN_CANDIDATE_APP_ID, driver: 'replayer-dom' as const },
        runs: {
          left: {
            side: 'left' as const,
            journeyId: 'journey_00000000-0000-4000-8000-000000000001',
            completed: true,
            stepsCompleted: 1,
            evidenceRef: evidence,
            stepPageIds: ['cap_00000000-0000-4000-8000-000000000001'],
            stepNetworkIds: [undefined],
            storageIds: [],
          },
          right: {
            side: 'right' as const,
            journeyId: 'journey_00000000-0000-4000-8000-000000000001',
            completed: true,
            stepsCompleted: 1,
            evidenceRef: evidence,
            stepPageIds: ['cap_00000000-0000-4000-8000-000000000002'],
            stepNetworkIds: [undefined],
            storageIds: [],
          },
        },
      },
    ],
    findings: [
      {
        id: 'diff_00000000-0000-4000-8000-000000000001',
        dimension: 'semantic' as const,
        severity: 'info' as const,
        summary: 'A minimal valid finding for round-trip substrate.',
        anchors: [{ stepIndex: 0, leftEvidence: evidence, rightEvidence: evidence, sourceIds: [] }],
      },
    ],
    counts: { critical: 0, major: 0, minor: 0, info: 1 },
    verdict: 'equivalent' as const,
    generatedAt: '2026-09-27T00:00:00.000Z',
  };
}
