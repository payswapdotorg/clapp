/**
 * CLAPP-012 test battery — SANDBOX-EXECUTION PROOF. NEVER SKIPPED.
 *
 * Launches the bench-b01 fixture server + full seeded-journey replay via
 * the frozen @clapp/sandbox ProcessSandboxExecutor:
 *
 * - the child (src/fixtures/proof.ts) runs inside an isolated execution
 *   profile: cwd pinned inside profile.rootDir, env filtered to the
 *   allowlist (+ the executor's documented PATH/HOME injections), deny-all
 *   declared network posture, duration budget armed;
 * - inside the profile the child starts the fixture server on an
 *   ephemeral loopback port, replays EVERY seeded journey through the DOM
 *   ActionApplier, and prints one machine-readable JSON verdict line;
 * - the child also writes the same JSON to `proof-result.json` relative
 *   to ITS OWN cwd, which must land inside profile.rootDir — cwd
 *   isolation proven from within (same technique as the CLAPP-003
 *   hello-app fixture);
 * - this test asserts: completed outcome, exit code 0, every journey ok,
 *   duration inside the budget, honest enforcement flags.
 *
 * Honest note (frozen @clapp/sandbox contract): `networkEnforced` is
 * ALWAYS false in the v0 child-process executor — a plain child cannot
 * police its own egress; real egress control lands with the runner
 * integration (CLAPP-040). The loopback-only fixture traffic in this
 * proof never leaves the machine, and the corpus itself is verified to
 * contain zero external references by corpus.test.ts.
 */

import { afterAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProcessSandboxExecutor, defaultDenyAllNetwork } from '@clapp/sandbox';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const proofScript = join(packageRoot, 'src', 'fixtures', 'proof.ts');
const journeysDir = join(packageRoot, 'fixtures', 'journeys');
const corpusRoot = join(packageRoot, 'fixtures', 'b01');

const scratchPaths: string[] = [];

afterAll(() => {
  for (const path of scratchPaths) {
    rmSync(path, { recursive: true, force: true });
  }
});

interface ProofJourneyResult {
  id: string;
  file: string;
  name: string;
  actions: number;
  ok: boolean;
  durationMs: number;
  error?: { code: string; message: string; actionIndex?: number; details?: unknown };
}

interface ProofPayload {
  ok: boolean;
  serverUrl: string;
  serverPort: number;
  profileCwd: string;
  journeys: ProofJourneyResult[];
}

describe('sandbox-execution proof (CLAPP-012 §6) — always runs', () => {
  it(
    'fixture server + seeded-journey replay succeed inside an isolated, budgeted execution profile',
    async () => {
      const executor = new ProcessSandboxExecutor();
      const rootDir = mkdtempSync(join(tmpdir(), 'clapp-journey-proof-'));
      scratchPaths.push(rootDir);

      const profile = await executor.prepare(
        {
          envAllowlist: [], // strictest posture: nothing passes except the executor's documented injections
          network: defaultDenyAllNetwork(),
          budget: { maxDurationMs: 60_000 },
          label: 'clapp-012-journey-proof',
        },
        rootDir,
      );

      const result = await executor.execute(
        {
          profile,
          command: 'bun',
          args: [
            proofScript,
            '--journeys',
            journeysDir,
            '--root',
            corpusRoot,
            '--out',
            'proof-result.json',
          ],
        },
      );

      // --- The child completed, within budget, with a clean exit. -------
      expect(result.outcome.status).toBe('completed');
      if (result.outcome.status === 'completed') {
        expect(result.outcome.exitCode).toBe(0);
      }
      expect(result.truncated).toBe(false);
      expect(result.stderr).toBe('');
      expect(result.durationMs).toBeLessThan(profile.budget.maxDurationMs);

      // --- Honest enforcement flags (frozen v0 semantics). --------------
      expect(result.enforcement.cwdIsolated).toBe(true);
      expect(result.enforcement.envFiltered).toBe(true);
      expect(result.enforcement.durationBudget).toBe(true);
      expect(result.enforcement.networkEnforced).toBe(false); // v0 honesty: see header

      // --- Machine-readable verdict from inside the profile. ------------
      const lastLine = result.stdout.trim().split('\n').pop() ?? '';
      const payload = JSON.parse(lastLine) as ProofPayload;
      expect(payload.ok).toBe(true);
      expect(payload.serverPort).toBeGreaterThan(0);
      expect(payload.journeys.length).toBeGreaterThanOrEqual(3);
      for (const journey of payload.journeys) {
        expect(journey.ok).toBe(true);
        expect(journey.actions).toBeGreaterThan(0);
        expect(journey.error).toBeUndefined();
      }

      // --- cwd isolation proven from within: the child wrote its result
      //     relative to its own cwd, and that file lives inside rootDir. --
      const writtenPath = join(profile.rootDir, 'proof-result.json');
      expect(existsSync(writtenPath)).toBe(true);
      const written = JSON.parse(readFileSync(writtenPath, 'utf8')) as ProofPayload;
      expect(written.ok).toBe(true);
      expect(written.journeys).toEqual(payload.journeys);
      expect(join(payload.profileCwd)).toBe(profile.rootDir);
    },
    120_000,
  );
});
