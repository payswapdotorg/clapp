/**
 * CLAPP-003 test battery — ProcessSandboxExecutor.
 *
 * Covers the required §5 cases plus extra boundary probes (cwd escape,
 * spawn-error, stdin passthrough, positive env control, non-positive
 * budgets). Security posture: env leakage or cwd escape are treated as test
 * failures, never conveniences.
 */

import { afterAll, afterEach, describe, expect, it } from 'bun:test';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProcessSandboxExecutor } from './executor';
import { defaultDenyAllNetwork } from './policy';
import type { ExecutionProfile, ExecutionSpec } from './types';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url))); // .../packages/sandbox
const fixturesDir = join(packageRoot, 'fixtures');
const helloApp = join(fixturesDir, 'hello-app', 'main.ts');
const sleepApp = join(fixturesDir, 'sleep-app', 'main.ts');
const failApp = join(fixturesDir, 'fail-app', 'main.ts');
const spillApp = join(fixturesDir, 'spill-app', 'main.ts');
const stdinEchoApp = join(fixturesDir, 'stdin-echo-app', 'main.ts');
const termProofApp = join(fixturesDir, 'term-proof-app', 'main.ts');

const scratchPaths: string[] = [];

afterAll(() => {
  for (const path of scratchPaths) {
    rmSync(path, { recursive: true, force: true });
  }
});

afterEach(() => {
  delete process.env['CLAPP_TEST_SECRET'];
});

async function freshRoot(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'clapp-sandbox-test-'));
  scratchPaths.push(root);
  return root;
}

interface ProfileBudget {
  maxDurationMs: number;
  maxBytes?: number;
}

async function makeProfile(
  rootDir: string,
  budget: ProfileBudget,
  envAllowlist: string[] = [],
): Promise<ExecutionProfile> {
  const executor = new ProcessSandboxExecutor();
  return executor.prepare(
    { envAllowlist, network: defaultDenyAllNetwork(), budget },
    rootDir,
  );
}

interface HelloPayload {
  pid: number;
  cwd: string;
  hasSecretEnv: boolean;
}

function parseHello(stdout: string): HelloPayload {
  return JSON.parse(stdout.trim()) as HelloPayload;
}

async function captureError(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
    return undefined;
  } catch (error) {
    return error;
  }
}

/** A killed+reaped pid answers kill(pid, 0) with ESRCH; EPERM means alive. */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

describe('ProcessSandboxExecutor — fixture applications', () => {
  it('runs a generated fixture app isolated: exit 0, JSON stdout, cwd pinned to profile.rootDir', async () => {
    const executor = new ProcessSandboxExecutor();
    const rootDir = await freshRoot();
    const profile = await executor.prepare(
      {
        envAllowlist: [],
        network: defaultDenyAllNetwork(),
        budget: { maxDurationMs: 15_000 },
        label: 'hello-run',
      },
      rootDir,
    );

    // Stage the fixture into the profile like the synthesizer stages a
    // generated app, then reference it by a profile-relative path.
    const stagedDir = join(profile.rootDir, 'fixtures', 'hello-app');
    mkdirSync(stagedDir, { recursive: true });
    copyFileSync(helloApp, join(stagedDir, 'main.ts'));

    const spec: ExecutionSpec = { profile, command: 'bun', args: ['fixtures/hello-app/main.ts'] };
    const result = await executor.execute(
      spec,
      'run_00000000-0000-4000-8000-000000000001',
    );

    expect(result.outcome).toEqual({ status: 'completed', exitCode: 0 });
    expect(result.runId).toBe('run_00000000-0000-4000-8000-000000000001');
    expect(result.profileId).toBe(profile.id);
    expect(result.truncated).toBe(false);
    expect(result.enforcement).toEqual({
      cwdIsolated: true,
      envFiltered: true,
      networkEnforced: false,
      durationBudget: true,
    });

    const payload = parseHello(result.stdout);
    expect(payload.pid).toBeGreaterThan(0);
    // cwd isolation PROVEN from inside the child:
    expect(payload.cwd).toBe(profile.rootDir);

    // Machine-readable timestamps: ISO-8601 UTC round-trips through toISOString.
    expect(new Date(result.startedAt).toISOString()).toBe(result.startedAt);
    expect(new Date(result.endedAt).toISOString()).toBe(result.endedAt);
    expect(Number.isInteger(result.durationMs)).toBe(true);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('filters the environment: a planted parent-env secret does NOT reach the child', async () => {
    process.env['CLAPP_TEST_SECRET'] = 'parent-env-secret-planted-by-test';
    const executor = new ProcessSandboxExecutor();
    const profile = await executor.prepare(
      { envAllowlist: [], network: defaultDenyAllNetwork(), budget: { maxDurationMs: 15_000 } },
      await freshRoot(),
    );
    const result = await executor.execute({ profile, command: 'bun', args: [helloApp] });

    expect(result.outcome).toEqual({ status: 'completed', exitCode: 0 });
    expect(parseHello(result.stdout).hasSecretEnv).toBe(false);
  });

  it('env allowlist passes allowlisted values through (positive control)', async () => {
    process.env['CLAPP_TEST_SECRET'] = 'parent-env-secret-planted-by-test';
    const profile = await makeProfile(await freshRoot(), { maxDurationMs: 15_000 }, [
      'CLAPP_TEST_SECRET',
    ]);
    const result = await new ProcessSandboxExecutor().execute({
      profile,
      command: 'bun',
      args: [helloApp],
    });

    // The filter is a real allowlist, not an empty-env bludgeon: values that
    // ARE allowlisted must arrive.
    expect(parseHello(result.stdout).hasSecretEnv).toBe(true);
  });

  it('enforces the duration budget: sleep-app is killed and reported budget-exceeded/duration', async () => {
    const profile = await makeProfile(await freshRoot(), { maxDurationMs: 500 });
    const result = await new ProcessSandboxExecutor().execute({
      profile,
      command: 'bun',
      args: [sleepApp],
    });

    expect(result.outcome).toEqual({ status: 'budget-exceeded', reason: 'duration' });
    expect(result.durationMs).toBeGreaterThanOrEqual(500);
    expect(result.durationMs).toBeLessThan(5000);

    // The process must actually be dead, not merely reported as such.
    const payload = JSON.parse(result.stdout.trim()) as { pid: number };
    expect(isProcessAlive(payload.pid)).toBe(false);
  });

  it('propagates non-zero exit codes: fail-app completes with exitCode 7', async () => {
    const profile = await makeProfile(await freshRoot(), { maxDurationMs: 15_000 });
    const result = await new ProcessSandboxExecutor().execute({
      profile,
      command: 'bun',
      args: [failApp],
    });

    expect(result.outcome).toEqual({ status: 'completed', exitCode: 7 });
    expect(result.truncated).toBe(false);
  });

  it('enforces the output-size budget: spill-app output is capped, truncated=true', async () => {
    const profile = await makeProfile(await freshRoot(), {
      maxDurationMs: 15_000,
      maxBytes: 64,
    });
    const result = await new ProcessSandboxExecutor().execute({
      profile,
      command: 'bun',
      args: [spillApp],
    });

    expect(result.truncated).toBe(true);
    expect(result.outcome).toEqual({ status: 'budget-exceeded', reason: 'output-size' });
    expect(result.stdout.length).toBeLessThanOrEqual(64);
    expect(result.stdout).toMatch(/^A*$/);
  });

  it('escalates to SIGKILL when the child traps SIGTERM (kill-ladder proof)', async () => {
    const profile = await makeProfile(await freshRoot(), { maxDurationMs: 300 });
    const result = await new ProcessSandboxExecutor().execute({
      profile,
      command: 'bun',
      args: [termProofApp],
    });

    expect(result.outcome).toEqual({ status: 'budget-exceeded', reason: 'duration' });
    // 300ms budget → SIGTERM (trapped) → 300ms grace → SIGKILL.
    expect(result.durationMs).toBeGreaterThanOrEqual(300);
    expect(result.durationMs).toBeLessThan(5000);

    // SIGKILL must actually land — the trapped child is provably dead.
    const payload = JSON.parse(result.stdout.trim()) as { pid: number };
    expect(isProcessAlive(payload.pid)).toBe(false);
  });

  it('passes stdinData through to the child (stdin-echo-app)', async () => {
    const profile = await makeProfile(await freshRoot(), { maxDurationMs: 15_000 });
    const result = await new ProcessSandboxExecutor().execute({
      profile,
      command: 'bun',
      args: [stdinEchoApp],
      stdinData: 'clapp-stdin-payload',
    });

    expect(result.outcome).toEqual({ status: 'completed', exitCode: 0 });
    expect(result.stdout).toBe('CLAPP-STDIN-PAYLOAD');
  });
});

describe('ProcessSandboxExecutor — refusing unsafe work', () => {
  it('throws on execute without a budget (no budget, no execution)', async () => {
    const executor = new ProcessSandboxExecutor();
    // Cast is deliberate: we are testing RUNTIME validation of inputs that
    // the type system would reject — exactly what untrusted callers produce.
    const invalidSpec = {
      profile: {
        id: 'sandbox_hand_assembled',
        rootDir: await freshRoot(),
        envAllowlist: [],
        network: defaultDenyAllNetwork(),
        // budget deliberately omitted
      },
      command: 'bun',
      args: [helloApp],
    } as unknown as ExecutionSpec;

    const error = await captureError(() => executor.execute(invalidSpec));
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('budget');
  });

  it('throws on non-positive budgets at prepare()', async () => {
    const executor = new ProcessSandboxExecutor();

    const zero = await captureError(() =>
      executor.prepare({
        envAllowlist: [],
        network: defaultDenyAllNetwork(),
        budget: { maxDurationMs: 0 },
      }),
    );
    expect(zero).toBeInstanceOf(Error);
    expect((zero as Error).message).toContain('maxDurationMs');

    const negative = await captureError(() =>
      executor.prepare({
        envAllowlist: [],
        network: defaultDenyAllNetwork(),
        budget: { maxDurationMs: -1 },
      }),
    );
    expect(negative).toBeInstanceOf(Error);
    expect((negative as Error).message).toContain('maxDurationMs');
  });

  it('rejects a spec.cwd that escapes the profile rootDir', async () => {
    const profile = await makeProfile(await freshRoot(), { maxDurationMs: 1_000 });
    const error = await captureError(() =>
      new ProcessSandboxExecutor().execute({
        profile,
        command: 'bun',
        args: [helloApp],
        cwd: '../../',
      }),
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('rootDir');
  });

  it('reports spawn-error for a command that cannot be resolved', async () => {
    const profile = await makeProfile(await freshRoot(), { maxDurationMs: 1_000 });
    const result = await new ProcessSandboxExecutor().execute({
      profile,
      command: 'clapp-no-such-binary-xyz',
      args: ['--version'],
    });

    expect(result.outcome.status).toBe('spawn-error');
    if (result.outcome.status !== 'spawn-error') {
      throw new Error(`expected spawn-error, got ${JSON.stringify(result.outcome)}`);
    }
    expect(result.outcome.error.length).toBeGreaterThan(0);
    // No child ran, so nothing was enforced against one.
    expect(result.enforcement).toEqual({
      cwdIsolated: false,
      envFiltered: false,
      networkEnforced: false,
      durationBudget: false,
    });
  });
});

describe('ProcessSandboxExecutor.prepare — profile creation', () => {
  it('creates an isolated rootDir and issues a sandbox_-prefixed profile id', async () => {
    const executor = new ProcessSandboxExecutor();

    // Explicit rootDir (caller-managed):
    const explicit = join(await freshRoot(), 'explicit-profile');
    const profile = await executor.prepare(
      {
        envAllowlist: ['CLAPP_SAFE_VAR'],
        network: defaultDenyAllNetwork(),
        budget: { maxDurationMs: 1_000 },
        label: 'prepare-test',
      },
      explicit,
    );
    expect(profile.id.startsWith('sandbox_')).toBe(true);
    expect(existsSync(profile.rootDir)).toBe(true);
    expect(statSync(profile.rootDir).isDirectory()).toBe(true);
    expect(profile.rootDir).toContain('explicit-profile');
    expect(profile.label).toBe('prepare-test');
    expect(profile.budget).toEqual({ maxDurationMs: 1_000 });
    expect(profile.network).toEqual({ mode: 'deny-all' });

    // Default rootDir (executor-managed, under the OS tmpdir):
    const defaulted = await executor.prepare({
      envAllowlist: [],
      network: defaultDenyAllNetwork(),
      budget: { maxDurationMs: 1_000 },
    });
    expect(defaulted.id.startsWith('sandbox_')).toBe(true);
    expect(defaulted.rootDir).toContain('clapp-sandboxes');
    expect(existsSync(defaulted.rootDir)).toBe(true);
    // Clean up the specific profile only — never the shared base dir, which a
    // concurrent suite may also be using.
    scratchPaths.push(defaulted.rootDir);
  });
});
