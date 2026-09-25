/**
 * @clapp/codegen tests — writeApp idempotence + nested paths (CLAPP-031).
 */

import { afterAll, describe, expect, it } from 'bun:test';
import { readdir, readFile, rm } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateApp, writeApp } from '../src/index';
import type { GeneratedApp } from '../src/index';
import { headingInit, makePlan } from './helpers/plans';

const scratch: string[] = [];

async function tempDir(label: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `clapp-031-${label}-`));
  scratch.push(dir);
  return dir;
}

/** Walks a directory tree into a sorted path→contents map. */
async function snapshot(root: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  async function walk(dir: string, prefix: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        await walk(join(dir, entry.name), relative);
      } else {
        out.set(relative, await readFile(join(dir, entry.name), 'utf8'));
      }
    }
  }
  await walk(root, '');
  return out;
}

const nestedPlan = makePlan({
  pages: [
    { path: '/', title: 'Home', elements: [headingInit('Home')] },
    { path: '/docs/guide', title: 'Guide', elements: [headingInit('Guide')] },
    { path: '/docs/reference/api', title: 'API', elements: [headingInit('API')] },
  ],
});

describe('writeApp', () => {
  it('materializes the tree, creating nested directories for deep route slugs', async () => {
    const app = generateApp(nestedPlan);
    const root = await tempDir('nested');
    const returned = await writeApp(app, root);
    expect(returned).toBe(root);
    const tree = await snapshot(root);
    expect([...tree.keys()].sort()).toEqual(
      [
        'README.md',
        'package.json',
        'pages/docs/guide.html.ts',
        'pages/docs/reference/api.html.ts',
        'pages/index.html.ts',
        'server.ts',
      ].sort(),
    );
  });

  it('is idempotent: writing twice yields the identical tree', async () => {
    const app = generateApp(nestedPlan);
    const root = await tempDir('idempotent');
    await writeApp(app, root);
    const first = await snapshot(root);
    // Corrupt one file, then rewrite: the overwrite must restore it.
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(root, 'pages/index.html.ts'), 'corrupted', 'utf8');
    await writeApp(app, root);
    const second = await snapshot(root);
    expect([...second.keys()].sort()).toEqual([...first.keys()].sort());
    for (const [path, contents] of first) {
      expect(second.get(path)).toBe(contents);
    }
  });

  it('returns an absolute root and resolves relative target dirs', async () => {
    const app = generateApp(makePlan({ pages: [{ path: '/', title: 'H', elements: [headingInit('H')] }] }));
    const base = await tempDir('relative');
    const originalCwd = process.cwd();
    process.chdir(base);
    try {
      const root = await writeApp(app, 'out');
      expect(root.startsWith('/')).toBe(true);
      expect(root.startsWith(base)).toBe(true);
      const tree = await snapshot(root);
      expect(tree.has('server.ts')).toBe(true);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('throws on unsafe generated file paths (defensive)', async () => {
    const bogus: GeneratedApp = {
      files: [{ path: '../evil.txt', contents: 'nope' }],
      manifest: {
        packageName: 'x',
        startCommand: 'bun server.ts',
        port: 1,
        healthPath: '/',
        routePaths: [],
        apiEndpoints: [],
      },
    };
    const root = await tempDir('unsafe');
    await expect(writeApp(bogus, root)).rejects.toThrow(/unsafe generated file path/);
    const tree = await snapshot(root);
    expect(tree.size).toBe(0);
  });
});

// Cleanup after the whole file (bun test runs files as workers).
afterAll(async () => {
  for (const dir of scratch) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});
