/**
 * @clapp/journey — bench-b01 fixture HTTP server (CLAPP-012).
 *
 * A deliberately tiny static file server for the b01 corpus: node:http
 * stdlib ONLY (no framework), so it runs under bun or node and stays fully
 * self-contained inside a network-deny execution profile.
 *
 * Semantics:
 * - GET/HEAD only (anything else → 405);
 * - URL paths are decoded, normalized, and lexically contained in `root`
 *   (`..` traversal and NUL bytes are rejected);
 * - directories (and `/`) serve `index.html`;
 * - unknown paths serve a small 404 HTML page with data-testid="not-found";
 * - Content-Type is derived from the file extension;
 * - every response carries `Cache-Control: no-store` (deterministic replays).
 *
 * `waitForFixtureServer` is the ready-poll helper for launching the server
 * as a separate process (see server.test.ts and the CLI mode below).
 *
 * CLI: `bun src/fixtures/server.ts [--port N] [--host H] [--root DIR]`
 * prints one JSON line `{ url, port, root }` once listening, then serves
 * until SIGINT/SIGTERM.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

/** .../packages/journey (this file lives in src/fixtures/). */
const packageRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

/** Default corpus root: .../packages/journey/fixtures/b01. */
export function resolveFixtureRoot(): string {
  return join(packageRoot, 'fixtures', 'b01');
}

/** Default seeded-journey directory: .../packages/journey/fixtures/journeys. */
export function resolveSeededJourneysDir(): string {
  return join(packageRoot, 'fixtures', 'journeys');
}

const MIME_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

const NOT_FOUND_PAGE = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>404 — page not found</title></head>
<body>
<main>
<h1>Page not found</h1>
<p data-testid="not-found">The b01 fixture server has no page at this address.</p>
<p><a href="/">Back to home</a></p>
</main>
</body>
</html>
`;

export interface FixtureServerOptions {
  /** Directory to serve (the b01 corpus root). */
  root: string;
  /** Bind host; default 127.0.0.1 (loopback only). */
  host?: string;
  /** Bind port; default 0 (ephemeral). */
  port?: number;
}

export interface FixtureServer {
  readonly host: string;
  readonly port: number;
  /** `http://<host>:<port>/` — safe as a replay baseUrl. */
  readonly url: string;
  readonly root: string;
  close(): Promise<void>;
}

/** Maps a request URL to a file path inside root, or null when invalid. */
function mapUrlToFilePath(root: string, requestUrl: string | undefined): string | null {
  if (requestUrl === undefined) {
    return null;
  }
  const rawPath = requestUrl.split('?')[0]?.split('#')[0] ?? '/';
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return null; // malformed percent-encoding
  }
  if (decoded.includes('\0')) {
    return null;
  }
  const normalized = normalize(`/${decoded}`); // collapses '..', keeps leading '/'
  const resolved = resolve(root, `.${normalized}`);
  const contained = resolved === root || resolved.startsWith(root + sep);
  return contained ? resolved : null;
}

function send(
  response: ServerResponse,
  status: number,
  contentType: string,
  body: string,
  headOnly: boolean,
): void {
  response.writeHead(status, {
    'content-type': contentType,
    'content-length': String(Buffer.byteLength(body, 'utf8')),
    'cache-control': 'no-store',
  });
  response.end(headOnly ? undefined : body);
}

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  root: string,
): Promise<void> {
  const method = request.method ?? 'GET';
  if (method !== 'GET' && method !== 'HEAD') {
    send(response, 405, 'text/plain; charset=utf-8', 'method not allowed\n', false);
    return;
  }
  const headOnly = method === 'HEAD';
  const filePath = mapUrlToFilePath(root, request.url);
  if (filePath === null) {
    send(response, 404, 'text/html; charset=utf-8', NOT_FOUND_PAGE, headOnly);
    return;
  }
  let target = filePath;
  try {
    const info = await stat(filePath);
    if (info.isDirectory()) {
      target = join(filePath, 'index.html');
      await stat(target); // propagates ENOENT for dir-without-index
    }
  } catch {
    send(response, 404, 'text/html; charset=utf-8', NOT_FOUND_PAGE, headOnly);
    return;
  }
  try {
    const body = await readFile(target, 'utf8');
    const contentType = MIME_TYPES[extname(target).toLowerCase()] ?? 'application/octet-stream';
    send(response, 200, contentType, body, headOnly);
  } catch {
    send(response, 500, 'text/plain; charset=utf-8', 'internal server error\n', false);
  }
}

/**
 * Starts the fixture server. Resolves once the socket is listening; the
 * chosen (possibly ephemeral) port is reported on the result.
 */
export async function startFixtureServer(
  options: FixtureServerOptions,
): Promise<FixtureServer> {
  const root = resolve(options.root);
  const host = options.host ?? '127.0.0.1';
  const server: Server = createServer((request, response) => {
    void handle(request, response, root);
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(options.port ?? 0, host, () => {
      resolveListen();
    });
  });
  const address = server.address();
  if (typeof address !== 'object' || address === null) {
    server.close();
    throw new Error(`fixture server: unexpected listen address ${String(address)}`);
  }
  const port = address.port;
  return {
    host,
    port,
    url: `http://${host}:${port}/`,
    root,
    close(): Promise<void> {
      return new Promise((resolveClose, rejectClose) => {
        server.close((error) => {
          if (error !== undefined) rejectClose(error);
          else resolveClose();
        });
      });
    },
  };
}

export interface WaitForFixtureServerOptions {
  /** Total deadline; default 10_000 ms. */
  timeoutMs?: number;
  /** Poll interval; default 50 ms. */
  intervalMs?: number;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

/**
 * Ready-poll helper: resolves as soon as `url` answers any HTTP response;
 * throws when the deadline passes first. Use after spawning the server as
 * a separate process.
 */
export async function waitForFixtureServer(
  url: string,
  options: WaitForFixtureServerOptions = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const intervalMs = options.intervalMs ?? 50;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(Math.max(intervalMs * 4, 250)),
      });
      // Any response (even 404) proves the listener is up.
      await response.text().catch(() => '');
      return;
    } catch {
      // Not ready yet.
    }
    if (Date.now() >= deadline) {
      throw new Error(`fixture server at ${url} did not become ready within ${timeoutMs}ms`);
    }
    await delay(intervalMs);
  }
}

// ---------------------------------------------------------------------------
// CLI mode
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const { values: args } = parseArgs({
    args: process.argv.slice(2),
    options: {
      port: { type: 'string', default: '0' },
      host: { type: 'string', default: '127.0.0.1' },
      root: { type: 'string' },
    },
  });
  const root = args.root ?? resolveFixtureRoot();
  const port = Number(args.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    process.stderr.write(`fixture server: invalid --port ${args.port}\n`);
    process.exit(2);
  }
  const server = await startFixtureServer({ root, host: args.host, port });
  process.stdout.write(`${JSON.stringify({ url: server.url, port: server.port, root: server.root })}\n`);
  const shutdown = (): void => {
    void server.close().then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
