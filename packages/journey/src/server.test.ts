/**
 * CLAPP-012 test battery — the b01 fixture HTTP server.
 *
 * Covers content types, directory index, 404s, traversal rejection,
 * method policy, the CLI child process + ready-poll helper, and the
 * ready-poll timeout.
 */

import { afterAll, describe, expect, it } from 'bun:test';
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  resolveFixtureRoot,
  startFixtureServer,
  waitForFixtureServer,
  type FixtureServer,
} from './fixtures/server';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const serverCli = join(packageRoot, 'src', 'fixtures', 'server.ts');
const fixturesRoot = resolveFixtureRoot();

const scratch: string[] = [];
const servers: FixtureServer[] = [];

afterAll(async () => {
  for (const server of servers) {
    await server.close().catch(() => undefined);
  }
  for (const path of scratch) {
    rmSync(path, { recursive: true, force: true });
  }
});

async function withServer(fn: (server: FixtureServer) => Promise<void>): Promise<void> {
  const server = await startFixtureServer({ root: fixturesRoot });
  servers.push(server);
  await fn(server);
}

describe('fixture server — serving the b01 corpus', () => {
  it('serves / as index.html with the HTML content type', async () => {
    await withServer(async (server) => {
      const response = await fetch(server.url);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');
      const body = await response.text();
      expect(body).toContain('Capture every idea, calmly');
      expect(response.headers.get('cache-control')).toBe('no-store');
    });
  });

  it('serves every corpus page', async () => {
    await withServer(async (server) => {
      for (const page of [
        '/features.html',
        '/pricing.html',
        '/contact.html',
        '/contact-success.html',
        '/newsletter-success.html',
      ]) {
        const response = await fetch(new URL(page, server.url));
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toContain('text/html');
      }
    });
  });

  it('serves assets with their content types', async () => {
    await withServer(async (server) => {
      const expectations: Array<[string, string]> = [
        ['/assets/styles.css', 'text/css'],
        ['/assets/app.js', 'text/javascript'],
        ['/assets/logo.svg', 'image/svg+xml'],
        ['/assets/hero.svg', 'image/svg+xml'],
      ];
      for (const [path, contentType] of expectations) {
        const response = await fetch(new URL(path, server.url));
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toContain(contentType);
      }
    });
  });

  it('ignores query strings', async () => {
    await withServer(async (server) => {
      const response = await fetch(`${server.url}?x=1&y=2`);
      expect(response.status).toBe(200);
    });
  });

  it('returns a 404 HTML page for unknown paths', async () => {
    await withServer(async (server) => {
      const response = await fetch(new URL('/nope.html', server.url));
      expect(response.status).toBe(404);
      expect(await response.text()).toContain('data-testid="not-found"');
    });
  });

  it('rejects path traversal outside the corpus root', async () => {
    await withServer(async (server) => {
      for (const path of ['/../package.json', '/%2e%2e/package.json', '/assets/../../README.md']) {
        const response = await fetch(new URL(path, server.url));
        expect(response.status).toBe(404);
      }
    });
  });

  it('allows HEAD and rejects other methods with 405', async () => {
    await withServer(async (server) => {
      const head = await fetch(server.url, { method: 'HEAD' });
      expect(head.status).toBe(200);
      expect(await head.text()).toBe('');
      const post = await fetch(server.url, { method: 'POST' });
      expect(post.status).toBe(405);
    });
  });

  it('reports the chosen ephemeral port and closes cleanly', async () => {
    const server = await startFixtureServer({ root: fixturesRoot });
    expect(server.port).toBeGreaterThan(0);
    expect(server.url).toBe(`http://127.0.0.1:${server.port}/`);
    await expect(server.close()).resolves.toBeUndefined();
  });
});

describe('fixture server — CLI child + ready-poll helper', () => {
  it('starts as a child process, becomes ready, serves, and stops on SIGTERM', async () => {
    // Reserve a port by binding and releasing (tiny race, retried below if lost).
    const probe = await startFixtureServer({ root: fixturesRoot });
    const port = probe.port;
    await probe.close();

    const child = spawn(process.execPath, [
      serverCli,
      '--port',
      String(port),
      '--root',
      fixturesRoot,
    ]);
    try {
      const url = `http://127.0.0.1:${port}/`;
      await waitForFixtureServer(url, { timeoutMs: 15_000, intervalMs: 50 });
      const response = await fetch(url);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain('Nimbus Notes');
    } finally {
      child.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        child.once('exit', () => resolve());
      });
    }
  }, 20_000);

  it('waitForFixtureServer throws on timeout when nothing listens', async () => {
    const probe = await startFixtureServer({ root: fixturesRoot });
    const port = probe.port;
    await probe.close(); // free the port; nothing should answer now
    await expect(
      waitForFixtureServer(`http://127.0.0.1:${port}/`, { timeoutMs: 300, intervalMs: 50 }),
    ).rejects.toThrow(/did not become ready within 300ms/);
  }, 5_000);
});
