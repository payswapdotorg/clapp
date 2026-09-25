/**
 * @clapp/observe — network log channel: requests, responses, failures,
 * WebSocket frames.
 *
 * Determinism model (critical for replay): request records are emitted at
 * EVENT time (initiation order — deterministic for a deterministic app),
 * while response/failure records are DRAINED at settlement points in
 * REQUEST-INITIATION order. Live response arrival order can jitter
 * (parallel fetches), so draining batches it deterministically. NO timing
 * data is captured (timings always differ); bodies are opt-in,
 * size-capped, text-only previews.
 *
 * Redaction is NOT applied here — SessionCore applies the policy
 * centrally before records are enqueued (headers/postData/previews all
 * flow through it). Truncation caps below bound record size.
 */

export const MAX_POSTDATA_CHARS = 2048;
export const MAX_BODY_PREVIEW_CHARS = 512;
export const MAX_WS_PREVIEW_CHARS = 256;
/** Response bodies are only previewed up to this many bytes. */
export const MAX_BODY_BYTES = 2048;

/**
 * Per-response timestamp headers, stripped from network records: they are
 * server-generated CLOCKS (new value every response), so keeping them would
 * break the "identical sequences modulo timestamps" replay contract. This
 * is the complete volatile-header list — everything else is recorded.
 */
export const VOLATILE_HEADERS: readonly string[] = ['date', 'age'];

export interface NetworkRequestPayload {
  subkind: 'request';
  url: string;
  method: string;
  resourceType: string;
  headers: Record<string, string>;
  postData?: string;
}

export interface NetworkResponsePayload {
  subkind: 'response';
  url: string;
  method: string;
  status: number;
  statusText?: string;
  resourceType: string;
  headers: Record<string, string>;
  mimeType?: string;
  bodyPreview?: string;
  fromServiceWorker?: boolean;
  sizeBytes?: number;
}

export interface NetworkRequestFailedPayload {
  subkind: 'requestfailed';
  url: string;
  method: string;
  resourceType?: string;
  errorText?: string;
}

export interface WebSocketFramePayload {
  subkind: 'ws-frame';
  url: string;
  direction: 'sent' | 'received';
  /** lossy UTF-8 decode of the frame payload, truncated */
  payload: string;
  byteLength: number;
  isBinary: boolean;
}

export type NetworkCapturePayload =
  | NetworkRequestPayload
  | NetworkResponsePayload
  | NetworkRequestFailedPayload
  | WebSocketFramePayload;

/** Truncate with an honest marker so consumers can tell a cut happened. */
export function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}…[truncated ${text.length - maxChars} chars]`;
}

export function buildRequestPayload(input: {
  url: string;
  method: string;
  resourceType: string;
  headers: Record<string, string>;
  postData?: string | null;
}): NetworkRequestPayload {
  const payload: NetworkRequestPayload = {
    subkind: 'request',
    url: input.url,
    method: input.method,
    resourceType: input.resourceType,
    headers: stripVolatileHeaders(input.headers),
  };
  if (typeof input.postData === 'string' && input.postData !== '') {
    payload.postData = truncateText(input.postData, MAX_POSTDATA_CHARS);
  }
  return payload;
}

export function buildResponsePayload(input: {
  url: string;
  method: string;
  resourceType: string;
  status: number;
  statusText?: string;
  headers: Record<string, string>;
  mimeType?: string;
  bodyPreview?: string;
  fromServiceWorker?: boolean;
  sizeBytes?: number;
}): NetworkResponsePayload {
  const payload: NetworkResponsePayload = {
    subkind: 'response',
    url: input.url,
    method: input.method,
    status: input.status,
    statusText: input.statusText === '' ? undefined : input.statusText,
    resourceType: input.resourceType,
    headers: stripVolatileHeaders(input.headers),
    mimeType: input.mimeType,
    bodyPreview: input.bodyPreview === undefined ? undefined : truncateText(input.bodyPreview, MAX_BODY_PREVIEW_CHARS),
    fromServiceWorker: input.fromServiceWorker === true ? true : undefined,
    sizeBytes: input.sizeBytes,
  };
  return payload;
}

function stripVolatileHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of Object.keys(headers)) {
    if (VOLATILE_HEADERS.includes(name.toLowerCase())) continue;
    out[name] = headers[name]!;
  }
  return out;
}

export function buildRequestFailedPayload(input: {
  url: string;
  method: string;
  resourceType?: string;
  errorText?: string;
}): NetworkRequestFailedPayload {
  return {
    subkind: 'requestfailed',
    url: input.url,
    method: input.method,
    resourceType: input.resourceType,
    errorText: input.errorText,
  };
}

const lossyUtf8 = new TextDecoder('utf-8', { fatal: false });

/** WS frame payload → lossy string preview + byte length + binary flag. */
export function buildWsFramePayload(url: string, direction: 'sent' | 'received', framePayload: string | Uint8Array): WebSocketFramePayload {
  const isBinary = typeof framePayload !== 'string';
  const text = isBinary ? lossyUtf8.decode(framePayload as Uint8Array) : (framePayload as string);
  const byteLength = isBinary ? (framePayload as Uint8Array).byteLength : new TextEncoder().encode(framePayload as string).byteLength;
  return {
    subkind: 'ws-frame',
    url,
    direction,
    payload: truncateText(text, MAX_WS_PREVIEW_CHARS),
    byteLength,
    isBinary,
  };
}

export interface NetworkLogSummary {
  requests: number;
  responses: number;
  failed: number;
  wsFrames: number;
  wsFramesSent: number;
  wsFramesReceived: number;
  byResourceType: Record<string, number>;
  /** sorted unique URLs seen in request records */
  urls: string[];
}

/** Deterministic reducer over network payloads. */
export function reduceNetworkLog(payloads: readonly NetworkCapturePayload[]): NetworkLogSummary {
  const summary: NetworkLogSummary = {
    requests: 0,
    responses: 0,
    failed: 0,
    wsFrames: 0,
    wsFramesSent: 0,
    wsFramesReceived: 0,
    byResourceType: {},
    urls: [],
  };
  const urlSet = new Set<string>();
  for (const payload of payloads) {
    switch (payload.subkind) {
      case 'request':
        summary.requests++;
        summary.byResourceType[payload.resourceType] = (summary.byResourceType[payload.resourceType] ?? 0) + 1;
        urlSet.add(payload.url);
        break;
      case 'response':
        summary.responses++;
        break;
      case 'requestfailed':
        summary.failed++;
        break;
      case 'ws-frame':
        summary.wsFrames++;
        if (payload.direction === 'sent') summary.wsFramesSent++;
        else summary.wsFramesReceived++;
        break;
    }
  }
  summary.urls = [...urlSet].sort();
  return summary;
}
