/**
 * @clapp/codegen — writeApp: materialize a GeneratedApp file tree (CLAPP-031).
 *
 * Writes every generated file under `targetDir` (mkdir -p semantics for
 * nested paths such as pages/docs/guide.html.ts), overwriting existing
 * files — the operation is idempotent: writing the same app twice yields
 * the same tree. Returns the absolute root directory.
 *
 * Defensive: generated paths are produced by this package and are always
 * relative with forward slashes, but a malformed path (absolute, '..',
 * empty segments, backslashes, NUL) throws rather than escaping the
 * target directory.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { GeneratedApp } from './types';

export async function writeApp(app: GeneratedApp, targetDir: string): Promise<string> {
  const root = resolve(targetDir);
  for (const file of app.files) {
    if (
      file.path.includes('\\') ||
      file.path.includes('\0') ||
      file.path.startsWith('/') ||
      file.path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
    ) {
      throw new TypeError(`codegen writeApp: unsafe generated file path ${JSON.stringify(file.path)}`);
    }
    const filePath = resolve(root, ...file.path.split('/'));
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, file.contents, 'utf8');
  }
  return root;
}
