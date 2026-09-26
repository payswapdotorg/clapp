/**
 * @clapp/repair — git plumbing for candidate trees (CLAPP-042).
 *
 * The repair loop commits its own work INSIDE the candidate tree's git
 * repository (the candidate root is a git repo in every supported flow:
 * tests `git init` + commit the pristine generated app first). All
 * commands run with a self-contained identity (-c user.name/user.email,
 * -c commit.gpgsign=false) so commits never depend on the ambient git
 * config, and with `--no-optional-locks` so concurrent readers never see
 * stray index.lock files.
 */

import { spawn } from 'node:child_process';

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs `git <args>` in `cwd` with the repair identity. Never throws. */
export function git(args: string[], cwd: string, timeoutMs = 30_000): Promise<GitResult> {
  return new Promise((resolve) => {
    const identityArgs = [
      '-c',
      'user.name=clapp-repair',
      '-c',
      'user.email=repair@clapp.local',
      '-c',
      'commit.gpgsign=false',
      '--no-optional-locks',
      ...args,
    ];
    const child = spawn('git', identityArgs, { cwd });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
    }, timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: `${stderr}${String(error)}` });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

/** The current HEAD commit sha, or null when the repo has no commits / git failed. */
export async function gitHead(cwd: string): Promise<string | null> {
  const result = await git(['rev-parse', 'HEAD'], cwd);
  if (result.code !== 0) {
    return null;
  }
  const sha = result.stdout.trim();
  return sha === '' ? null : sha;
}

/** Files modified/created relative to `baseSha` at HEAD (empty when identical). */
export async function gitChangedPaths(cwd: string, baseSha: string): Promise<string[]> {
  const result = await git(['diff', '--name-only', `${baseSha}..HEAD`], cwd);
  if (result.code !== 0) {
    return [];
  }
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/** `git status --porcelain` entries (empty when the tree is clean). */
export async function gitStatusPorcelain(cwd: string): Promise<string[]> {
  const result = await git(['status', '--porcelain'], cwd);
  if (result.code !== 0) {
    return [];
  }
  // Keep the raw "XY <path>" porcelain format (XY = 2 status chars, the
  // path starts at column 3); callers parse with slice(3).
  return result.stdout
    .split('\n')
    .filter((line) => line.trim() !== '');
}

/**
 * Commits exactly `paths` (which must already contain the edits on disk)
 * with the given message. Returns the list of paths the commit actually
 * changed (empty when there was nothing to commit). Never touches other
 * files: only `paths` are staged.
 */
export async function gitCommitPaths(
  cwd: string,
  paths: string[],
  message: string,
): Promise<{ committed: boolean; changedPaths: string[] }> {
  if (paths.length === 0) {
    return { committed: false, changedPaths: [] };
  }
  const add = await git(['add', '--', ...paths], cwd);
  if (add.code !== 0) {
    return { committed: false, changedPaths: [] };
  }
  const staged = await git(['diff', '--cached', '--name-only'], cwd);
  if (staged.code !== 0 || staged.stdout.trim() === '') {
    return { committed: false, changedPaths: [] };
  }
  const commit = await git(['commit', '-m', message], cwd);
  if (commit.code !== 0) {
    return { committed: false, changedPaths: [] };
  }
  const changed = await git(['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'], cwd);
  const changedPaths =
    changed.code === 0
      ? changed.stdout
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line !== '')
      : [...paths];
  return { committed: true, changedPaths };
}

/** Hard-resets tracked files to `sha` (used only to void an aborted attempt). */
export async function gitResetHard(cwd: string, sha: string): Promise<boolean> {
  const result = await git(['reset', '--hard', sha], cwd);
  return result.code === 0;
}
