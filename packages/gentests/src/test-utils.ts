/**
 * @clapp/gentests — shared test utilities (CLAPP-032 test battery).
 *
 * Scratch discipline: generated suites are written to a hidden .suite-*
 * directory INSIDE packages/gentests so that '@clapp/journey' resolves
 * from them (the generated files import it) while `bun test` discovery
 * from the repo root never sees them (they are removed after every test,
 * and stale directories from crashed runs are wiped before new ones are
 * created — safe because bun test executes files sequentially).
 */

import { spawn } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/** .../packages/gentests (this file lives in src/). */
export const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** .../ (the clapp workspace root). */
export const REPO_ROOT = dirname(dirname(PACKAGE_ROOT));

/** Wipes stale scratch directories left behind by crashed runs. */
export async function cleanStaleScratch(): Promise<void> {
  for (const entry of await readdir(PACKAGE_ROOT, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith('.suite-')) {
      await rm(join(PACKAGE_ROOT, entry.name), { recursive: true, force: true });
    }
  }
}

/** Creates a fresh scratch directory inside packages/gentests. */
export async function makeScratchDir(label: string): Promise<string> {
  await cleanStaleScratch();
  return mkdtemp(join(PACKAGE_ROOT, `.suite-${label}-`));
}

export interface SubprocessResult {
  code: number;
  output: string;
}

/** Runs a subprocess, captures stdout+stderr, and enforces a hard timeout. */
export function runSubprocess(
  command: string,
  args: string[],
  options: { cwd: string; timeoutMs: number },
): Promise<SubprocessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd });
    let output = '';
    const append = (chunk: Buffer): void => {
      output += chunk.toString('utf8');
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`subprocess timed out after ${options.timeoutMs}ms: ${command} ${args.join(' ')}`));
    }, options.timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, output });
    });
  });
}

/**
 * Runs `bun x tsc --noEmit` over a written generated suite, with a strict
 * tsconfig extending the repo's tsconfig.base.json (typescript resolves
 * from the workspace's local install — no network).
 */
export function tscCompileSuite(suiteDir: string): Promise<SubprocessResult> {
  return runSubprocess(
    process.execPath,
    ['x', 'tsc', '--noEmit', '-p', suiteDir],
    { cwd: REPO_ROOT, timeoutMs: 120_000 },
  );
}

/** The extends path a suite-local tsconfig needs to reach tsconfig.base.json. */
export function baseConfigExtendsFrom(suiteDir: string): string {
  return relative(suiteDir, join(REPO_ROOT, 'tsconfig.base.json'));
}
