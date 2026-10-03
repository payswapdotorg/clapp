/**
 * @clapp/learn — the improvement benchmark (CLAPP-064).
 *
 * The P6 CLOSING lane, OWNED AND IMPLEMENTED BY THE TECH LEAD (the
 * integration authority — docs/WORK_ITEMS.md: "CLAPP-064 — Improvement
 * benchmark, Owner: tech lead, Depends on: 061,063"). The P6 acceptance
 * gate reads: "repeated benchmark families show measurable reduction in
 * build/repair work" — this module is that gate's EXECUTABLE HARNESS: run
 * a benchmark family (a set of retrieval queries against ORDERED library
 * snapshots), measure every plan the frozen composition machinery
 * produces, and report the measured deltas with an honest verdict.
 *
 * WHAT IS MEASURED (v0.1, honest scope): the composition pipeline's
 * observable work facts — how many components a query SELECTS (selected
 * coverage: more pre-built, verified components = less gap-filling build
 * work), how many it EXCLUDES and CONSIDERS, and the selected components'
 * mean retrieval score. "Repair work" reduction enters through the
 * excluded/considered facts (a candidate excluded for a conflict is
 * measured work avoided downstream — never a claimed repair). The report
 * NEVER fabricates a reduction: every number is measured from the plans
 * the frozen machinery actually produced, and the verdict is a cascade
 * over those measurements.
 *
 * THE FAMILY CONTRACT: an ordered list of library SNAPSHOTS (each a
 * PackageManifest corpus — the later snapshots represent the library
 * after learning/growth: extraction feeding it, patterns mined, packages
 * promoted) and a fixed list of retrieval QUERIES. Every query is planned
 * against EVERY snapshot through the frozen planComposition; per-snapshot
 * aggregates and per-consecutive-snapshot DELTAS are measured; the
 * verdict follows:
 *
 *   'improvement-detected' — every consecutive pair's totalSelected is
 *                            non-decreasing AND at least one strictly
 *                            increased AND no single query's selected
 *                            count ever decreased;
 *   'regression'           — some query's selected count decreased
 *                            between consecutive snapshots (named);
 *   'no-improvement'       — everything else (including the honest
 *                            nothing-measured case: zero queries or
 *                            fewer than two snapshots).
 *
 * Discipline (binding — the 060..063 house rules): fail-closed results
 * (ALL errors collected, each naming its field; corpus/query failures are
 * carried VERBATIM from the frozen graph/retrieval/planner — they are the
 * authorities); determinism (no clock — benchmarkedAt is CALLER-injected
 * RFC3339; no randomness/network/filesystem; canonical orderings
 * everywhere); measured-only numbers; inputs never mutated; content-
 * addressed report identity ('bench_' + sha256Hex over the canonical
 * report minus its id — THIS packet's frozen prefix proposal).
 */

import { sha256Hex } from '@clapp/core';
import { canonicalJson } from '@clapp/observe';
import { planComposition } from './composition';
import type { CompositionPlan } from './composition';
// Local house helpers (the 060..063 precedent — copied so the module's
// runtime dependency set stays exactly @clapp/core + @clapp/observe +
// @clapp/library via ./composition).

/** Plain-object guard (arrays are NOT objects here — the house helper). */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Human preview of an unknown value, for error messages. */
function preview(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'undefined') return 'undefined';
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/** RFC3339 date-time: full-date "T" full-time, offset `Z`/`z` or ±HH:MM. */
const RFC3339_RE =
  /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[Zz]|([+-])(\d{2}):(\d{2}))$/;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * RFC3339 check: lexical shape + REAL calendar validity (the house helper
 * discipline — Date.parse rollover dates such as 2026-02-30 are rejected).
 */
function isRfc3339(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = RFC3339_RE.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const hasOffset = match[7] !== undefined;
  const offsetHour = match[8] === undefined ? 0 : Number(match[8]);
  const offsetMinute = match[9] === undefined ? 0 : Number(match[9]);
  if (month < 1 || month > 12) return false;
  const daysInMonth = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day < 1 || day > (daysInMonth[month - 1] as number)) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;
  if (hasOffset && (offsetHour > 23 || offsetMinute > 59)) return false;
  return true;
}

// ---- the benchmark contract v0.1 ---------------------------------------------------

/** The improvement-benchmark contract version (bumps only via a tech-lead declaration wave). */
export const BENCHMARK_VERSION = '0.1';

/** The work-item identity stamped on every report this harness mints. */
export const BENCHMARKED_BY = 'CLAPP-064';

/** A retrieval query as the frozen retrieval validates it (shape carried, authority theirs). */
export interface BenchmarkQuery {
  target: string;
  requiredCapabilities: string[];
  optionalCapabilities?: string[];
  purposeHint?: string;
  maxResults?: number;
}

/** One benchmark family: fixed queries, ordered library snapshots. */
export interface ImprovementFamily {
  /** Non-empty family name (the report carries it verbatim). */
  name: string;
  /** The retrieval queries — validated by the frozen machinery when planning. */
  queries: BenchmarkQuery[];
  /** ORDERED library snapshots (snapshot 0 = the baseline state; later = after learning). */
  snapshots: unknown[];
}

/** Per-snapshot measured aggregates (one per snapshot, in snapshot order). */
export interface SnapshotAggregate {
  snapshotIndex: number;
  queryCount: number;          // measured: queries planned (always the family's count)
  totalSelected: number;       // measured: the sum of selected counts over queries
  totalExcluded: number;       // measured: the sum of excluded counts
  totalConsidered: number;     // measured: the sum of considered counts
  meanSelectedScore: number;   // measured: mean score over ALL selected components (0 when none)
}

/** One consecutive-snapshot delta (measured, signed). */
export interface SnapshotDelta {
  fromIndex: number;
  toIndex: number;
  selectedDelta: number;       // totalSelected(to) − totalSelected(from) — measured
  excludedDelta: number;       // totalExcluded(to) − totalExcluded(from) — measured
  consideredDelta: number;     // totalConsidered(to) − totalConsidered(from) — measured
  meanScoreDelta: number;      // meanSelectedScore(to) − meanSelectedScore(from) — measured
  /** Per-query selected deltas (query order; measured). */
  perQuerySelectedDelta: number[];
}

/** The benchmark report. */
export interface ImprovementBenchmarkReport {
  benchmarkVersion: string;    // BENCHMARK_VERSION ('0.1')
  id: string;                  // content-addressed: 'bench_' + sha256Hex(canonicalJson(report minus id))
  familyName: string;          // verbatim
  benchmarkedBy: string;       // 'CLAPP-064'
  aggregates: SnapshotAggregate[];
  deltas: SnapshotDelta[];     // one per consecutive snapshot pair (empty for <2 snapshots)
  verdict: 'improvement-detected' | 'regression' | 'no-improvement';
  reasons: string[];           // honest, sorted, deduped; measured facts only
  /** RFC3339 — CALLER-injected; the harness never reads a clock. */
  benchmarkedAt: string;
}

export type BenchmarkResult =
  | { ok: true; report: ImprovementBenchmarkReport }
  | { ok: false; errors: string[] };  // fail-closed — results, never exceptions

// ---- the harness -------------------------------------------------------------------

/**
 * Run an improvement-benchmark family: plan every query against every
 * snapshot through the FROZEN composition machinery, measure the plans,
 * and mint the content-addressed report with its honest verdict.
 */
export async function runImprovementBenchmark(
  family: unknown,
  options: unknown,
): Promise<BenchmarkResult> {
  const errors: string[] = [];

  // ---- 1. fail-closed input validation (ALL errors collected) ----
  if (!isObject(family)) {
    return { ok: false, errors: [`family: expected an object { name, queries, snapshots }, got ${preview(family)}`] };
  }
  if (typeof family.name !== 'string' || family.name.length === 0) {
    errors.push(`family.name: expected a non-empty string, got ${preview(family.name)}`);
  }
  if (!Array.isArray(family.queries)) {
    errors.push(`family.queries: expected an array of retrieval queries, got ${preview(family.queries)}`);
  }
  if (!Array.isArray(family.snapshots)) {
    errors.push(`family.snapshots: expected an array of library snapshots, got ${preview(family.snapshots)}`);
  }
  if (!isObject(options)) {
    return { ok: false, errors: [`options: expected an object { benchmarkedAt }, got ${preview(options)}`] };
  }
  if (!isRfc3339(options.benchmarkedAt)) {
    errors.push(
      `options.benchmarkedAt: expected an RFC3339 date-time string (caller-injected — the harness never reads a clock), got ${preview(options.benchmarkedAt)}`,
    );
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const queries = family.queries as BenchmarkQuery[];
  const snapshots = family.snapshots as unknown[];
  const plannedAt = options.benchmarkedAt as string; // the same caller-injected instant plans the family

  // ---- 2. run the frozen machinery: every query x every snapshot ----
  // The planner validates corpus + query and returns its own errors —
  // carried VERBATIM (it is the authority; the harness never re-validates
  // manifests or queries). Query/snapshot identity in the message.
  const plans: CompositionPlan[][] = [];
  for (let queryIndex = 0; queryIndex < queries.length; queryIndex++) {
    const perSnapshot: CompositionPlan[] = [];
    for (let snapshotIndex = 0; snapshotIndex < snapshots.length; snapshotIndex++) {
      const result = await planComposition(
        snapshots[snapshotIndex],
        queries[queryIndex],
        { plannedAt },
      );
      if (!result.ok) {
        for (const error of result.errors) {
          errors.push(`query[${queryIndex}] snapshot[${snapshotIndex}]: ${error}`);
        }
        perSnapshot.push({ selected: [], excluded: [], considered: 0 } as unknown as CompositionPlan);
        continue;
      }
      perSnapshot.push(result.plan);
    }
    plans.push(perSnapshot);
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // ---- 3. measure per-snapshot aggregates ----
  const aggregates: SnapshotAggregate[] = snapshots.map((_, snapshotIndex) => {
    let totalSelected = 0;
    let totalExcluded = 0;
    let totalConsidered = 0;
    let scoreSum = 0;
    let scoreCount = 0;
    for (const perSnapshot of plans) {
      const plan = perSnapshot[snapshotIndex] as CompositionPlan;
      totalSelected += plan.selected.length;
      totalExcluded += plan.excluded.length;
      totalConsidered += plan.considered;
      for (const component of plan.selected) {
        scoreSum += component.score;
        scoreCount += 1;
      }
    }
    return {
      snapshotIndex,
      queryCount: queries.length,
      totalSelected,
      totalExcluded,
      totalConsidered,
      meanSelectedScore: scoreCount === 0 ? 0 : scoreSum / scoreCount,
    };
  });

  // ---- 4. measure the consecutive deltas + the per-query selected trail ----
  const deltas: SnapshotDelta[] = [];
  for (let index = 1; index < aggregates.length; index++) {
    const from = aggregates[index - 1] as SnapshotAggregate;
    const to = aggregates[index] as SnapshotAggregate;
    const perQuery: number[] = plans.map((perSnapshot) => {
      const fromPlan = perSnapshot[index - 1] as CompositionPlan;
      const toPlan = perSnapshot[index] as CompositionPlan;
      return toPlan.selected.length - fromPlan.selected.length;
    });
    deltas.push({
      fromIndex: from.snapshotIndex,
      toIndex: to.snapshotIndex,
      selectedDelta: to.totalSelected - from.totalSelected,
      excludedDelta: to.totalExcluded - from.totalExcluded,
      consideredDelta: to.totalConsidered - from.totalConsidered,
      meanScoreDelta: to.meanSelectedScore - from.meanSelectedScore,
      perQuerySelectedDelta: perQuery,
    });
  }

  // ---- 5. the verdict cascade (measured, honest) ----
  const reasons: string[] = [];
  let verdict: ImprovementBenchmarkReport['verdict'];

  const regressed: string[] = [];
  for (const delta of deltas) {
    delta.perQuerySelectedDelta.forEach((value, queryIndex) => {
      if (value < 0) {
        regressed.push(`query[${queryIndex}] selected ${value} between snapshots ${delta.fromIndex} and ${delta.toIndex}`);
      }
    });
  }
  const totalNonDecreasing = deltas.every((delta) => delta.selectedDelta >= 0);
  const anyStrictIncrease = deltas.some((delta) => delta.selectedDelta > 0);

  if (regressed.length > 0) {
    verdict = 'regression';
    for (const entry of regressed) {
      reasons.push(`regression: ${entry}`);
    }
  } else if (deltas.length > 0 && totalNonDecreasing && anyStrictIncrease) {
    verdict = 'improvement-detected';
    for (const delta of deltas) {
      reasons.push(
        `snapshots ${delta.fromIndex}->${delta.toIndex}: totalSelected ${delta.selectedDelta >= 0 ? '+' : ''}${delta.selectedDelta} (measured)`,
      );
    }
  } else {
    verdict = 'no-improvement';
    if (deltas.length === 0) {
      reasons.push('nothing to compare: fewer than two snapshots or zero queries (measured)');
    } else {
      reasons.push('no strict increase in totalSelected across the family (measured)');
    }
  }
  for (const aggregate of aggregates) {
    reasons.push(
      `snapshot ${aggregate.snapshotIndex}: ${aggregate.totalSelected} selected / ${aggregate.totalExcluded} excluded / ${aggregate.totalConsidered} considered over ${aggregate.queryCount} queries (measured)`,
    );
  }

  // ---- 6. the content-addressed report ----
  const unsigned: Omit<ImprovementBenchmarkReport, 'id'> = {
    benchmarkVersion: BENCHMARK_VERSION,
    familyName: family.name as string,
    benchmarkedBy: BENCHMARKED_BY,
    aggregates,
    deltas,
    verdict,
    reasons: [...new Set(reasons)].sort(),
    benchmarkedAt: options.benchmarkedAt as string,
  };
  const id = `bench_${await sha256Hex(canonicalJson(unsigned))}`;
  return { ok: true, report: { ...unsigned, id } };
}
