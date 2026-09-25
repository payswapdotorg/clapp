/**
 * @clapp/observe — runtime log channel: console + page errors + browser log.
 *
 * Typed CaptureRecord payload shapes for the 'runtime' evidence kind, plus
 * the sanitizer that converts arbitrary page-side console arguments into
 * canonical-JSON-safe values (page code can log ANYTHING: undefined,
 * symbols, bigints, non-finite numbers, DOM handles — none of which are
 * canonicalizable) and a deterministic reducer for summaries.
 */

import { isPlainObject } from '../canonical-json';

/** console.log/info/warn/... — level is the raw Playwright msg.type() string. */
export interface ConsoleCapturePayload {
  subkind: 'console';
  level: string;
  /** formatted text (Playwright's inspect-style join of the args) */
  text: string;
  /** structured, sanitized arguments (absent when none could be read) */
  args?: unknown[];
  location?: { url?: string; line?: number; column?: number };
}

/** Uncaught page exception (page.on('pageerror')). */
export interface PageErrorCapturePayload {
  subkind: 'pageerror';
  message: string;
  stack?: string;
}

/** CDP Log.entryAdded browser-level entry (filtered by level policy). */
export interface BrowserLogCapturePayload {
  subkind: 'browser-log';
  source: string;
  level: string;
  text: string;
  url?: string;
  line?: number;
}

export type RuntimeCapturePayload = ConsoleCapturePayload | PageErrorCapturePayload | BrowserLogCapturePayload;

const STACK_CAP = 4000;

/** Build the page-error payload (stack capped for bounded records). */
export function buildPageErrorPayload(message: string, stack: string | undefined): PageErrorCapturePayload {
  return {
    subkind: 'pageerror',
    message,
    stack: typeof stack === 'string' && stack !== '' ? stack.slice(0, STACK_CAP) : undefined,
  };
}

/** Narrow a CDP Log.entryAdded event into the capture payload (null when not entry-shaped). */
export function buildBrowserLogPayload(event: unknown): BrowserLogCapturePayload | null {
  if (typeof event !== 'object' || event === null) return null;
  const entry = (event as { entry?: unknown }).entry;
  if (typeof entry !== 'object' || entry === null) return null;
  const record = entry as Record<string, unknown>;
  if (typeof record['text'] !== 'string' || typeof record['level'] !== 'string' || typeof record['source'] !== 'string') {
    return null;
  }
  const payload: BrowserLogCapturePayload = {
    subkind: 'browser-log',
    source: record['source'],
    level: record['level'],
    text: record['text'],
  };
  if (typeof record['url'] === 'string') payload.url = record['url'];
  if (typeof record['lineNumber'] === 'number') payload.line = record['lineNumber'];
  return payload;
}

/**
 * Converts an arbitrary page-side console argument into canonical-JSON-safe
 * data. Lossy BY DESIGN and documented: `undefined` → null (JSON has no
 * undefined), non-finite numbers → their string spellings, bigint/symbol →
 * string form, functions → '[Function]', Dates → ISO strings, class
 * instances → '[unserializable]'. Cycles are broken by the caller dropping
 * to '[unserializable]' — Playwright's jsonValue() never produces cycles.
 */
export function sanitizeConsoleArg(value: unknown): unknown {
  if (value === null) return null;
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return value;
    case 'number':
      return Number.isFinite(value) ? value : String(value);
    case 'bigint':
      return value.toString();
    case 'symbol':
      return value.toString();
    case 'undefined':
      return null;
    case 'function':
      return '[Function]';
    case 'object':
      break;
    default:
      return '[unserializable]';
  }

  if (Array.isArray(value)) {
    return value.map((element) => sanitizeConsoleArg(element));
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? '[Invalid Date]' : value.toISOString();
  }
  if (!isPlainObject(value)) {
    return '[unserializable]';
  }
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    out[key] = sanitizeConsoleArg(value[key]);
  }
  return out;
}

export interface RuntimeLogSummary {
  total: number;
  consoleRecords: number;
  pageErrors: number;
  browserLogs: number;
  /** console records at error/assert level */
  errorLevelCount: number;
  byLevel: Record<string, number>;
}

/** Deterministic reducer over runtime payloads (counts by level/subkind). */
export function reduceRuntimeLog(payloads: readonly RuntimeCapturePayload[]): RuntimeLogSummary {
  const summary: RuntimeLogSummary = {
    total: payloads.length,
    consoleRecords: 0,
    pageErrors: 0,
    browserLogs: 0,
    errorLevelCount: 0,
    byLevel: {},
  };
  for (const payload of payloads) {
    if (payload.subkind === 'console') {
      summary.consoleRecords++;
      summary.byLevel[payload.level] = (summary.byLevel[payload.level] ?? 0) + 1;
      if (payload.level === 'error' || payload.level === 'assert') summary.errorLevelCount++;
    } else if (payload.subkind === 'pageerror') {
      summary.pageErrors++;
    } else {
      summary.browserLogs++;
    }
  }
  return summary;
}
