/**
 * CLAPP-032 test battery — writeSuite: materializes files, returns the
 * resolved root, regenerates idempotently, and refuses path escapes.
 */

import { describe, expect, test } from 'bun:test';
import { readFile, rm } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { generateTestSuite } from './generate';
import { writeSuite } from './write-suite';
import type { GeneratedTestSuite } from './generate';
import { makeScratchDir } from './test-utils';

const minimalSuite: GeneratedTestSuite = {
  files: [
    { path: 'routes.test.ts', contents: '// generated routes\n' },
    { path: 'nested/api.test.ts', contents: '// generated api\n' },
  ],
  manifest: {
    testCount: 2,
    routeTestCount: 2,
    apiTestCount: 0,
    acceptanceTestCount: 0,
    skippedAcceptanceIds: [],
  },
};

describe('writeSuite', () => {
  test('materializes the files and returns an absolute root', async () => {
    const root = await makeScratchDir('write');
    try {
      const returned = await writeSuite(minimalSuite, join(root, 'inner'));
      expect(isAbsolute(returned)).toBe(true);
      expect(await readFile(join(returned, 'routes.test.ts'), 'utf8')).toBe('// generated routes\n');
      expect(await readFile(join(returned, 'nested/api.test.ts'), 'utf8')).toBe('// generated api\n');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('writing again is idempotent (overwrite semantics)', async () => {
    const root = await makeScratchDir('write2');
    try {
      const first = await writeSuite(minimalSuite, root);
      const second = await writeSuite(minimalSuite, root);
      expect(second).toBe(first);
      expect(await readFile(join(root, 'routes.test.ts'), 'utf8')).toBe('// generated routes\n');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('refuses file paths escaping the target directory', async () => {
    const root = await makeScratchDir('write3');
    try {
      // Seed the directory with a legitimate suite first.
      await writeSuite(minimalSuite, root);
      const escaping: GeneratedTestSuite = {
        files: [{ path: '../evil.test.ts', contents: 'x' }],
        manifest: minimalSuite.manifest,
      };
      await expect(writeSuite(escaping, root)).rejects.toThrow('outside the target directory');
      // The legitimate file is untouched by the refused write.
      expect(await readFile(join(root, 'routes.test.ts'), 'utf8')).toBe('// generated routes\n');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('writes a real generated suite byte-identically', async () => {
    const plan = {
      planVersion: '0.1',
      application: {
        id: 'appsyn_w',
        name: 'W',
        platform: 'web' as const,
        sourceModelId: 'app_w',
        entrypoints: ['/'],
      },
      routes: [{ id: 'route_home', path: '/', pageId: 'page_home', provenance: pp('r') }],
      pages: [
        {
          id: 'page_home',
          routeId: 'route_home',
          title: 'Home',
          provenance: pp('p'),
          elements: [],
          forms: [],
        },
      ],
      navigation: [],
      storage: [],
      api: { endpoints: [], mocks: [] },
      acceptance: [],
      server: { startCommand: 'bun run start', port: 46235, healthPath: '/' },
      assumptions: [],
      constraints: [],
    };
    const suite = generateTestSuite(plan);
    expect(suite.manifest).toEqual({
      testCount: 2,
      routeTestCount: 2,
      apiTestCount: 0,
      acceptanceTestCount: 0,
      skippedAcceptanceIds: [],
    });
    expect(suite.files.map((file) => file.path)).toEqual(['routes.test.ts']);
    const root = await makeScratchDir('write4');
    try {
      await writeSuite(suite, root);
      for (const file of suite.files) {
        expect(await readFile(join(root, file.path), 'utf8')).toBe(file.contents);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

const pp = (rationale: string) => ({
  level: 'planned' as const,
  rationale,
  sourceIds: [],
  evidenceRefs: [],
});
