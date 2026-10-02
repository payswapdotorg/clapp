/**
 * @clapp/library — the package extractor (CLAPP-050).
 *
 * Extracts PackageManifest v0.1 candidates from the frozen P4 synthesis
 * and parity ports: a SynthesisPlan (@clapp/plan contract), the
 * GeneratedApp (@clapp/codegen contract), and the parity pair (DiffReport
 * from @clapp/diff + RepairLoopResult from @clapp/repair). ALL FOUR are
 * devDependencies imported for TYPES ONLY — the extractor consumes
 * contract-shaped DATA, never the implementations' behavior (pinned by
 * test/imports.test.ts). Runtime dependencies are exactly @clapp/core
 * (sha256Hex) and @clapp/observe (canonicalJson).
 *
 * THE UNVERIFIED-CANDIDATE GATE (fail-closed — the §8 contamination guard,
 * docs/LEARNING_AND_LIBRARY.md): a package is minted ONLY when
 *   parity.report.verdict === 'equivalent'  AND
 *   parity.report.counts.critical === 0      AND
 *   parity.repair.converged === true.
 * Otherwise the result is `{ packages: [], gate: 'unverified-candidate' }`
 * with the reason naming the failed condition — a divergent or
 * unconverged build is NEVER packaged. A malformed port (planVersion
 * mismatch, empty app, missing counts, …) returns gate 'malformed'.
 * These cases are RESULTS, never exceptions (the repo's honesty law).
 *
 * DETERMINISM: same ports + same options → byte-identical candidates.
 * All orderings are canonical (sorted); `generatedAt` and `version` are
 * CALLER-injected; the extractor never reads the clock, never reads
 * randomness, never reads the network. HONEST COUNTING: `packages`
 * carries zero or one candidate — counted as measured, never asserted.
 *
 * HONEST DERIVATION (v0.1 vocabulary, all documented in README.md):
 *   category      'application' — the whole verified candidate app;
 *   purpose       one sentence from plan.application facts + surface counts;
 *   interface     app.manifest.routePaths + apiEndpoints (sorted, deduped);
 *   capabilities  NAMED plan surfaces — 'route', 'navigation', 'form',
 *                 'storage:<kind>' per binding kind, 'api-mock' (never counts);
 *   constraints   plan.constraints verbatim + one derived storage fact per binding;
 *   dependencies  the start command's leading runtime executable, if any ([] otherwise);
 *   evidence      the parity report's evidence entries (deduped, sorted by evidenceId);
 *   tests         the plan's acceptance entry ids ([] when the plan names none);
 *   benchmark     null — never fabricated;
 *   examples      the acceptance entries' journey ids;
 *   failureModes  repair.attempts[].resolvedFindingIds (deduped, sorted; [] when repair never fired).
 */

import { sha256Hex } from '@clapp/core';
import type { EvidenceRef } from '@clapp/core';
import { canonicalJson } from '@clapp/observe';
import type { PlannedStorageBinding, SynthesisPlan } from '@clapp/plan';
import type { GeneratedApp } from '@clapp/codegen';
import type { DiffReport } from '@clapp/diff';
import type { RepairLoopResult } from '@clapp/repair';

import {
  isEvidenceRefShaped,
  isObject,
  isRfc3339,
  mintPackageId,
  PACKAGE_VERSION,
  preview,
  validatePackageManifest,
} from './package-contract';
import type { PackageManifest } from './package-contract';
import { EXTRACTED_BY } from './record';
import type { PackageCandidate } from './record';

// ---- frozen contract facts (hardcoded ON PURPOSE) ------------------------------
// The extractor may not import the contract owners at runtime (TYPES ONLY),
// so their frozen version strings are pinned here exactly like the pkg_
// prefix — a mismatch is a malformed port, never a silent coercion.

/** synthesis-contract v0.1 (@clapp/plan, frozen at P3). */
const SUPPORTED_PLAN_VERSION = '0.1';

/** diff-contract v0.1 (@clapp/diff, frozen at P4). */
const SUPPORTED_DIFF_VERSION = '0.1';

/** The plan-contract storage vocabulary (synthesis-contract v0.1). */
const STORAGE_KINDS: ReadonlySet<string> = new Set([
  'localStorage',
  'sessionStorage',
  'cookie',
  'server',
]);

/** The diff-contract verdict vocabulary (diff-contract v0.1). */
const DIFF_VERDICTS: ReadonlySet<string> = new Set(['equivalent', 'divergent']);

/**
 * v0.1 category: extraction packages the WHOLE verified candidate
 * application. The §3 component taxonomy (routing, forms, …) arrives with
 * the finer-grained extraction lanes.
 */
const CATEGORY = 'application';

/** ['web'] — the only synthesized target today (frozen v0.1 declaration). */
const SUPPORTED_TARGETS: readonly string[] = ['web'];

/** Runtime executables a start command's leading token may honestly name. */
const RUNTIME_EXECUTABLES: ReadonlySet<string> = new Set([
  'bun',
  'node',
  'deno',
  'npm',
  'npx',
  'pnpm',
  'yarn',
]);

// ---- the ports + the result -----------------------------------------------------

export interface ExtractionPorts {
  /** The synthesized plan (synthesis-contract v0.1; type-only import from '@clapp/plan'). */
  plan: SynthesisPlan;
  /** The generated candidate app (@clapp/codegen; type-only import from '@clapp/codegen'). */
  app: GeneratedApp;
  parity: {
    /** The paired differential verification report (diff-contract v0.1; type-only import from '@clapp/diff'). */
    report: DiffReport;
    /** The repair loop's outcome (diff-contract v0.1 via @clapp/repair; type-only import from '@clapp/repair'). */
    repair: RepairLoopResult;
  };
}

export interface ExtractOptions {
  /** RFC3339 timestamp — CALLER-injected; the extractor never reads the clock. */
  generatedAt: string;
  /** Immutable package version — CALLER-supplied (docs/WORKER_HANDOFFS.md: package versions are immutable). */
  version: string;
}

export interface ExtractionResult {
  /** Zero or more candidates — counted honestly, never asserted. */
  packages: PackageCandidate[];
  gate: 'verified' | 'unverified-candidate' | 'malformed';
  /** Human-readable, honest: names the failed condition or the minted count. */
  reason: string;
}

// ---- the extractor ----------------------------------------------------------------

export async function extractPackages(
  ports: ExtractionPorts,
  options: ExtractOptions,
): Promise<ExtractionResult> {
  const malformed = (reason: string): ExtractionResult => ({ packages: [], gate: 'malformed', reason });

  // ---- 1. caller-injected options (determinism: no clock, no randomness) ----
  if (!isRfc3339(options?.generatedAt)) {
    return malformed(
      `options.generatedAt: expected an RFC3339 date-time string (caller-injected — the extractor never reads the clock), got ${preview(options?.generatedAt)}`,
    );
  }
  if (typeof options?.version !== 'string' || options.version.length === 0) {
    return malformed(
      `options.version: expected a non-empty string (the immutable package version is caller-supplied), got ${preview(options?.version)}`,
    );
  }

  // ---- 2. structural (malformed) guards — results, never exceptions ----
  if (!isObject(ports)) return malformed('ports: expected an object');
  if (!isObject(ports.plan)) return malformed('ports.plan: expected a SynthesisPlan-shaped object');
  if (!isObject(ports.app)) return malformed('ports.app: expected a GeneratedApp-shaped object');
  if (!isObject(ports.parity)) return malformed('ports.parity: expected an object');
  if (!isObject(ports.parity.report)) {
    return malformed('ports.parity.report: expected a DiffReport-shaped object');
  }
  if (!isObject(ports.parity.repair)) {
    return malformed('ports.parity.repair: expected a RepairLoopResult-shaped object');
  }

  const { plan, app } = ports;
  const { report, repair } = ports.parity;

  // plan (the frozen synthesis contract v0.1 shape)
  if (plan.planVersion !== SUPPORTED_PLAN_VERSION) {
    return malformed(
      `ports.plan.planVersion: expected "${SUPPORTED_PLAN_VERSION}" (the frozen synthesis-contract version), got ${preview(plan.planVersion)}`,
    );
  }
  if (!isObject(plan.application)) {
    return malformed('ports.plan.application: expected an object');
  }
  if (typeof plan.application.name !== 'string' || plan.application.name.length === 0) {
    return malformed(
      `ports.plan.application.name: expected a non-empty string, got ${preview(plan.application.name)}`,
    );
  }
  if (typeof plan.application.platform !== 'string' || plan.application.platform.length === 0) {
    return malformed(
      `ports.plan.application.platform: expected a non-empty string, got ${preview(plan.application.platform)}`,
    );
  }
  if (!Array.isArray(plan.routes)) {
    return malformed(`ports.plan.routes: expected an array, got ${preview(plan.routes)}`);
  }
  if (!Array.isArray(plan.pages)) {
    return malformed(`ports.plan.pages: expected an array, got ${preview(plan.pages)}`);
  }
  for (let index = 0; index < plan.pages.length; index++) {
    const page = plan.pages[index];
    if (!isObject(page) || !Array.isArray(page.forms)) {
      return malformed(`ports.plan.pages[${index}]: expected an object with a forms array`);
    }
  }
  if (!Array.isArray(plan.navigation)) {
    return malformed(`ports.plan.navigation: expected an array, got ${preview(plan.navigation)}`);
  }
  if (!Array.isArray(plan.storage)) {
    return malformed(`ports.plan.storage: expected an array, got ${preview(plan.storage)}`);
  }
  for (let index = 0; index < plan.storage.length; index++) {
    const binding = plan.storage[index];
    if (!isObject(binding)) {
      return malformed(`ports.plan.storage[${index}]: expected an object`);
    }
    if (typeof binding.key !== 'string' || binding.key.length === 0) {
      return malformed(
        `ports.plan.storage[${index}].key: expected a non-empty string, got ${preview(binding.key)}`,
      );
    }
    if (typeof binding.storage !== 'string' || !STORAGE_KINDS.has(binding.storage)) {
      return malformed(
        `ports.plan.storage[${index}].storage: expected one of localStorage|sessionStorage|cookie|server, got ${preview(binding.storage)}`,
      );
    }
  }
  if (!isObject(plan.api) || !Array.isArray(plan.api.endpoints)) {
    return malformed('ports.plan.api.endpoints: expected an array');
  }
  if (!Array.isArray(plan.acceptance)) {
    return malformed(`ports.plan.acceptance: expected an array, got ${preview(plan.acceptance)}`);
  }
  for (let index = 0; index < plan.acceptance.length; index++) {
    const acceptance = plan.acceptance[index];
    if (!isObject(acceptance)) {
      return malformed(`ports.plan.acceptance[${index}]: expected an object`);
    }
    if (typeof acceptance.id !== 'string' || acceptance.id.length === 0) {
      return malformed(`ports.plan.acceptance[${index}].id: expected a non-empty string`);
    }
    if (typeof acceptance.journeyId !== 'string' || acceptance.journeyId.length === 0) {
      return malformed(`ports.plan.acceptance[${index}].journeyId: expected a non-empty string`);
    }
  }
  if (!Array.isArray(plan.constraints)) {
    return malformed(`ports.plan.constraints: expected an array, got ${preview(plan.constraints)}`);
  }
  for (let index = 0; index < plan.constraints.length; index++) {
    if (typeof plan.constraints[index] !== 'string') {
      return malformed(
        `ports.plan.constraints[${index}]: expected a string, got ${preview(plan.constraints[index])}`,
      );
    }
  }

  // app (the frozen codegen contract shape)
  if (!Array.isArray(app.files) || app.files.length === 0) {
    return malformed(
      `ports.app.files: expected a NON-EMPTY array (an empty app cannot be packaged), got ${preview(app.files)}`,
    );
  }
  if (!isObject(app.manifest)) {
    return malformed('ports.app.manifest: expected an AppManifest-shaped object');
  }
  if (!Array.isArray(app.manifest.routePaths)) {
    return malformed('ports.app.manifest.routePaths: expected an array');
  }
  for (let index = 0; index < app.manifest.routePaths.length; index++) {
    if (typeof app.manifest.routePaths[index] !== 'string') {
      return malformed(`ports.app.manifest.routePaths[${index}]: expected a string`);
    }
  }
  if (!Array.isArray(app.manifest.apiEndpoints)) {
    return malformed('ports.app.manifest.apiEndpoints: expected an array');
  }
  for (let index = 0; index < app.manifest.apiEndpoints.length; index++) {
    if (typeof app.manifest.apiEndpoints[index] !== 'string') {
      return malformed(`ports.app.manifest.apiEndpoints[${index}]: expected a string`);
    }
  }
  if (typeof app.manifest.startCommand !== 'string') {
    return malformed(
      `ports.app.manifest.startCommand: expected a string, got ${preview(app.manifest.startCommand)}`,
    );
  }

  // parity report (the frozen diff contract v0.1 shape)
  if (typeof report.id !== 'string' || report.id.length === 0) {
    return malformed(
      `ports.parity.report.id: expected a non-empty string, got ${preview(report.id)}`,
    );
  }
  if (report.diffVersion !== SUPPORTED_DIFF_VERSION) {
    return malformed(
      `ports.parity.report.diffVersion: expected "${SUPPORTED_DIFF_VERSION}" (the frozen diff-contract version), got ${preview(report.diffVersion)}`,
    );
  }
  if (typeof report.verdict !== 'string' || !DIFF_VERDICTS.has(report.verdict)) {
    return malformed(
      `ports.parity.report.verdict: expected 'equivalent' | 'divergent', got ${preview(report.verdict)}`,
    );
  }
  if (!isObject(report.counts)) {
    return malformed(
      `ports.parity.report.counts: expected an object (missing counts), got ${preview(report.counts)}`,
    );
  }
  for (const severity of ['critical', 'major', 'minor', 'info'] as const) {
    const count = report.counts[severity];
    if (typeof count !== 'number' || !Number.isFinite(count)) {
      return malformed(
        `ports.parity.report.counts.${severity}: expected a finite number, got ${preview(count)}`,
      );
    }
  }
  if (!Array.isArray(report.runs)) {
    return malformed(`ports.parity.report.runs: expected an array, got ${preview(report.runs)}`);
  }
  for (let index = 0; index < report.runs.length; index++) {
    if (!isObject(report.runs[index])) {
      return malformed(`ports.parity.report.runs[${index}]: expected an object`);
    }
  }
  if (!Array.isArray(report.findings)) {
    return malformed(
      `ports.parity.report.findings: expected an array, got ${preview(report.findings)}`,
    );
  }
  for (let index = 0; index < report.findings.length; index++) {
    if (!isObject(report.findings[index])) {
      return malformed(`ports.parity.report.findings[${index}]: expected an object`);
    }
  }

  // parity repair (the frozen repair loop contract shape)
  if (typeof repair.converged !== 'boolean') {
    return malformed(
      `ports.parity.repair.converged: expected a boolean, got ${preview(repair.converged)}`,
    );
  }
  if (!Array.isArray(repair.attempts)) {
    return malformed(
      `ports.parity.repair.attempts: expected an array, got ${preview(repair.attempts)}`,
    );
  }
  for (let index = 0; index < repair.attempts.length; index++) {
    const attempt = repair.attempts[index];
    if (!isObject(attempt)) {
      return malformed(`ports.parity.repair.attempts[${index}]: expected an object`);
    }
    if (
      'baseSha' in attempt &&
      (typeof attempt.baseSha !== 'string' || attempt.baseSha.length === 0)
    ) {
      return malformed(`ports.parity.repair.attempts[${index}].baseSha: expected a non-empty string`);
    }
    if ('resolvedFindingIds' in attempt && !Array.isArray(attempt.resolvedFindingIds)) {
      return malformed(
        `ports.parity.repair.attempts[${index}].resolvedFindingIds: expected an array`,
      );
    }
    if (Array.isArray(attempt.resolvedFindingIds)) {
      for (let inner = 0; inner < attempt.resolvedFindingIds.length; inner++) {
        const findingId = attempt.resolvedFindingIds[inner];
        if (typeof findingId !== 'string' || findingId.length === 0) {
          return malformed(
            `ports.parity.repair.attempts[${index}].resolvedFindingIds[${inner}]: expected a non-empty string`,
          );
        }
      }
    }
  }

  // ---- 3. THE UNVERIFIED-CANDIDATE GATE (fail-closed §8 contamination guard) ----
  if (report.verdict !== 'equivalent') {
    return {
      packages: [],
      gate: 'unverified-candidate',
      reason: `unverified-candidate gate: parity.report.verdict is ${preview(report.verdict)} (expected 'equivalent') — a divergent build is never packaged`,
    };
  }
  if (report.counts.critical !== 0) {
    return {
      packages: [],
      gate: 'unverified-candidate',
      reason: `unverified-candidate gate: parity.report.counts.critical is ${report.counts.critical} (expected 0) — a build with critical findings is never packaged`,
    };
  }
  if (repair.converged !== true) {
    return {
      packages: [],
      gate: 'unverified-candidate',
      reason: `unverified-candidate gate: parity.repair.converged is ${preview(repair.converged)} (expected true) — an unconverged repair is never packaged`,
    };
  }

  // ---- 4. provenance digests (content-addressed, never asserted) ----
  const planSha256 = await hashCanonical(plan);
  if (planSha256 === null) {
    return malformed(
      'ports.plan: not canonical-JSON serializable — the provenance digest (planSha256) cannot be computed honestly',
    );
  }
  const appManifestSha256 = await hashCanonical(app.manifest);
  if (appManifestSha256 === null) {
    return malformed(
      'ports.app.manifest: not canonical-JSON serializable — the provenance digest (appManifestSha256) cannot be computed honestly',
    );
  }

  // ---- 5. honest derivation (deterministic) ----
  const unsigned: Omit<PackageManifest, 'id'> = {
    packageVersion: PACKAGE_VERSION,
    version: options.version,
    category: CATEGORY,
    purpose: derivePurpose(plan),
    interface: sortedUnion(app.manifest.routePaths, app.manifest.apiEndpoints),
    capabilities: deriveCapabilities(plan),
    constraints: sortedUnion(plan.constraints, plan.storage.map((binding) => storageFact(binding))),
    dependencies: deriveDependencies(app.manifest.startCommand),
    supportedTargets: [...SUPPORTED_TARGETS],
    provenance: {
      planSha256,
      appManifestSha256,
      diffReportId: report.id,
      repairConverged: repair.converged,
      candidateBaseSha: candidateBaseShaOf(repair),
    },
    evidence: collectEvidenceRefs(report),
    tests: sortedSet(plan.acceptance.map((acceptance) => acceptance.id)),
    benchmark: null,
    examples: sortedSet(plan.acceptance.map((acceptance) => acceptance.journeyId)),
    failureModes: collectResolvedFindingIds(repair),
    generatedAt: options.generatedAt,
  };

  // ---- 6. mint the content-addressed identity ----
  let id: string;
  try {
    id = await mintPackageId(unsigned as PackageManifest);
  } catch {
    return malformed(
      'minting failed: the derived manifest is not canonical-JSON serializable (non-plain plan/app data)',
    );
  }
  const manifest: PackageManifest = { ...unsigned, id };

  // ---- 7. fail-closed self-check: nothing invalid is ever packaged ----
  const check = validatePackageManifest(manifest);
  if (!check.ok) {
    return malformed(
      `the minted manifest failed its own validation (an extraction bug — nothing is packaged): ${check.errors.join('; ')}`,
    );
  }
  const manifestSha256 = await hashCanonical(manifest);
  if (manifestSha256 === null) {
    return malformed(
      'the minted manifest is not canonical-JSON serializable (an extraction bug — nothing is packaged)',
    );
  }

  const packages: PackageCandidate[] = [
    {
      manifest,
      stage: 'candidate',
      extractionContext: {
        extractedBy: EXTRACTED_BY,
        manifestSha256,
      },
    },
  ];

  return {
    packages,
    gate: 'verified',
    reason: `parity verified (verdict 'equivalent', ${report.counts.critical} critical findings, repair converged) — minted ${packages.length} package candidate at stage 'candidate' (promotion is a later, test-gated lane)`,
  };
}

// ---- derivation helpers (pure, deterministic, honest) ------------------------------

function derivePurpose(plan: SynthesisPlan): string {
  return `A synthesized ${plan.application.platform} application "${plan.application.name}" serving ${plan.routes.length} routes, ${plan.api.endpoints.length} API endpoints, and ${plan.acceptance.length} acceptance journeys.`;
}

/**
 * NAMED plan surfaces, never counts: 'route', 'navigation', 'form',
 * 'storage:<kind>' (one per distinct binding kind), 'api-mock'.
 */
function deriveCapabilities(plan: SynthesisPlan): string[] {
  const capabilities = new Set<string>();
  if (plan.routes.length > 0) capabilities.add('route');
  if (plan.navigation.length > 0) capabilities.add('navigation');
  if (
    plan.pages.some((page) => isObject(page) && Array.isArray(page.forms) && page.forms.length > 0)
  ) {
    capabilities.add('form');
  }
  for (const binding of plan.storage) {
    capabilities.add(`storage:${binding.storage}`);
  }
  if (plan.api.endpoints.length > 0) capabilities.add('api-mock');
  return [...capabilities].sort();
}

function storageFact(binding: PlannedStorageBinding): string {
  return `writes storage key "${binding.key}" (${binding.storage})`;
}

/** The start command's leading runtime executable, when it honestly names one. */
function deriveDependencies(startCommand: string): string[] {
  const executable = startCommand.trim().split(/\s+/)[0] ?? '';
  return RUNTIME_EXECUTABLES.has(executable) ? [executable] : [];
}

/**
 * The parity report's evidence entries: per-side run evidenceRefs and
 * finding-anchor evidence refs, deduped by evidenceId (first citation
 * wins), sorted by evidenceId. Traversal is defensive (never throws):
 * only well-formed EvidenceRef-shaped entries are collected — absent
 * anchor evidence is legal (optional per the diff contract) and
 * malformed entries contribute nothing (the gate conditions above remain
 * the packaging authority).
 */
function collectEvidenceRefs(report: DiffReport): EvidenceRef[] {
  const byId = new Map<string, EvidenceRef>();
  const add = (value: unknown): void => {
    if (isEvidenceRefShaped(value) && !byId.has(value.evidenceId)) {
      byId.set(value.evidenceId, value);
    }
  };
  for (const run of report.runs) {
    if (!isObject(run)) continue;
    const sides = run.runs;
    if (!isObject(sides)) continue;
    const left = sides.left;
    const right = sides.right;
    if (isObject(left)) add(left.evidenceRef);
    if (isObject(right)) add(right.evidenceRef);
  }
  for (const finding of report.findings) {
    if (!isObject(finding)) continue;
    const anchors = finding.anchors;
    if (!Array.isArray(anchors)) continue;
    for (const anchor of anchors) {
      if (!isObject(anchor)) continue;
      add(anchor.leftEvidence);
      add(anchor.rightEvidence);
    }
  }
  return [...byId.values()].sort(byEvidenceId);
}

function byEvidenceId(left: EvidenceRef, right: EvidenceRef): number {
  return left.evidenceId < right.evidenceId ? -1 : left.evidenceId > right.evidenceId ? 1 : 0;
}

/**
 * The finding ids the repair attempts resolved — the failure knowledge
 * the library is supposed to learn from ([] when repair never fired).
 */
function collectResolvedFindingIds(repair: RepairLoopResult): string[] {
  const ids = new Set<string>();
  for (const attempt of repair.attempts) {
    if (!isObject(attempt)) continue;
    const resolved = attempt.resolvedFindingIds;
    if (!Array.isArray(resolved)) continue;
    for (const findingId of resolved) {
      if (typeof findingId === 'string' && findingId.length > 0) ids.add(findingId);
    }
  }
  return [...ids].sort();
}

/** repair.attempts[0]?.baseSha ?? null — honest (null when repair never fired). */
function candidateBaseShaOf(repair: RepairLoopResult): string | null {
  const first = repair.attempts[0];
  if (first === undefined || !isObject(first)) return null;
  const baseSha = first.baseSha;
  return typeof baseSha === 'string' && baseSha.length > 0 ? baseSha : null;
}

function sortedSet(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function sortedUnion(left: readonly string[], right: readonly string[]): string[] {
  return sortedSet([...left, ...right]);
}

/** sha256Hex(canonicalJson(value)) — null when the value cannot be canonicalized. */
async function hashCanonical(value: unknown): Promise<string | null> {
  try {
    return await sha256Hex(canonicalJson(value));
  } catch {
    return null;
  }
}
