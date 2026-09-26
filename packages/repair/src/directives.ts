/**
 * @clapp/repair — clustering findings into RepairDirectives (CLAPP-042).
 *
 * `clusterFindings(report)` groups the report's CRITICAL + MAJOR findings
 * (minor/info findings are recorded by the diff side but are never
 * repair-loop work orders — honest budget focus) into one directive per
 * shared anchor path: findings whose payloads derive the SAME
 * candidate-relative target file (a page module or the generated server)
 * share a scope, a commit, and an acceptance sentence.
 *
 * MAPPING (anchor path → candidate file, the documented convention):
 *   - a semantic finding carrying a text/testid payload with route R maps
 *     to the candidate's page module for R (pageModulePathForRoute —
 *     pure file-layout knowledge, no plan access);
 *   - a network finding carrying a mock payload maps to server.ts (the
 *     generated mock backend lives there);
 *   - a finding with no locatable payload (fully structural, expected/
 *     actual absent) clusters SOLO with an empty scope — it is honestly
 *     unrepairable and its directive aborts with verdict 'error'.
 *
 * DIRECTIVE SHAPE:
 *   - scopePaths = the cluster's derived target paths (sorted, deduped);
 *   - acceptance = one honest sentence built from the cluster's findings
 *     (per-payload clause templates — see payload.acceptanceClause);
 *   - ids are minted from the (injectable) idFactory in output order.
 *
 * DETERMINISM: the output order is (severity rank: critical before major,
 * then scope path, then minimum step index, then minimum finding id) — a
 * pure function of the report. Given the same report (and the same id
 * factory state), clustering is byte-identical.
 */

import type { DiffFinding, DiffReport, RepairDirective } from './diff-contract';
import { newDirectiveId, type DirectiveIdFactory } from './ids';
import { acceptanceClause, findingTargetPath } from './payload';

export interface ClusterOptions {
  /**
   * Directive id factory (determinism hook — see README). Default mints
   * "repd_" + uuid v4. Ids are assigned in output order, so a counting
   * factory yields stable directive identities across identical runs.
   */
  idFactory?: DirectiveIdFactory;
}

const SEVERITY_RANK: Readonly<Record<string, number>> = {
  critical: 0,
  major: 1,
  minor: 2,
  info: 3,
};

interface Cluster {
  key: string;
  scopePath: string | null;
  findings: DiffFinding[];
}

/**
 * Groups critical + major findings into scoped RepairDirectives (one per
 * shared anchor path; unlocatable findings cluster solo with empty scope).
 */
export function clusterFindings(report: DiffReport, options: ClusterOptions = {}): RepairDirective[] {
  const idFactory = options.idFactory ?? newDirectiveId;
  const candidates = report.findings.filter(
    (finding) => finding.severity === 'critical' || finding.severity === 'major',
  );

  const clusters = new Map<string, Cluster>();
  for (const finding of candidates) {
    const scopePath = findingTargetPath(finding);
    // Unlocatable findings cluster SOLO (key includes the finding id).
    const key = scopePath ?? `\u0000unlocatable:${finding.id}`;
    const existing = clusters.get(key);
    if (existing === undefined) {
      clusters.set(key, { key, scopePath, findings: [finding] });
    } else {
      existing.findings.push(finding);
    }
  }

  const sorted = [...clusters.values()].sort((a, b) => {
    const rankA = clusterSeverityRank(a);
    const rankB = clusterSeverityRank(b);
    if (rankA !== rankB) {
      return rankA - rankB;
    }
    const pathA = a.scopePath ?? '';
    const pathB = b.scopePath ?? '';
    if (pathA !== pathB) {
      return pathA < pathB ? -1 : 1;
    }
    const stepA = minStepIndex(a);
    const stepB = minStepIndex(b);
    if (stepA !== stepB) {
      return stepA - stepB;
    }
    return minFindingId(a) < minFindingId(b) ? -1 : 1;
  });

  return sorted.map((cluster) => {
    const scopePaths =
      cluster.scopePath === null ? [] : [...new Set([cluster.scopePath])].sort();
    // Deterministic finding order inside the directive: step index, then id.
    const ordered = [...cluster.findings].sort((a, b) => {
      const stepA = a.anchors[0]?.stepIndex ?? -1;
      const stepB = b.anchors[0]?.stepIndex ?? -1;
      if (stepA !== stepB) {
        return stepA - stepB;
      }
      return a.id < b.id ? -1 : 1;
    });
    const clauses = ordered.map((finding) => acceptanceClause(finding));
    return {
      id: idFactory(),
      findingIds: ordered.map((finding) => finding.id),
      scopePaths,
      acceptance: `Replay of the paired verification must re-establish: ${clauses.join('; ')}.`,
    };
  });
}

function clusterSeverityRank(cluster: Cluster): number {
  let rank = Number.MAX_SAFE_INTEGER;
  for (const finding of cluster.findings) {
    const value = SEVERITY_RANK[finding.severity];
    if (typeof value === 'number') {
      rank = Math.min(rank, value);
    }
  }
  return rank;
}

function minStepIndex(cluster: Cluster): number {
  let min = Number.MAX_SAFE_INTEGER;
  for (const finding of cluster.findings) {
    for (const anchor of finding.anchors) {
      if (anchor.stepIndex < min) {
        min = anchor.stepIndex;
      }
    }
  }
  return min === Number.MAX_SAFE_INTEGER ? -1 : min;
}

function minFindingId(cluster: Cluster): string {
  return cluster.findings.map((finding) => finding.id).sort()[0] ?? '';
}
