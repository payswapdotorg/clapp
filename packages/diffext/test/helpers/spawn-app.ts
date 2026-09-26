/**
 * @clapp/diffext tests — spawned candidate-app harness (CLAPP-041).
 *
 * Spawns a codegen-generated candidate app's server (`bun server.ts`) as
 * a child process with PORT=0 (ephemeral), reads the one JSON line
 * { url, port } the generated server prints once listening, then polls
 * until it answers. close() SIGTERMs (SIGKILL fallback).
 *
 * Authored for this package after @clapp/codegen's private test helper
 * (same generated-server contract; codegen's helper is not exported, and
 * cross-package test imports are not part of the workspace contract).
 */

import { spawn, type ChildProcess } from 'node:child_process';

export interface SpawnedApp {
  readonly url: string;
  readonly port: number;
  readonly root: string;
  close(): Promise<void>;
  stderrText(): string;
}

const STARTUP_TIMEOUT_MS = 20_000;
const SHUTDOWN_TIMEOUT_MS = 5_000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function spawnApp(root: string, options: { port?: number } = {}): Promise<SpawnedApp> {
  const child: ChildProcess = spawn(process.execPath, ['server.ts'], {
    cwd: root,
    env: { ...process.env, PORT: String(options.port ?? 0) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  let exited = false;
  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => {
    stdout += chunk;
  });
  child.stderr?.on('data', (chunk: string) => {
    stderr += chunk;
  });
  child.on('exit', () => {
    exited = true;
  });

  const readInfo = (): { url: string; port: number } | null => {
    const line = stdout.split('\n').find((candidate) => candidate.trim().startsWith('{'));
    if (line === undefined) {
      return null;
    }
    try {
      const parsed = JSON.parse(line) as { url?: unknown; port?: unknown };
      if (typeof parsed.url === 'string' && typeof parsed.port === 'number') {
        return { url: parsed.url, port: parsed.port };
      }
    } catch {
      // keep waiting for a well-formed line
    }
    return null;
  };

  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  let info = readInfo();
  while (info === null && Date.now() < deadline && !exited) {
    await delay(25);
    info = readInfo();
  }
  if (info === null) {
    child.kill('SIGKILL');
    throw new Error(
      `generated app at ${root} never reported listening${exited ? ' (process exited)' : ''}; stderr: ${stderr || '(empty)'}`,
    );
  }

  const healthDeadline = Date.now() + STARTUP_TIMEOUT_MS;
  for (;;) {
    try {
      const response = await fetch(info.url, { signal: AbortSignal.timeout(500) });
      await response.text().catch(() => '');
      break;
    } catch {
      if (exited || Date.now() > healthDeadline) {
        child.kill('SIGKILL');
        throw new Error(`generated app at ${info.url} never answered; stderr: ${stderr || '(empty)'}`);
      }
      await delay(50);
    }
  }

  return {
    url: info.url,
    port: info.port,
    root,
    stderrText: () => stderr,
    async close(): Promise<void> {
      if (exited) {
        return;
      }
      child.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          resolve();
        }, SHUTDOWN_TIMEOUT_MS);
        child.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    },
  };
}
