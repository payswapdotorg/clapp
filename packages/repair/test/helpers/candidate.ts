/**
 * @clapp/repair tests — candidate tree construction (CLAPP-042).
 *
 * Builds the CANDIDATE under a hidden scratch directory inside
 * packages/repair (`.candidates-<label>-*`, wiped before creation, always
 * removed by tests, gitignored): generateApp(plan) → writeApp →
 * `git init` + pristine commit → apply the test's declared mutations →
 * mutation commit. The candidate root is a real git repo whose history
 * the repair loop extends with its own commits.
 */

import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateApp, writeApp } from '@clapp/codegen';
import type { SynthesisPlan } from '@clapp/plan';
import {
  git,
  gitCommitPaths,
  gitHead,
} from '../../src/git';
import { spawnCandidate, type SpawnedCandidate } from './spawn-app';

/** .../packages/repair (this file lives in test/helpers/). */
export const PACKAGE_ROOT = join(
  fileURLToPath(import.meta.url),
  '..',
  '..',
  '..',
);

/** One declared mutation: an exact single-occurrence string replacement in one candidate file. */
export interface Mutation {
  /** Candidate-relative file path, e.g. "pages/pricing.html.ts". */
  path: string;
  /** The exact substring to replace (must appear EXACTLY once). */
  find: string;
  /** The replacement ("" removes the substring). */
  replace: string;
  /** Human label for failure messages. */
  label: string;
}

export interface CandidateHandle {
  /** Absolute candidate root (the git repo). */
  root: string;
  /** SHA of the pristine generated app commit. */
  pristineSha: string;
  /** SHA of the mutation commit (loop base). */
  mutatedSha: string;
  /** The mutations that were applied (for inverse checks). */
  mutations: Mutation[];
}

async function cleanStaleScratch(): Promise<void> {
  for (const entry of await readdir(PACKAGE_ROOT, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith('.candidates-')) {
      await rm(join(PACKAGE_ROOT, entry.name), { recursive: true, force: true });
    }
  }
}

/** Reads one file from the candidate tree (absolute path join). */
export async function readCandidateFile(root: string, relativePath: string): Promise<string> {
  return readFile(join(root, ...relativePath.split('/')), 'utf8');
}

/** Reads one file's bytes at a given commit (`git show <sha>:<path>`). */
export async function gitShowFile(root: string, sha: string, relativePath: string): Promise<string> {
  const result = await git(['show', `${sha}:${relativePath}`], root);
  if (result.code !== 0) {
    throw new Error(`git show ${sha}:${relativePath} failed: ${result.stderr}`);
  }
  return result.stdout;
}

/** Recursively lists all file paths (forward slashes, .git excluded) under a directory. */
export async function listTreeFiles(root: string, prefix = ''): Promise<string[]> {
  const entries = await readdir(join(root, ...prefix.split('/').filter(Boolean)), {
    withFileTypes: true,
  });
  const files: string[] = [];
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (entry.isDirectory() && entry.name === '.git') {
      continue; // the git repo's own metadata is not candidate content
    }
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...(await listTreeFiles(root, rel)));
    } else {
      files.push(rel);
    }
  }
  return files;
}

/**
 * Builds the candidate: pristine generated app (committed) + declared
 * mutations (committed). Each mutation's `find` must appear EXACTLY once
 * in its file — the test scaffolding refuses ambiguous mutations.
 * `cleanStale: false` skips wiping other `.candidates-*` directories
 * (used when two candidates must coexist, e.g. the determinism test).
 */
export async function buildCandidate(
  plan: SynthesisPlan,
  label: string,
  mutations: Mutation[],
  options: { cleanStale?: boolean } = {},
): Promise<CandidateHandle> {
  if (options.cleanStale ?? true) {
    await cleanStaleScratch();
  }
  const root = await mkdtemp(join(PACKAGE_ROOT, `.candidates-${label}-`));

  const app = generateApp(plan);
  await writeApp(app, root);

  // NOTE: src/git.ts injects the git identity itself (global -c flags
  // before the subcommand), so no identity handling is needed here.
  const init = await git(['init'], root);
  if (init.code !== 0) {
    throw new Error(`git init failed: ${init.stderr}`);
  }
  const addAll = await git(['add', '-A'], root);
  if (addAll.code !== 0) {
    throw new Error(`git add failed: ${addAll.stderr}`);
  }
  const pristineCommit = await git(
    ['commit', '-m', 'candidate: pristine b01 golden app (CLAPP-031 codegen output)'],
    root,
  );
  if (pristineCommit.code !== 0) {
    throw new Error(`pristine commit failed: ${pristineCommit.stderr}`);
  }
  const pristineSha = await gitHead(root);
  if (pristineSha === null) {
    throw new Error('pristine sha missing');
  }

  // Apply mutations.
  const touched = new Set<string>();
  for (const mutation of mutations) {
    const before = await readCandidateFile(root, mutation.path);
    const occurrences = before.split(mutation.find).length - 1;
    if (occurrences !== 1) {
      throw new Error(
        `mutation "${mutation.label}" find-string appears ${occurrences}x (expected 1) in ${mutation.path}`,
      );
    }
    const after = before.replace(mutation.find, mutation.replace);
    await writeFile(join(root, ...mutation.path.split('/')), after, 'utf8');
    touched.add(mutation.path);
  }
  let mutatedSha = pristineSha;
  if (touched.size > 0) {
    const commit = await gitCommitPaths(
      root,
      [...touched],
      `test: apply ${mutations.length} mutation(s) (${mutations.map((m) => m.label).join(', ')})`,
    );
    if (!commit.committed) {
      throw new Error('mutation commit failed');
    }
    mutatedSha = (await gitHead(root)) ?? pristineSha;
  }

  return { root, pristineSha, mutatedSha, mutations };
}

/** Spawns the candidate's server (fresh process, ephemeral port). */
export function startCandidate(root: string): Promise<SpawnedCandidate> {
  return spawnCandidate(root);
}

/** Removes a candidate scratch directory (test teardown). */
export async function removeCandidate(root: string): Promise<void> {
  await rm(root, { recursive: true, force: true });
}
