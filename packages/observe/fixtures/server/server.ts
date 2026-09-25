// CLAPP-010 fixture server — runs INSIDE an isolated ExecutionProfile via
// launchServerInSandbox (command: bun, args: ['server.ts']).
//
// Serves the observation fixture (static assets + JSON APIs + a WebSocket
// echo endpoint), writes its ephemeral port to ../server.port (resolved
// against the profile rootDir), and exits cooperatively on POST
// /__clapp/stop so close() is graceful.
//
// Fixture credentials are FAKE and assembled at runtime from fragments —
// no secret-shaped literals in fixture sources (repo constitution).
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const publicDir = join(import.meta.dir, 'public');

// runtime-assembled fake credentials (never whole literals in source)
const fakeEmail = ['ops', '@', 'clapp-fixture', '.', 'example'].join('');
const fakeJwt = ['eyJhbGciOiJIUzI1NiJ9', '.eyJzdWIiOiJ', 'maXh0dXJlIn0', '.c2lnbmF0dXJl', 'LWZyYWdtZW50'].join('');
const fakeHexToken = ['3f9a1c', '7b2e84', 'd05f31', 'a8c47e', '69b0d2', 'f4173a', 'c58e90', '12bd6f'].join('');

const JSON_HEADERS = { 'content-type': 'application/json' };

const server = Bun.serve({
  port: 0,
  fetch(request, upgradeServer) {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/__clapp/stop') {
      setTimeout(() => process.exit(0), 100); // let the response flush first
      return new Response('stopping', { status: 200 });
    }
    if (url.pathname === '/ws') {
      if (upgradeServer.upgrade(request)) return undefined;
      return new Response('upgrade failed', { status: 400 });
    }
    if (url.pathname === '/api/data') {
      return new Response('{"items":["alpha","beta","gamma"],"count":3}', {
        headers: { ...JSON_HEADERS, 'set-cookie': 'fixture_session=demo-session-token-value; path=/' },
      });
    }
    if (url.pathname === '/api/user') {
      return new Response(JSON.stringify({ email: fakeEmail, token: fakeJwt, apiKey: fakeHexToken }), {
        headers: JSON_HEADERS,
      });
    }
    return serveStatic(url.pathname);
  },
  websocket: {
    message(ws, message) {
      ws.send(`echo:${String(message)}`);
    },
  },
});

writeFileSync(join(import.meta.dir, 'server.port'), String(server.port));

function serveStatic(pathname: string): Response {
  const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
  const target = resolve(publicDir, relative);
  if (target !== publicDir && !target.startsWith(publicDir + '/')) {
    return new Response('forbidden', { status: 403 });
  }
  const file = Bun.file(target);
  if (!file.exists()) {
    return new Response('not found', { status: 404 });
  }
  return new Response(file, { headers: { 'content-type': contentTypeFor(relative) } });
}

function contentTypeFor(name: string): string {
  if (name.endsWith('.html')) return 'text/html; charset=utf-8';
  if (name.endsWith('.css')) return 'text/css; charset=utf-8';
  if (name.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (name.endsWith('.webmanifest')) return 'application/manifest+json';
  if (name.endsWith('.svg')) return 'image/svg+xml';
  return 'application/octet-stream';
}
