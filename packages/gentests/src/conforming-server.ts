/**
 * @clapp/gentests — the minimal CONFORMING SERVER (CLAPP-032).
 *
 * `createConformingServer(plan)` is this package's own reference candidate
 * app: a zero-dependency stdlib HTTP server (node:http only) that serves
 * exactly what a plan-conforming candidate must serve, so the GENERATED
 * test suite can be verified end-to-end WITHOUT @clapp/codegen (which is
 * being built in parallel by CLAPP-031). At integration the tech-lead gate
 * re-runs the very same generated suite against the real generated app.
 *
 * What "conforming" means here (mirrors the packet contract):
 * - every planned route serves minimal conforming HTML: semantic tags per
 *   element kind, every testId as data-testid, every heading text, every
 *   form with action/method/fields/labels/submit label (id/for wired so
 *   the journey applier's accessible-name resolution works);
 * - every planned API endpoint is served: endpoints with mocks answer in
 *   declaration order (one mock per request; the LAST mock repeats once
 *   the list is exhausted — a documented, deterministic semantics),
 *   endpoints WITHOUT mocks answer 501 with a JSON error body naming the
 *   endpoint (id + urlPattern);
 * - the plan's healthPath answers 200;
 * - unknown routes answer 404 (HTML page carrying data-testid="not-found",
 *   like the b01 fixture server);
 * - a wrong method on an API endpoint answers 405 (JSON error body);
 *   routes additionally accept POST (and HEAD) because the plan contract
 *   lets a form's action point at a route path — the applier submits
 *   POST forms there — and answer 405 for every other method.
 *
 * Honest limitations (documented, by design):
 * - Elements render FLAT in document order. The plan's element list is a
 *   flat in-order list with no containment model, so links are not nested
 *   inside their <nav> and fields are only nested inside their owning
 *   <form> (which the journey mechanics require). Journey selector
 *   resolution is role/name/testId + nth over document order, which flat
 *   rendering preserves exactly.
 * - No scripts, no styles, no storage writes: the journey applier does not
 *   execute page scripts, so a conforming candidate for replay purposes
 *   does not need them (the plan's storage bindings are declared for the
 *   P4 paired runner, not for this server).
 * - Text and attribute values are interpolated WITHOUT HTML escaping:
 *   plan literals are plain fixture text (no markup-shaped content); the
 *   generated route tests compare raw strings, so escaping would break
 *   them. Documented for @clapp/codegen: keep plan texts plain.
 * - Images render without a src attribute (the plan carries alt text but
 *   no media); nothing in replay or the generated tests fetches images.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type {
  PlannedElement,
  PlannedField,
  PlannedForm,
  PlannedPage,
  SynthesisPlan,
} from './synthesis-contract';

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export interface ConformingServerOptions {
  /** Port to bind on 127.0.0.1; default: the plan's server spec port. */
  port?: number;
}

export interface ConformingServerHandle {
  /** `http://127.0.0.1:<port>/` — safe as a replay baseUrl. */
  readonly url: string;
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// HTML rendering
// ---------------------------------------------------------------------------

/** Attributes shared by every element kind (data-testid first, by contract). */
function commonAttrs(element: PlannedElement): string {
  const parts: string[] = [];
  if (element.testId !== undefined && element.testId !== '') {
    parts.push(`data-testid="${element.testId}"`);
  }
  return parts.join(' ');
}

/** kind 'other' + role → the semantic landmark tag (contentinfo → footer, …). */
function landmarkTag(element: PlannedElement): string {
  switch (element.role) {
    case 'contentinfo':
      return 'footer';
    case 'banner':
      return 'header';
    case 'main':
      return 'main';
    case 'complementary':
      return 'aside';
    case 'region':
    case 'section':
      return 'section';
    default:
      return 'div';
  }
}

/** Renders one field of a planned form (label + control, id/for wired). */
function renderField(form: PlannedForm, field: PlannedField): string {
  const id = `${form.id}-${field.name}`;
  const testId = field.testId !== undefined && field.testId !== '' ? ` data-testid="${field.testId}"` : '';
  const required = field.required === true ? ' required' : '';
  const placeholder =
    field.placeholder !== undefined && field.placeholder !== '' ? ` placeholder="${field.placeholder}"` : '';
  const label = `<label for="${id}">${field.label}</label>`;
  const type = field.type.toLowerCase();
  if (type === 'select') {
    const options = (field.options ?? []).map(
      (option, index) =>
        `<option value="${option.value}"${index === 0 ? ' selected' : ''}>${option.label}</option>`,
    );
    return `${label}\n<select id="${id}" name="${field.name}"${testId}${required}>${options.join('')}</select>`;
  }
  if (type === 'textarea') {
    return `${label}\n<textarea id="${id}" name="${field.name}" rows="6"${testId}${required}></textarea>`;
  }
  if (type === 'radio') {
    // One radio per option; each option carries its own label.
    const radios = (field.options ?? []).map(
      (option) =>
        `<input type="radio" id="${id}-${option.value}" name="${field.name}" value="${option.value}"${required}>` +
        `<label for="${id}-${option.value}">${option.label}</label>`,
    );
    return radios.join('\n');
  }
  if (type === 'hidden') {
    return `<input type="hidden" id="${id}" name="${field.name}" value="">`;
  }
  if (type === 'checkbox') {
    return `${label}\n<input type="checkbox" id="${id}" name="${field.name}" value="on"${testId}${required}>`;
  }
  // text / email / password / number / tel / url / search / date — anything
  // else degrades to a text input (honest default, documented).
  const inputType = ['text', 'email', 'password', 'number', 'tel', 'url', 'search', 'date'].includes(type)
    ? type
    : 'text';
  return `${label}\n<input type="${inputType}" id="${id}" name="${field.name}"${testId}${required}${placeholder}>`;
}

/** Renders a whole planned form (fields + submit affordance). */
function renderForm(form: PlannedForm): string {
  const testId = form.submitTestId !== undefined && form.submitTestId !== ''
    ? ` data-testid="${form.submitTestId}"`
    : '';
  const fields = form.fields.map((field) => renderField(form, field)).join('\n');
  return [
    `<form action="${form.action}" method="${form.method}">`,
    fields,
    `<button type="submit"${testId}>${form.submitLabel}</button>`,
    '</form>',
  ].join('\n');
}

/** Renders one planned element as minimal conforming HTML. */
function renderElement(element: PlannedElement, formsById: Map<string, PlannedForm>): string {
  const attrs = commonAttrs(element);
  const attr = attrs === '' ? '' : ` ${attrs}`;
  const content = element.text ?? element.name ?? '';
  switch (element.kind) {
    case 'heading': {
      const level = Math.min(Math.max(element.level ?? 1, 1), 6);
      return `<h${level}${attr}>${content}</h${level}>`;
    }
    case 'text':
      return `<p${attr}>${content}</p>`;
    case 'link': {
      // When an accessible name differs from the visible text, the name is
      // an aria-label (b01 "Learn more" pattern).
      const aria =
        element.name !== undefined && element.text !== undefined && element.name !== element.text
          ? ` aria-label="${element.name}"`
          : '';
      const href = element.href !== undefined ? ` href="${element.href}"` : '';
      return `<a${href}${aria}${attr}>${content}</a>`;
    }
    case 'button':
      return `<button type="button"${attr}>${content}</button>`;
    case 'image': {
      const alt = element.alt ?? element.name ?? '';
      return `<img alt="${alt}"${attr}>`;
    }
    case 'navigation': {
      const aria = element.name !== undefined ? ` aria-label="${element.name}"` : '';
      return `<nav${aria}${attr}></nav>`;
    }
    case 'form': {
      if (element.formId !== undefined) {
        const form = formsById.get(element.formId);
        if (form !== undefined) {
          const formHtml = renderForm(form);
          // Carry the element's own testId onto the rendered form tag.
          if (attr === '') return formHtml;
          return formHtml.replace('<form ', `<form${attr} `);
        }
      }
      // A form element referencing an unknown form id degrades to a marker
      // div (honest gap; the generated route tests would flag the page).
      return `<div${attr}></div>`;
    }
    case 'list':
      return `<ul${attr}></ul>`;
    case 'other': {
      const tag = landmarkTag(element);
      const aria = element.name !== undefined ? ` aria-label="${element.name}"` : '';
      return content === ''
        ? `<${tag}${aria}${attr}></${tag}>`
        : `<${tag}${aria}${attr}>${content}</${tag}>`;
    }
    default: {
      // Exhaustiveness guard: every PlannedElement kind is handled above.
      const exhaustive: never = element.kind;
      throw new Error(`conforming server: unsupported element kind ${String(exhaustive)}`);
    }
  }
}

/** Renders a full conforming page for a planned route. */
function renderPage(page: PlannedPage): string {
  const formsById = new Map<string, PlannedForm>();
  for (const form of page.forms) {
    formsById.set(form.id, form);
  }
  const body = page.elements.map((element) => renderElement(element, formsById)).join('\n');
  // Forms declared on the page but never placed by a form element are
  // appended after the element list (a conforming candidate serves every
  // declared form; the generated route tests check every declared label).
  const placedFormIds = new Set(
    page.elements.filter((element) => element.kind === 'form').map((element) => element.formId),
  );
  const appended = page.forms
    .filter((form) => !placedFormIds.has(form.id))
    .map((form) => renderForm(form))
    .join('\n');
  const fullBody = appended === '' ? body : `${body}\n${appended}`;
  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    `<title>${page.title}</title>`,
    '</head>',
    '<body>',
    fullBody,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// API endpoint matching
// ---------------------------------------------------------------------------

interface CompiledEndpoint {
  endpointId: string;
  method: string;
  urlPattern: string;
  regex: RegExp;
  mocks: { statusCode: number; bodyJson: unknown }[];
  consumed: number;
}

/** "/api/items/:id" → /^\/api\/items\/([^/]+)$/. */
export function compileUrlPattern(urlPattern: string): RegExp {
  const segments = urlPattern.split('/').map((segment) =>
    segment.startsWith(':')
      ? '([^/]+)'
      : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
  );
  return new RegExp(`^${segments.join('/')}$`);
}

function compileEndpoints(plan: SynthesisPlan): CompiledEndpoint[] {
  const mocksByEndpoint = new Map<string, { statusCode: number; bodyJson: unknown }[]>();
  for (const mock of plan.api.mocks) {
    const list = mocksByEndpoint.get(mock.endpointId) ?? [];
    if (mock.bodyJson !== undefined) {
      list.push({ statusCode: mock.statusCode, bodyJson: mock.bodyJson });
    } else {
      list.push({ statusCode: mock.statusCode, bodyJson: undefined });
    }
    mocksByEndpoint.set(mock.endpointId, list);
  }
  return plan.api.endpoints.map((endpoint) => ({
    endpointId: endpoint.id,
    method: endpoint.method.toUpperCase(),
    urlPattern: endpoint.urlPattern,
    regex: compileUrlPattern(endpoint.urlPattern),
    mocks: mocksByEndpoint.get(endpoint.id) ?? [],
    consumed: 0,
  }));
}

// ---------------------------------------------------------------------------
// The server
// ---------------------------------------------------------------------------

const NOT_FOUND_PAGE = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>404 — page not found</title></head>
<body>
<main>
<h1>Page not found</h1>
<p data-testid="not-found">This conforming server has no page at this address.</p>
<p><a href="/">Back to home</a></p>
</main>
</body>
</html>
`;

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

function sendJson(response: ServerResponse, status: number, payload: unknown, headOnly: boolean): void {
  // 204/304 must not carry a body; the JSON payload is dropped for those.
  if (status === 204 || status === 304) {
    response.writeHead(status, { 'cache-control': 'no-store' });
    response.end(headOnly ? undefined : '');
    return;
  }
  send(response, status, 'application/json; charset=utf-8', `${JSON.stringify(payload)}\n`, headOnly);
}

function requestPath(request: IncomingMessage): string {
  const raw = request.url ?? '/';
  let pathname = raw.split('?')[0]?.split('#')[0] ?? '/';
  try {
    pathname = decodeURIComponent(pathname);
  } catch {
    // malformed percent-encoding: fall back to the raw path (404s later)
  }
  return pathname === '' ? '/' : pathname;
}

/**
 * Starts the minimal conforming server for `plan`. Resolves once the
 * socket is listening; `close()` shuts it down.
 */
export function createConformingServer(
  plan: SynthesisPlan,
  options: ConformingServerOptions = {},
): Promise<ConformingServerHandle> {
  const port = options.port ?? plan.server.port;
  const host = '127.0.0.1';

  const routesByPath = new Map<string, PlannedPage>();
  for (const route of plan.routes) {
    const page = plan.pages.find((candidate) => candidate.id === route.pageId);
    if (page !== undefined) {
      // First declaration wins on duplicate paths (the generator refuses
      // duplicates anyway; here it just stays deterministic).
      if (!routesByPath.has(route.path)) {
        routesByPath.set(route.path, page);
      }
    }
  }
  const endpoints = compileEndpoints(plan);
  const healthPath = plan.server.healthPath === '' ? '/' : plan.server.healthPath;

  const server: Server = createServer((request, response) => {
    try {
      void handle(request, response, routesByPath, endpoints, healthPath);
    } catch (error) {
      send(response, 500, 'text/plain; charset=utf-8', `internal error: ${String(error)}\n`, false);
    }
  });

  function handle(
    request: IncomingMessage,
    response: ServerResponse,
    routes: Map<string, PlannedPage>,
    apiEndpoints: CompiledEndpoint[],
    health: string,
  ): void {
    const method = (request.method ?? 'GET').toUpperCase();
    const headOnly = method === 'HEAD';
    const pathname = requestPath(request);

    // 1) planned routes (exact path, with trailing-slash tolerance).
    const page = routes.get(pathname) ?? (pathname !== '/' && pathname.endsWith('/') ? routes.get(pathname.slice(0, -1)) : undefined);
    if (page !== undefined) {
      if (method === 'GET' || method === 'HEAD') {
        send(response, 200, 'text/html; charset=utf-8', renderPage(page), headOnly);
        return;
      }
      if (method === 'POST') {
        // A plan may point a form's action at a route path; the applier
        // POSTs form-urlencoded bodies there. The page re-renders (the
        // conforming behavior the replay model can observe).
        send(response, 200, 'text/html; charset=utf-8', renderPage(page), headOnly);
        return;
      }
      send(response, 405, 'text/plain; charset=utf-8', 'method not allowed\n', false);
      return;
    }

    // 2) health path.
    if (pathname === health) {
      if (method === 'GET' || method === 'HEAD') {
        send(response, 200, 'text/plain; charset=utf-8', 'ok\n', headOnly);
        return;
      }
      send(response, 405, 'text/plain; charset=utf-8', 'method not allowed\n', false);
      return;
    }

    // 3) API endpoints.
    for (const endpoint of apiEndpoints) {
      if (!endpoint.regex.test(pathname)) continue;
      if (method !== 'HEAD' && method !== endpoint.method) {
        sendJson(response, 405, { error: 'method not allowed', endpointId: endpoint.endpointId, allowed: [endpoint.method] }, headOnly);
        return;
      }
      if (endpoint.mocks.length === 0) {
        sendJson(
          response,
          501,
          {
            error: 'not implemented',
            endpointId: endpoint.endpointId,
            method: endpoint.method,
            urlPattern: endpoint.urlPattern,
          },
          headOnly,
        );
        return;
      }
      // Mocks are consumed in declaration order, one per request; the
      // last mock repeats after the list is exhausted.
      const index = Math.min(endpoint.consumed, endpoint.mocks.length - 1);
      const mock = endpoint.mocks[index];
      endpoint.consumed += 1;
      if (mock === undefined) {
        sendJson(response, 500, { error: 'mock state corrupted', endpointId: endpoint.endpointId }, headOnly);
        return;
      }
      if (mock.bodyJson === undefined) {
        send(response, mock.statusCode, 'application/json; charset=utf-8', '', headOnly);
        return;
      }
      sendJson(response, mock.statusCode, mock.bodyJson, headOnly);
      return;
    }

    // 4) nothing matched: 404.
    send(response, 404, 'text/html; charset=utf-8', NOT_FOUND_PAGE, headOnly);
  }

  return new Promise<ConformingServerHandle>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const address = server.address();
      if (typeof address !== 'object' || address === null) {
        server.close();
        reject(new Error(`conforming server: unexpected listen address ${String(address)}`));
        return;
      }
      resolve({
        url: `http://${host}:${address.port}/`,
        close(): Promise<void> {
          return new Promise((resolveClose, rejectClose) => {
            server.close((error) => {
              if (error !== undefined) rejectClose(error);
              else resolveClose();
            });
          });
        },
      });
    });
  });
}
