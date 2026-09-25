/**
 * @clapp/gentests — suite writer (CLAPP-032).
 *
 * `writeSuite(suite, targetDir)` materializes a GeneratedTestSuite to disk
 * (creating the directory tree as needed) and returns the resolved suite
 * root. Files overwrite existing ones at the same paths (regeneration is
 * idempotent); relative file paths are validated to stay INSIDE the
 * target directory.
 *
 * Resolution requirement (see generate.ts): the written suite imports
 * '@clapp/journey', so run `bun test` from a directory where that resolves
 * — any directory inside the clapp workspace works (the tests in this
 * package write scratch suites into a hidden .suite directory inside
 * packages/gentests for exactly that reason, and clean them up afterwards).
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import type { GeneratedTestSuite } from './generate';

/** Resolves `path` under `root`, or throws when it escapes the root. */
function safeJoin(root: string, path: string): string {
  const target = resolve(root, path);
  if (target !== root && !target.startsWith(root + sep)) {
    throw new Error(`writeSuite: refusing to write outside the target directory: ${path}`);
  }
  return target;
}

/**
 * Materializes the suite's files under `targetDir` and returns the resolved
 * root directory.
 */
export async function writeSuite(suite: GeneratedTestSuite, targetDir: string): Promise<string> {
  const root = resolve(targetDir);
  await mkdir(root, { recursive: true });
  for (const file of suite.files) {
    const target = safeJoin(root, file.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.contents, 'utf8');
  }
  return root;
}
