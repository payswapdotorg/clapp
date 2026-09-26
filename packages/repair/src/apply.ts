/**
 * @clapp/repair — applyDirective: the bounded edit engine (CLAPP-042).
 *
 * `applyDirective(directive, candidateRoot, findings)` applies ONE
 * directive's work order to the candidate tree:
 *
 *  1. REFUSES a dirty tree (git status must be clean — the loop commits
 *     ONLY its own work, never ambient changes).
 *  2. Selects a strategy per finding (text-restore / attribute-restore /
 *     mock-restore). A finding whose expected fact already holds is
 *     idempotently resolved (no edit).
 *  3. HARD SCOPE ENFORCEMENT, twice: every strategy's target path must be
 *     ⊆ directive.scopePaths BEFORE any byte is touched (violation ⇒
 *     abort, verdict 'error'); after the edits, `git status --porcelain`
 *     must again show only scoped paths (violation ⇒ full reset to
 *     baseSha, verdict 'error', changedPaths empty).
 *  4. Commits the edited paths as ONE git commit in the candidate repo
 *     (deterministic message; self-contained identity). baseSha is the
 *     commit BEFORE the repair; changedPaths is what the commit actually
 *     changed (⊆ scopePaths by construction).
 *  5. resolvedFindingIds = findings whose strategy applied AND whose
 *     expected fact now verifiably holds in the file (local
 *     post-verification — behavioral verification is the re-run oracle's
 *     job).
 *
 * VERDICT SEMANTICS (honest, documented): applyDirective cannot verify
 * behavior (it has no oracle), so the returned attempt's rerunVerdict is
 * PROVISIONAL — 'error' when the attempt aborted (no edits, dirty tree,
 * scope violation, strategy failure, git failure), 'divergent' when edits
 * were committed. runRepairLoop OVERWRITES the provisional verdict of
 * every non-aborted attempt with the re-run oracle's verdict. Direct
 * callers must run their own verification. iteration is likewise
 * loop-assigned (0 here unless passed via options).
 *
 * NON-DEGENERACY: the engine reads ONLY the findings' payloads and the
 * candidate's files. It has never seen a SynthesisPlan.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import type { DiffFinding, RepairAttempt, RepairDirective } from './diff-contract';
import { gitCommitPaths, gitHead, gitResetHard, gitStatusPorcelain } from './git';
import { selectStrategy, applyStrategy, verifyFinding, type StrategyResult } from './strategies';

/** Options for {@link applyDirective}. */
export interface ApplyDirectiveOptions {
  /** The loop iteration this attempt belongs to (1..maxIterations; 0 = standalone). */
  iteration?: number;
}

/** The commit message prefix for repair commits. */
export const REPAIR_COMMIT_PREFIX = 'clapp-repair:';

/** Maps a candidate-relative scope path to an absolute path inside the candidate root (defensively). */
function absolutePath(candidateRoot: string, relativePath: string): string {
  const root = resolve(candidateRoot);
  const absolute = resolve(root, relativePath);
  if (absolute !== root && !absolute.startsWith(root + sep)) {
    throw new TypeError(`repair applyDirective: scope path escapes the candidate root: ${relativePath}`);
  }
  return absolute;
}

/** Reads a file inside the candidate root, or null when it does not exist. */
async function readCandidateFile(candidateRoot: string, relativePath: string): Promise<string | null> {
  try {
    return await readFile(absolutePath(candidateRoot, relativePath), 'utf8');
  } catch {
    return null; // missing file (e.g. a deleted page module) — honest strategy failure
  }
}

function failedAttempt(directive: RepairDirective, iteration: number, baseSha: string): RepairAttempt {
  return {
    directiveId: directive.id,
    iteration,
    baseSha,
    changedPaths: [],
    rerunVerdict: 'error',
    resolvedFindingIds: [],
  };
}

/**
 * Applies one directive's bounded, evidence-driven edits to the candidate
 * tree and records the attempt (see the module doc for the full contract).
 */
export async function applyDirective(
  directive: RepairDirective,
  candidateRoot: string,
  findings: DiffFinding[],
  options: ApplyDirectiveOptions = {},
): Promise<RepairAttempt> {
  const iteration = options.iteration ?? 0;
  const baseSha = await gitHead(candidateRoot);
  if (baseSha === null) {
    // No commits / not a git repo: the loop's contract requires a committed
    // candidate history (baseSha is the commit BEFORE the repair).
    return failedAttempt(directive, iteration, '');
  }

  // 1. Refuse a dirty tree: the repair commits only its own work.
  const dirty = await gitStatusPorcelain(candidateRoot);
  if (dirty.length > 0) {
    return failedAttempt(directive, iteration, baseSha);
  }

  // 2. Resolve the directive's findings (ids not present in `findings` are skipped).
  const byId = new Map(findings.map((finding) => [finding.id, finding]));
  const directiveFindings = directive.findingIds
    .map((id) => byId.get(id))
    .filter((finding): finding is DiffFinding => finding !== undefined);

  // 3. Strategy selection + PRE-EDIT scope check (before touching a byte).
  interface PlannedEdit {
    finding: DiffFinding;
    targetPath: string;
    alreadyResolved: boolean;
  }
  const planned: PlannedEdit[] = [];
  for (const finding of directiveFindings) {
    const plan = selectStrategy(finding);
    if (plan === null) {
      continue; // no strategy matches — the finding stays unresolved (honest)
    }
    if (!directive.scopePaths.includes(plan.targetPath)) {
      // Scope violation: the strategy would touch a file outside the
      // directive's scope. Abort the WHOLE attempt before any edit.
      return failedAttempt(directive, iteration, baseSha);
    }
    planned.push({ finding, targetPath: plan.targetPath, alreadyResolved: false });
  }

  // 4. Apply the strategies file by file (sequential edits see each other).
  const editedPaths = new Set<string>();
  const resolvedIds: string[] = [];
  const summaries: string[] = [];
  const fileContents = new Map<string, string>();
  for (const entry of planned) {
    let content = fileContents.get(entry.targetPath);
    if (content === undefined) {
      const read = await readCandidateFile(candidateRoot, entry.targetPath);
      if (read === null) {
        continue; // target file missing (deleted page module) — honest failure
      }
      content = read;
    }
    // Idempotence: the finding's expected fact already holds.
    if (verifyFinding(content, entry.finding)) {
      resolvedIds.push(entry.finding.id);
      continue;
    }
    const result: StrategyResult | null = applyStrategy(content, entry.finding);
    if (result === null || !result.resolved) {
      continue; // strategy abstained or could not verify — honest failure
    }
    content = result.content;
    fileContents.set(entry.targetPath, content);
    editedPaths.add(entry.targetPath);
    resolvedIds.push(entry.finding.id);
    summaries.push(`${findingLine(result, entry.finding)}`);
  }

  // 5. No edits produced ⇒ honest abort (nothing to commit).
  if (editedPaths.size === 0) {
    return {
      directiveId: directive.id,
      iteration,
      baseSha,
      changedPaths: [],
      rerunVerdict: 'error',
      resolvedFindingIds: resolvedIds,
    };
  }

  // 6. Write the edited files.
  for (const [relativePath, content] of fileContents) {
    if (!editedPaths.has(relativePath)) {
      continue;
    }
    await writeFile(absolutePath(candidateRoot, relativePath), content, 'utf8');
  }

  // 7. POST-EDIT scope check: the working tree may show only scoped paths.
  const status = await gitStatusPorcelain(candidateRoot);
  const touchedOutsideScope = status.some((entry) => {
    const path = entry.slice(3).trim();
    return !directive.scopePaths.includes(path);
  });
  if (touchedOutsideScope || status.length === 0) {
    // Defensive: something changed outside scope (or status is unreadable).
    // Void the attempt: hard-reset to baseSha so NOTHING changed.
    await gitResetHard(candidateRoot, baseSha);
    return failedAttempt(directive, iteration, baseSha);
  }

  // 8. Commit the edited paths as ONE repair commit.
  const message = commitMessage(directive, summaries);
  const commit = await gitCommitPaths(candidateRoot, [...editedPaths], message);
  if (!commit.committed) {
    await gitResetHard(candidateRoot, baseSha);
    return failedAttempt(directive, iteration, baseSha);
  }

  return {
    directiveId: directive.id,
    iteration,
    baseSha,
    changedPaths: commit.changedPaths,
    // PROVISIONAL — runRepairLoop overwrites with the oracle verdict.
    rerunVerdict: 'divergent',
    resolvedFindingIds: resolvedIds,
  };
}

function findingLine(result: StrategyResult, finding: DiffFinding): string {
  return `Finding ${finding.id} (${finding.severity}): ${result.summary}`;
}

function commitMessage(directive: RepairDirective, summaries: string[]): string {
  const lines = [
    `${REPAIR_COMMIT_PREFIX} ${directive.id}`,
    '',
    `Directive acceptance: ${directive.acceptance}`,
    '',
    ...summaries.map((summary) => `- ${summary}`),
  ];
  return lines.join('\n');
}
