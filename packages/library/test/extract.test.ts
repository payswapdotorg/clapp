// CLAPP-050 — the extractor tests: the fail-closed unverified-candidate
// gate (three killer fixtures), determinism (identical ports mint
// identical candidates), honest derivation (exact expected metadata, no
// fabrication), and honest counting with zero-package reasons.

import { describe, expect, test } from 'bun:test';
import { sha256Hex } from '@clapp/core';
import { canonicalJson } from '@clapp/observe';
import type { DiffReport } from '@clapp/diff';
import type { RepairLoopResult } from '@clapp/repair';
import { extractPackages } from '../src/extract';
import type { ExtractionPorts } from '../src/extract';
import {
  EV_NET_LEFT,
  EV_NET_RIGHT,
  EV_RUN_1_LEFT,
  EV_RUN_1_RIGHT,
  EV_RUN_2_LEFT,
  EV_RUN_2_RIGHT,
  GOLDEN_IDS,
  goldenApp,
  goldenPlan,
  goldenPorts,
} from './fixtures/golden';

const GOLDEN_OPTIONS = { generatedAt: '2026-09-28T12:00:00Z', version: '1.0.0' } as const;

// ---- killer / malformed port builders (one mutated field each) -------------------

function withReport(overrides: Partial<DiffReport>): ExtractionPorts {
  return {
    ...goldenPorts,
    parity: {
      report: { ...goldenPorts.parity.report, ...overrides },
      repair: goldenPorts.parity.repair,
    },
  };
}

function withRepair(overrides: Partial<RepairLoopResult>): ExtractionPorts {
  return {
    ...goldenPorts,
    parity: {
      report: goldenPorts.parity.report,
      repair: { ...goldenPorts.parity.repair, ...overrides },
    },
  };
}

function divergentPorts(): ExtractionPorts {
  return withReport({ verdict: 'divergent' });
}

function criticalPorts(): ExtractionPorts {
  return withReport({ counts: { ...goldenPorts.parity.report.counts, critical: 2 } });
}

function unconvergedPorts(): ExtractionPorts {
  return withRepair({ converged: false, remainingCriticalFindings: [GOLDEN_IDS.findingText] });
}

describe('the unverified-candidate gate', () => {
  test('the unverified-candidate gate fails closed — no package is ever minted from a divergent or unconverged parity', async () => {
    // killer 1: verdict 'divergent' (criticals 0, converged true)
    const divergent = await extractPackages(divergentPorts(), GOLDEN_OPTIONS);
    expect(divergent.gate).toBe('unverified-candidate');
    expect(divergent.packages).toEqual([]);
    expect(divergent.reason).toContain('verdict');
    expect(divergent.reason).toContain('divergent');

    // killer 2: counts.critical > 0 while verdict stays 'equivalent' — the
    // count condition is checked INDEPENDENTLY, so a lying verdict cannot
    // sneak a critical-laden build past the gate
    const criticals = await extractPackages(criticalPorts(), GOLDEN_OPTIONS);
    expect(criticals.gate).toBe('unverified-candidate');
    expect(criticals.packages).toEqual([]);
    expect(criticals.reason).toContain('critical');
    expect(criticals.reason).toContain('2');

    // killer 3: converged false (verdict 'equivalent', criticals 0)
    const unconverged = await extractPackages(unconvergedPorts(), GOLDEN_OPTIONS);
    expect(unconverged.gate).toBe('unverified-candidate');
    expect(unconverged.packages).toEqual([]);
    expect(unconverged.reason).toContain('converged');
  });
});

describe('determinism', () => {
  test('extraction is deterministic — identical ports mint identical candidates', async () => {
    const first = await extractPackages(goldenPorts, GOLDEN_OPTIONS);
    const second = await extractPackages(goldenPorts, GOLDEN_OPTIONS);
    expect(first).toEqual(second);
    expect(first.gate).toBe('verified');
    expect(first.packages).toHaveLength(1);

    const candidateA = first.packages[0]!;
    const candidateB = second.packages[0]!;
    expect(candidateA.manifest.id).toBe(candidateB.manifest.id);
    expect(candidateA.extractionContext.manifestSha256).toBe(candidateB.extractionContext.manifestSha256);

    // the record digest is honest: it equals sha256Hex(canonicalJson(manifest)) WITH the id
    expect(candidateA.extractionContext.manifestSha256).toBe(await sha256Hex(canonicalJson(candidateA.manifest)));
    expect(candidateB.extractionContext.manifestSha256).toBe(await sha256Hex(canonicalJson(candidateB.manifest)));
  });
});

describe('honest derivation', () => {
  test('extraction derives honest metadata from the plan', async () => {
    const result = await extractPackages(goldenPorts, GOLDEN_OPTIONS);
    expect(result.gate).toBe('verified');
    const candidate = result.packages[0]!;
    const manifest = candidate.manifest;

    // ---- contract + caller-injected fields ----
    expect(manifest.packageVersion).toBe('0.1');
    expect(manifest.version).toBe('1.0.0');
    expect(manifest.generatedAt).toBe('2026-09-28T12:00:00Z');
    expect(manifest.id).toMatch(/^pkg_[0-9a-f]{64}$/);

    // ---- extraction-derived fields: EXACTLY the plan/app facts, no fabrication ----
    expect(manifest.category).toBe('application');
    expect(manifest.purpose).toBe(
      'A synthesized web application "Nimbus Notes" serving 3 routes, 2 API endpoints, and 2 acceptance journeys.',
    );
    expect(manifest.interface).toEqual(['/', '/api/contact', '/api/status', '/contact', '/pricing']);
    expect(manifest.capabilities).toEqual(['api-mock', 'form', 'navigation', 'route', 'storage:cookie']);
    expect(manifest.constraints).toEqual([
      'no client-side scripting beyond declared storage writes',
      'preserve the observed data-testid attributes',
      'serve journeys from the observed entrypoints',
      'writes storage key "newsletter-email" (cookie)',
    ]);
    expect(manifest.dependencies).toEqual(['bun']);
    expect(manifest.supportedTargets).toEqual(['web']);
    expect(manifest.tests).toEqual([GOLDEN_IDS.acceptanceBrowse, GOLDEN_IDS.acceptanceContact]);
    expect(manifest.benchmark).toBe(null);
    expect(manifest.examples).toEqual([GOLDEN_IDS.journeyBrowse, GOLDEN_IDS.journeyContact]);
    expect(manifest.failureModes).toEqual([GOLDEN_IDS.findingText, GOLDEN_IDS.findingMock]);

    // evidence: the parity report's entries ONLY (plan-provenance evidence
    // never leaks in), deduped by evidenceId, sorted — the finding-anchor
    // ids (…0005/0006) sort BELOW the run ids (…0010-0013), and finding 1's
    // anchors re-cite the run evidence (dedup).
    expect(manifest.evidence).toEqual([
      EV_NET_LEFT,
      EV_NET_RIGHT,
      EV_RUN_1_LEFT,
      EV_RUN_1_RIGHT,
      EV_RUN_2_LEFT,
      EV_RUN_2_RIGHT,
    ]);

    // provenance: the content-addressed evidence chain over the actual ports
    expect(manifest.provenance).toEqual({
      planSha256: await sha256Hex(canonicalJson(goldenPlan)),
      appManifestSha256: await sha256Hex(canonicalJson(goldenApp.manifest)),
      diffReportId: GOLDEN_IDS.reportId,
      repairConverged: true,
      candidateBaseSha: GOLDEN_IDS.baseSha,
    });

    // the record: §5 stage 'candidate' ONLY, stamped with the work item
    expect(candidate.stage).toBe('candidate');
    expect(candidate.extractionContext.extractedBy).toBe('CLAPP-050');
  });
});

describe('honest counting', () => {
  test('extraction counts honestly and reports zero-package outcomes with reasons', async () => {
    // ---- verified: exactly one candidate, never more ----
    const verified = await extractPackages(goldenPorts, GOLDEN_OPTIONS);
    expect(verified.gate).toBe('verified');
    expect(verified.packages).toHaveLength(1);
    expect(verified.reason).toContain('1 package candidate');

    // ---- gate refusals: zero packages, honest non-empty reasons ----
    for (const ports of [divergentPorts(), criticalPorts(), unconvergedPorts()]) {
      const refused = await extractPackages(ports, GOLDEN_OPTIONS);
      expect(refused.packages).toEqual([]);
      expect(refused.gate).toBe('unverified-candidate');
      expect(typeof refused.reason).toBe('string');
      expect(refused.reason.length).toBeGreaterThan(0);
    }

    // ---- malformed ports: zero packages, reasons that NAME the class ----
    const planVersionMismatch: ExtractionPorts = {
      ...goldenPorts,
      plan: { ...goldenPlan, planVersion: '0.2' },
    };
    expect((await extractPackages(planVersionMismatch, GOLDEN_OPTIONS)).reason).toContain('planVersion');

    const emptyApp: ExtractionPorts = {
      ...goldenPorts,
      app: { ...goldenApp, files: [] },
    };
    expect((await extractPackages(emptyApp, GOLDEN_OPTIONS)).reason).toContain('files');

    const reportWithoutCounts: DiffReport = { ...goldenPorts.parity.report };
    delete (reportWithoutCounts as unknown as Record<string, unknown>).counts;
    const missingCounts: ExtractionPorts = {
      ...goldenPorts,
      parity: { report: reportWithoutCounts, repair: goldenPorts.parity.repair },
    };
    expect((await extractPackages(missingCounts, GOLDEN_OPTIONS)).reason).toContain('counts');

    for (const ports of [planVersionMismatch, emptyApp, missingCounts]) {
      const malformed = await extractPackages(ports, GOLDEN_OPTIONS);
      expect(malformed.gate).toBe('malformed');
      expect(malformed.packages).toEqual([]);
      expect(malformed.reason.length).toBeGreaterThan(0);
    }
  });
});
