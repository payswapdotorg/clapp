/**
 * @clapp/repair — adapter honesty declaration (CLAPP-042).
 *
 * REPAIR_ADAPTER_INFO is the strategy table's honesty summary: which
 * finding shapes are repairable, which are not, how scope is enforced,
 * and how the budget bounds the loop. Shape mirrors the sibling
 * packages' *ADAPTER_INFO declarations (adapterId / supported versions /
 * capabilities / unsupported / degradation).
 */

import { DIFF_VERSION } from './diff-contract';

export const REPAIR_ADAPTER_INFO: {
  adapterId: string;
  supportedContractVersions: string[];
  repairCapabilities: string[];
  strategyTable: Array<{
    findingShape: string;
    strategy: string;
    repairable: boolean;
    note: string;
  }>;
  scopeEnforcement: string;
  budget: string;
  nonDegeneracy: string;
  degradationBehavior: string;
} = {
  adapterId: '@clapp/repair',
  supportedContractVersions: [DIFF_VERSION],
  repairCapabilities: [
    'clusterFindings: critical+major findings → scoped RepairDirectives (one per derived target file; deterministic order)',
    'applyDirective: bounded evidence-driven edits committed to the candidate tree (one commit per attempt, baseSha + changedPaths recorded)',
    'runRepairLoop: budgeted iteration against a re-run oracle callback, honest RepairLoopResult per the diff-contract v0.1 mirror',
  ],
  strategyTable: [
    {
      findingShape: "expected/actual = { kind:'text', route, text } with differing texts on the same route",
      strategy: 'text-restore',
      repairable: true,
      note: 'single-occurrence string swap in the route page module; aborts when the needle is absent or ambiguous (≠1 occurrence)',
    },
    {
      findingShape: "expected = { kind:'testid', route, testId }, actual missing testId or carrying a different one",
      strategy: 'attribute-restore',
      repairable: true,
      note: 'adds/rewrites data-testid at the candidate layout canonical slot; locating needs tag+text+matchIndex (missing case) or a unique existing testid value (renamed case); <p>/<label> have no testid slot',
    },
    {
      findingShape: "expected/actual = { kind:'mock', method, urlPattern, statusCode, bodyJson? } with divergent status and/or body",
      strategy: 'mock-restore',
      repairable: true,
      note: 'restores status/body inside the generated server.ts mock entry for the endpoint; aborts when the entry or the divergent value cannot be located uniquely',
    },
    {
      findingShape: 'structural findings (expected/actual absent) or any other payload shape',
      strategy: '(none)',
      repairable: false,
      note: 'no strategy can express the repair — the directive aborts with verdict "error" and the finding stays in remainingCriticalFindings; never a forced or faked repair',
    },
  ],
  scopeEnforcement:
    'changedPaths must be ⊆ directive.scopePaths. Pre-edit: every strategy target path is checked against the scope before any byte is touched — a violation aborts the whole attempt (verdict "error", no edits). Post-edit: git status must again show only scoped paths — a violation hard-resets to baseSha (attempt voided, verdict "error", changedPaths empty). The engine also refuses to start on a dirty tree so repair commits contain only their own work.',
  budget:
    'runRepairLoop applies at most maxIterations (default 5) directives — one directive, one commit, one oracle re-run per iteration — and stops early on an "equivalent" verdict. Aborted attempts count against the budget (honest record of spent work).',
  nonDegeneracy:
    'The loop NEVER reads a SynthesisPlan: repairs derive from the findings expected/actual payloads and the candidate files only. Anchor→file mapping is pure file-layout knowledge (route → pages/<slug>.html.ts; mock payloads → server.ts).',
  degradationBehavior:
    'Unrepairable findings are never approximated: the strategy abstains (null), the attempt aborts with verdict "error", and the loop reports them unresolved. Resolution claims require a local post-edit verification of the expected fact; behavioral equivalence claims require the re-run oracle\'s "equivalent" verdict. converged follows the contract iff (remainingCriticalFindings empty) — an unverified corner (all criticals edit-resolved but the oracle never said "equivalent") is detectable from the recorded attempts, never hidden.',
};
