// CLAPP-010 unit tests — launchServerInSandbox over the REAL frozen
// ProcessSandboxExecutor (no browser needed; the only network traffic is
// the loopback fixture server itself).

import { describe, expect, test } from 'bun:test';
import { ProcessSandboxExecutor } from '@clapp/sandbox';
import { launchServerInSandbox, ServerLaunchError } from './sandbox-server';

// Minimal in-sandbox fixture server: pong route + cooperative stop route.
function pongServerSource(stopRoute: boolean): string {
  const stopHandler = stopRoute
    ? `if (request.method === 'POST' && url.pathname === '/__clapp/stop') { setTimeout(function () { process.exit(0); }, 50); return new Response('stopping'); }`
    : '';
  return [
    "import { writeFileSync } from 'node:fs';",
    'const server = Bun.serve({',
    '  port: 0,',
    '  fetch(request) {',
    "    const url = new URL(request.url);",
    stopHandler,
    "    if (url.pathname === '/ping') return new Response('pong');",
    "    return new Response('ok', { status: 200 });",
    '  },',
    '});',
    "writeFileSync('server.port', String(server.port));",
  ].join('\n');
}

describe('launchServerInSandbox — happy path', () => {
  test('starts inside an isolated profile, answers HTTP, stops cooperatively', async () => {
    const executor = new ProcessSandboxExecutor();
    const server = await launchServerInSandbox(executor, {
      command: 'bun',
      args: ['server.ts'],
      fixtures: { 'server.ts': pongServerSource(true) },
      budget: { maxDurationMs: 20_000 },
      readyPath: '/ping',
      stopPath: '/__clapp/stop',
      label: 'clapp-010-test-pong',
    });
    try {
      expect(server.port).toBeGreaterThan(0);
      expect(server.baseUrl).toBe(`http://127.0.0.1:${server.port}`);
      expect(server.profile.rootDir).toBeTruthy();
      expect(server.profile.id.startsWith('sandbox_')).toBe(true);
      expect(server.exhausted).toBe(false);

      const response = await fetch(`${server.baseUrl}/ping`);
      expect(await response.text()).toBe('pong');
    } finally {
      const result = await server.close();
      expect(result.outcome).toEqual({ status: 'completed', exitCode: 0 });
      expect(result.profileId).toBe(server.profile.id);
      expect(result.enforcement.cwdIsolated).toBe(true);
      expect(result.enforcement.envFiltered).toBe(true);
      // honest v0: a plain child process cannot police egress
      expect(result.enforcement.networkEnforced).toBe(false);
    }
    // idempotent close
    const again = await server.close();
    expect(again.outcome.status).toBe('completed');
  }, 30_000);
});

describe('launchServerInSandbox — budget reaper', () => {
  test('a server without a stop route is killed by the duration budget and reported exhausted', async () => {
    const executor = new ProcessSandboxExecutor();
    const server = await launchServerInSandbox(executor, {
      command: 'bun',
      args: ['server.ts'],
      fixtures: { 'server.ts': pongServerSource(false) },
      budget: { maxDurationMs: 1_500 },
      readyTimeoutMs: 1_000,
      pollIntervalMs: 40,
    });
    const result = await server.close(); // no stopPath → waits for the budget kill
    expect(result.outcome).toEqual({ status: 'budget-exceeded', reason: 'duration' });
    expect(server.exhausted).toBe(true);
  }, 30_000);
});

describe('launchServerInSandbox — failure paths', () => {
  test('a server that never listens times out readiness and surfaces the pending result', async () => {
    const executor = new ProcessSandboxExecutor();
    const neverListens = [
      "import { writeFileSync } from 'node:fs';",
      "writeFileSync('server.port', '42999');",
      'setInterval(function () {}, 1000);',
    ].join('\n');
    let caught: unknown = null;
    try {
      await launchServerInSandbox(executor, {
        command: 'bun',
        args: ['server.ts'],
        fixtures: { 'server.ts': neverListens },
        budget: { maxDurationMs: 2_000 },
        readyTimeoutMs: 600,
        pollIntervalMs: 40,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ServerLaunchError);
    const launchError = caught as ServerLaunchError;
    expect(launchError.message).toContain('did not answer');
    // the budget reaper still owns the orphan — awaiting proves it died
    const result = await launchError.result;
    expect(result.outcome.status).toBe('budget-exceeded');
  }, 30_000);

  test('a server that exits before ready reports the exit honestly', async () => {
    const executor = new ProcessSandboxExecutor();
    const dies = "process.exit(3);";
    let caught: unknown = null;
    try {
      await launchServerInSandbox(executor, {
        command: 'bun',
        args: ['server.ts'],
        fixtures: { 'server.ts': dies },
        budget: { maxDurationMs: 10_000 },
        readyTimeoutMs: 3_000,
        pollIntervalMs: 40,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ServerLaunchError);
    expect((caught as ServerLaunchError).message).toContain('exit code 3');
    const result = await (caught as ServerLaunchError).result;
    expect(result.outcome).toEqual({ status: 'completed', exitCode: 3 });
  }, 30_000);

  test('fixture paths that escape the profile rootDir are rejected', async () => {
    const executor = new ProcessSandboxExecutor();
    let caught: unknown = null;
    try {
      await launchServerInSandbox(executor, {
        command: 'bun',
        args: ['server.ts'],
        fixtures: { '../escape.txt': 'nope' },
        budget: { maxDurationMs: 10_000 },
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain('escapes the execution profile');
  });

  test('readyTimeoutMs must fit inside the budget', () => {
    const executor = new ProcessSandboxExecutor();
    expect(
      launchServerInSandbox(executor, {
        command: 'bun',
        args: ['server.ts'],
        fixtures: { 'server.ts': 'process.exit(0);' },
        budget: { maxDurationMs: 1_000 },
        readyTimeoutMs: 5_000,
      }),
    ).rejects.toThrow(/must be smaller than budget.maxDurationMs/);
  });
});
