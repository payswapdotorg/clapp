/**
 * @clapp/extract — API operations extractor.
 *
 * HTTP: request/response records are matched by (url, method). A key with
 * BOTH a request and a response yields ONE IrApiOperation (provenance
 * 'derived'); request-only, response-only, or failed keys still yield an
 * operation, but with replayability 'unreproducible' and provenance level
 * 'unavailable' standing for the missing schema parts (the observed side
 * is still cited). Multiple observations of the same key collapse into the
 * one operation (observedExamples accumulates every ref).
 *
 *   - urlPattern: the request path with id-shaped segments (all-digit or
 *     uuid) parameterized to ':id', query stripped (url-pattern.ts);
 *   - schema descriptors: v0 compact structural sketches of postData /
 *     bodyPreview (schema-sketch.ts); non-JSON bodies degrade to ABSENT
 *     schema + warning + assumption (truncated previews included);
 *   - errorSchema: sketched from the first >= 400 response's bodyPreview;
 *   - headersNeeded / authDependency: header NAMES only (never values) —
 *     'authorization'/'cookie' are the only names claimed, because those
 *     are the ones whose absence plausibly fails the call;
 *   - replayability: safe methods (GET/HEAD/OPTIONS) paired → 'replayable';
 *     mutating methods paired → 'side-effects' (conservative: server
 *     mutations on replay cannot be excluded from evidence); unpaired →
 *     'unreproducible'. Documented as labeling POLICY, not observation.
 *
 * WebSocket: ws-frame records are grouped by URL into transport
 * 'websocket' operations (no method); sent frames sketch the request
 * schema, received frames the response schema; both directions observed →
 * 'derived' with 'replayable' at reduced confidence (single-exchange
 * determinism is unverified); one direction only → 'unavailable' +
 * 'unreproducible'.
 */

import type { EvidenceRef } from '@clapp/core';
import type { IrApiOperation, Provenance, Replayability } from './ir-contract';
import type { AssumptionCollector } from './assumptions';
import type {
  ConsumedCapture,
  NetworkRequestCapture,
  NetworkRequestFailedCapture,
  NetworkResponseCapture,
  WebSocketFrameCapture,
} from './capture-reader';
import { newOperationId } from './ids';
import { sketchJsonText } from './schema-sketch';
import { urlPatternFrom } from './url-pattern';

export interface ApiExtraction {
  operations: IrApiOperation[];
  warnings: string[];
}

const SAFE_METHODS = new Set(['get', 'head', 'options']);

interface HttpGroup {
  key: string;
  method: string;
  url: string;
  requests: NetworkRequestCapture[];
  responses: NetworkResponseCapture[];
  failures: NetworkRequestFailedCapture[];
}

interface WsGroup {
  url: string;
  sent: WebSocketFrameCapture[];
  received: WebSocketFrameCapture[];
}

export function extractApiOperations(
  captures: readonly ConsumedCapture[],
  collector: AssumptionCollector,
): ApiExtraction {
  const warnings: string[] = [];
  const httpGroups = new Map<string, HttpGroup>();
  const wsGroups = new Map<string, WsGroup>();
  const httpOrder: string[] = [];
  const wsOrder: string[] = [];

  const httpGroupFor = (url: string, method: string): HttpGroup => {
    const key = `${method} ${url}`;
    let group = httpGroups.get(key);
    if (group === undefined) {
      group = { key, method, url, requests: [], responses: [], failures: [] };
      httpGroups.set(key, group);
      httpOrder.push(key);
    }
    return group;
  };

  for (const capture of captures) {
    if (capture.kind !== 'network') continue;
    if (capture.subkind === 'request') {
      httpGroupFor(capture.payload.url, capture.payload.method).requests.push(capture);
    } else if (capture.subkind === 'response') {
      httpGroupFor(capture.payload.url, capture.payload.method).responses.push(capture);
    } else if (capture.subkind === 'requestfailed') {
      httpGroupFor(capture.payload.url, capture.payload.method).failures.push(capture);
    } else {
      let group = wsGroups.get(capture.payload.url);
      if (group === undefined) {
        group = { url: capture.payload.url, sent: [], received: [] };
        wsGroups.set(capture.payload.url, group);
        wsOrder.push(capture.payload.url);
      }
      if (capture.payload.direction === 'sent') {
        group.sent.push(capture);
      } else {
        group.received.push(capture);
      }
    }
  }

  const operations: IrApiOperation[] = [];
  for (const key of httpOrder) {
    const group = httpGroups.get(key)!;
    operations.push(buildHttpOperation(group, collector, warnings));
  }
  for (const url of wsOrder) {
    const group = wsGroups.get(url)!;
    operations.push(buildWsOperation(group, collector, warnings));
  }

  return { operations, warnings };
}

function buildHttpOperation(group: HttpGroup, collector: AssumptionCollector, warnings: string[]): IrApiOperation {
  const urlPattern = urlPatternFrom(group.url);
  const paired = group.requests.length > 0 && group.responses.length > 0;
  const exampleRefs: EvidenceRef[] = [...group.requests, ...group.responses, ...group.failures].map((capture) => ({
    ...capture.ref,
  }));

  const request = group.requests[0]?.payload;
  const headers = request?.headers ?? {};
  const headersNeeded: string[] = [];
  let authDependency: string | undefined;
  const headerNames = new Set(Object.keys(headers).map((name) => name.toLowerCase()));
  if (headerNames.has('authorization')) {
    headersNeeded.push('authorization');
    authDependency = 'authorization-header';
  }
  if (headerNames.has('cookie')) {
    headersNeeded.push('cookie');
    authDependency ??= 'session-cookie';
  }
  headersNeeded.sort();

  const requestSchema = sketchFromTexts(
    group.requests.map((capture) => capture.payload.postData),
    `request body for ${group.method} ${urlPattern}`,
    collector,
    warnings,
    group.requests[0]?.ref,
  );
  // responseSchema sketches the SUCCESS side (status < 400); the error side
  // gets its own descriptor below — conflating them would mislabel both.
  const successResponses = group.responses.filter((capture) => capture.payload.status < 400);
  const responseSchema = sketchFromTexts(
    successResponses.map((capture) => capture.payload.bodyPreview),
    `response body for ${group.method} ${urlPattern}`,
    collector,
    warnings,
    successResponses[0]?.ref,
  );
  const errorResponse = group.responses.find((capture) => capture.payload.status >= 400);
  const errorSchema = errorResponse === undefined
    ? undefined
    : sketchFromTexts(
      [errorResponse.payload.bodyPreview],
      `error body for ${group.method} ${urlPattern}`,
      collector,
      warnings,
      errorResponse.ref,
    );

  const isSafeMethod = SAFE_METHODS.has(group.method.toLowerCase());
  let replayability: Replayability;
  let provenance: Provenance;
  if (paired) {
    if (isSafeMethod) {
      replayability = 'replayable';
      provenance = {
        level: 'derived',
        confidence: {
          value: 0.9,
          rationale: 'request and response were both observed for this url+method, and the method is safe by HTTP semantics',
          evidenceRefs: exampleRefs,
        },
      };
    } else {
      replayability = 'side-effects';
      provenance = {
        level: 'derived',
        confidence: {
          value: 0.9,
          rationale: 'request and response were both observed, but a mutating method is conservatively labeled side-effects because server mutations on replay cannot be excluded from evidence',
          evidenceRefs: exampleRefs,
        },
      };
    }
  } else {
    replayability = 'unreproducible';
    const observedSide = group.responses.length > 0 ? 'response' : group.requests.length > 0 ? 'request' : 'failure';
    provenance = {
      level: 'unavailable',
      confidence: {
        value: 0.3,
        rationale: `only the ${observedSide} side of the exchange was observed, so the operation's external contract is incomplete`,
        evidenceRefs: exampleRefs,
      },
    };
  }

  return {
    id: newOperationId(),
    transport: 'http',
    method: group.method,
    urlPattern,
    ...(headersNeeded.length > 0 ? { headersNeeded } : {}),
    ...(requestSchema !== undefined ? { requestSchema } : {}),
    ...(responseSchema !== undefined ? { responseSchema } : {}),
    ...(errorSchema !== undefined ? { errorSchema } : {}),
    ...(authDependency !== undefined ? { authDependency } : {}),
    observedExamples: exampleRefs,
    replayability,
    externalSideEffects: [],
    provenance,
  };
}

function buildWsOperation(group: WsGroup, collector: AssumptionCollector, warnings: string[]): IrApiOperation {
  const urlPattern = urlPatternFrom(group.url);
  const exampleRefs: EvidenceRef[] = [...group.sent, ...group.received].map((capture) => ({ ...capture.ref }));
  const bothDirections = group.sent.length > 0 && group.received.length > 0;

  const requestSchema = sketchFromTexts(
    group.sent.map((capture) => capture.payload.payload),
    `sent websocket frames for ${urlPattern}`,
    collector,
    warnings,
    group.sent[0]?.ref,
  );
  const responseSchema = sketchFromTexts(
    group.received.map((capture) => capture.payload.payload),
    `received websocket frames for ${urlPattern}`,
    collector,
    warnings,
    group.received[0]?.ref,
  );

  const provenance: Provenance = bothDirections
    ? {
      level: 'derived',
      confidence: {
        value: 0.5,
        rationale: 'sent and received frames were both observed; replay determinism is unverified for a single exchange',
        evidenceRefs: exampleRefs,
      },
    }
    : {
      level: 'unavailable',
      confidence: {
        value: 0.3,
        rationale: `only ${group.sent.length > 0 ? 'sent' : 'received'} frames were observed, so the websocket exchange is incomplete`,
        evidenceRefs: exampleRefs,
      },
    };

  return {
    id: newOperationId(),
    transport: 'websocket',
    urlPattern,
    ...(requestSchema !== undefined ? { requestSchema } : {}),
    ...(responseSchema !== undefined ? { responseSchema } : {}),
    observedExamples: exampleRefs,
    replayability: bothDirections ? 'replayable' : 'unreproducible',
    externalSideEffects: [],
    provenance,
  };
}

/**
 * First JSON-parsable text wins; every present-but-unparsable text degrades
 * to an absent schema + warning + assumption whose reason distinguishes
 * truncation from invalid JSON. Absent/empty texts are NOT degradations
 * (a bodyless request legitimately has no schema).
 */
function sketchFromTexts(
  texts: Array<string | undefined>,
  label: string,
  collector: AssumptionCollector,
  warnings: string[],
  ref: EvidenceRef | undefined,
): unknown {
  for (const text of texts) {
    if (text === undefined || text === '') continue;
    const outcome = sketchJsonText(text);
    if (outcome.ok) {
      return outcome.sketch;
    }
    if (outcome.reason === 'truncated') {
      const statement = `the ${label} is truncated, so its schema cannot be sketched and stays unknown`;
      collector.note(statement, { confidence: 0.4, evidenceRefs: ref ? [ref] : [] });
      warnings.push(`${statement} (${describeRef(ref)})`);
      return undefined;
    }
    const statement = `the ${label} is not JSON, so its schema cannot be sketched and stays unknown`;
    collector.note(statement, { confidence: 0.3, evidenceRefs: ref ? [ref] : [] });
    warnings.push(`${statement} (${describeRef(ref)})`);
    return undefined;
  }
  return undefined;
}

function describeRef(ref: EvidenceRef | undefined): string {
  return ref === undefined ? 'no evidence ref' : ref.evidenceId;
}
