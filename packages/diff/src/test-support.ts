/**
 * @clapp/diff — test support (NOT part of the package's public surface).
 *
 * The harnesses the test battery needs: spawning a codegen-generated
 * candidate app (ephemeral port + health poll, the @clapp/codegen
 * acceptance precedent), mutating generated files for the negative
 * controls (before the server starts), and small shared setup helpers.
 * Same in-package discipline as @clapp/plan's src/test-utils.ts.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AppManifest } from '@clapp/codegen';

/** A spawned candidate app server (bun server.ts, PORT=0, health-polled). */
export interface SpawnedCandidate {
  readonly url: string;
  readonly port: number;
  readonly root: string;
  close(): Promise<void>;
}

const STARTUP_TIMEOUT_MS = 20_000;
const SHUTDOWN_TIMEOUT_MS = 5_000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Spawns a generated candidate app's server (`bun server.ts`) with PORT=0,
 * reads the one JSON line { url, port } it prints once listening, then
 * polls the manifest's health path until it answers. close() SIGTERMs
 * (SIGKILL fallback).
 */
export async function spawnCandidate(root: string, manifest: AppManifest): Promise<SpawnedCandidate> {
  const child: ChildProcess = spawn(process.execPath, ['server.ts'], {
    cwd: root,
    env: { ...process.env, PORT: '0' },
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
    throw new Error(`candidate app at ${root} never reported listening${exited ? ' (process exited)' : ''}; stderr: ${stderr || '(empty)'}`);
  }

  const healthUrl = new URL(manifest.healthPath, info.url).href;
  const healthDeadline = Date.now() + STARTUP_TIMEOUT_MS;
  for (;;) {
    try {
      const response = await fetch(healthUrl, { signal: AbortSignal.timeout(500) });
      await response.text().catch(() => '');
      break;
    } catch {
      if (exited || Date.now() > healthDeadline) {
        child.kill('SIGKILL');
        throw new Error(`candidate app at ${info.url} never answered its health path ${manifest.healthPath}; stderr: ${stderr || '(empty)'}`);
      }
      await delay(50);
    }
  }

  return {
    url: info.url,
    port: info.port,
    root,
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

/**
 * Mutates one generated file BEFORE the server starts (the negative
 * controls): applies every [search, replace] pair (all must occur exactly
 * once) and writes the file back.
 */
export async function mutateGeneratedFile(
  root: string,
  relativePath: string,
  replacements: Array<[search: string, replace: string]>,
): Promise<void> {
  const path = join(root, relativePath);
  let contents = await readFile(path, 'utf8');
  for (const [search, replace] of replacements) {
    const first = contents.indexOf(search);
    if (first === -1 || contents.indexOf(search, first + 1) !== -1) {
      throw new Error(`test-support: expected exactly one occurrence of ${JSON.stringify(search)} in ${relativePath}`);
    }
    contents = contents.replace(search, replace);
  }
  await writeFile(path, contents, 'utf8');
}
