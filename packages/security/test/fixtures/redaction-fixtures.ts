// CLAPP-071 — redaction fixtures.
//
// Fresh-object builders for the §3 sensitive-field classes: every builder
// returns a FRESH object each call so tests can hold originals, redact
// copies, and compare them without cross-test interference (the
// authorization-fixture discipline, CLAPP-070; the registry-fixture
// discipline, CLAPP-055). Fixtures never read a clock and hold no shared
// mutable state; they import nothing — they are plain data builders.

// ---- the all-six-classes snapshot -----------------------------------------------------

/**
 * Evidence loaded with every §3 class: a scalar cookie, a nested
 * Authorization header, api keys, passwords, a bearer token, and private
 * user data — plus honest non-sensitive neighbors (requestId, route,
 * displayName) that must ride verbatim.
 */
export interface SensitiveEvidence {
  requestId: string;
  route: string;
  cookie: string;
  headers: { authorization: string };
  apiKey: string;
  secretKey: string;
  password: string;
  userPassword: string;
  sessionToken: string;
  user: { displayName: string; email: string; phone: string };
}

/** The all-six-classes evidence snapshot (a fresh object each call). */
export function sensitiveEvidence(): SensitiveEvidence {
  return {
    requestId: 'req-001',
    route: '/checkout',
    cookie: 'sid=abc123',
    headers: { authorization: 'Bearer eyJhbGciOi.example.sig' },
    apiKey: 'sk-live-4f0e',
    secretKey: 'whsec_9a11',
    password: 'hunter2',
    userPassword: 'correct-horse',
    sessionToken: 'tok-session-1',
    user: { displayName: 'Ada', email: 'ada@example.com', phone: '+15550100' },
  };
}

// ---- the mixed sensitive/non-sensitive snapshot ---------------------------------------

/** Evidence with sensitive and non-sensitive fields side by side. */
export interface MixedEvidence {
  sessionId: string;
  route: string;
  title: string;
  items: Array<{ sku: string; quantity: number; note: string }>;
  apiKey: string;
  password: string;
  user: { displayName: string; email: string };
}

/** The mixed evidence snapshot (a fresh object each call). */
export function mixedEvidence(): MixedEvidence {
  return {
    sessionId: 'sess-123',
    route: '/checkout',
    title: 'Order summary',
    items: [{ sku: 'A-1', quantity: 2, note: 'gift wrap' }],
    apiKey: 'sk-live-4f0e',
    password: 'hunter2',
    user: { displayName: 'Ada', email: 'ada@example.com' },
  };
}

// ---- the §5 nested-path snapshot ------------------------------------------------------

/** The nested-path contract shape: array indexes and nested objects, both named. */
export interface NestedEvidence {
  cookies: Array<{ sessionToken: string }>;
  user: { email: string };
}

/** The nested-path snapshot (a fresh object each call). `cookies` is a walkable
 *  container, so the walk descends into it — the entry is `cookies[0].sessionToken`. */
export function nestedEvidence(): NestedEvidence {
  return { cookies: [{ sessionToken: 'x' }], user: { email: 'a@b.c' } };
}

// ---- the honest no-op snapshot --------------------------------------------------------

/** Evidence with NOTHING sensitive — the honest no-op report's input. */
export function nothingSensitiveEvidence(): Record<string, unknown> {
  return {
    requestId: 'req-042',
    route: '/health',
    title: 'Health check',
    meta: { region: 'eu-1', retries: 0 },
  };
}

// ---- the cyclic snapshot --------------------------------------------------------------

/** Evidence containing a cycle — detected and refused, never walked. */
export interface CyclicEvidence {
  outer: string;
  nested: Record<string, unknown>;
}

/** The cyclic evidence snapshot (a fresh object each call): `nested.self` points
 *  back at `nested` — the back-edge the ancestry WeakSet must catch. */
export function cyclicEvidence(): CyclicEvidence {
  const nested: Record<string, unknown> = { label: 'cycle-target' };
  nested['self'] = nested; // the cycle
  return { outer: 'ok', nested };
}
