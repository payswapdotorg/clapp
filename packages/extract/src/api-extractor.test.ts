// CLAPP-021 unit — API operations extractor: pair matching, url
// parameterization, schema sketches, ws operations, honest degradation.

import { describe, expect, test } from 'bun:test';
import {
  SynthClock,
  requestCapture,
  requestFailedCapture,
  responseCapture,
  extractFromSynth,
  synthBundle,
  wsFrameCapture,
} from './test-utils';

const clock = new SynthClock();

describe('api-extractor — request/response pair matching', () => {
  test('same url+method with request and response → one derived operation', async () => {
    const synth = await synthBundle([
      requestCapture('http://synth.test/api/user', 'GET', clock.next()),
      responseCapture('http://synth.test/api/user', 'GET', 200, clock.next(), { bodyPreview: '{"name":"Ada","age":42}' }),
    ]);
    const { model, stats } = await extractFromSynth(synth);
    expect(stats.operationsEmitted).toBe(1);
    const operation = model.api.operations[0]!;
    expect(operation.transport).toBe('http');
    expect(operation.method).toBe('GET');
    expect(operation.urlPattern).toBe('/api/user');
    expect(operation.replayability).toBe('replayable');
    expect(operation.provenance.level).toBe('derived');
    expect(operation.provenance.confidence.evidenceRefs.length).toBe(2);
    expect(operation.observedExamples.length).toBe(2);
    expect(operation.requestSchema).toBeUndefined(); // bodyless GET: no schema, no degradation
    expect(operation.responseSchema).toEqual({
      type: 'object',
      keys: ['age', 'name'],
      valueTypes: { age: 'number', name: 'string' },
    });
    expect(operation.externalSideEffects).toEqual([]);
  });

  test('two pairs with the same url+method collapse into ONE operation (4 example refs)', async () => {
    const synth = await synthBundle([
      requestCapture('http://synth.test/api/user', 'GET', clock.next()),
      responseCapture('http://synth.test/api/user', 'GET', 200, clock.next(), { bodyPreview: '{"n":1}' }),
      requestCapture('http://synth.test/api/user', 'GET', clock.next()),
      responseCapture('http://synth.test/api/user', 'GET', 200, clock.next(), { bodyPreview: '{"n":1}' }),
    ]);
    const { model, stats } = await extractFromSynth(synth);
    expect(stats.operationsEmitted).toBe(1);
    expect(model.api.operations[0]!.observedExamples.length).toBe(4);
  });

  test('request-only → unreproducible + unavailable level, no response schema', async () => {
    const synth = await synthBundle([requestCapture('http://synth.test/api/items', 'GET', clock.next())]);
    const { model } = await extractFromSynth(synth);
    const operation = model.api.operations[0]!;
    expect(operation.replayability).toBe('unreproducible');
    expect(operation.provenance.level).toBe('unavailable');
    expect(operation.responseSchema).toBeUndefined();
    expect(operation.provenance.confidence.evidenceRefs.length).toBe(1);
  });

  test('failed request → unreproducible + unavailable level, errorText never fatal', async () => {
    const synth = await synthBundle([
      requestCapture('http://synth.test/api/broken', 'POST', clock.next(), { postData: '{"a":1}' }),
      requestFailedCapture('http://synth.test/api/broken', 'POST', clock.next()),
    ]);
    const { model } = await extractFromSynth(synth);
    const operation = model.api.operations[0]!;
    expect(operation.replayability).toBe('unreproducible');
    expect(operation.provenance.level).toBe('unavailable');
    expect(operation.observedExamples.length).toBe(2);
    expect(operation.requestSchema).toEqual({ type: 'object', keys: ['a'], valueTypes: { a: 'number' } });
  });

  test('paired mutating method is conservatively labeled side-effects', async () => {
    const synth = await synthBundle([
      requestCapture('http://synth.test/api/cart', 'POST', clock.next(), { postData: '{"itemId":"x1"}' }),
      responseCapture('http://synth.test/api/cart', 'POST', 201, clock.next(), { bodyPreview: '{"ok":true}' }),
    ]);
    const { model } = await extractFromSynth(synth);
    const operation = model.api.operations[0]!;
    expect(operation.replayability).toBe('side-effects');
    expect(operation.provenance.level).toBe('derived');
    expect(operation.provenance.confidence.rationale).toContain('conservatively');
  });

  test('operations are emitted in first-request order', async () => {
    const synth = await synthBundle([
      requestCapture('http://synth.test/api/b', 'GET', clock.next()),
      responseCapture('http://synth.test/api/b', 'GET', 200, clock.next()),
      requestCapture('http://synth.test/api/a', 'GET', clock.next()),
      responseCapture('http://synth.test/api/a', 'GET', 200, clock.next()),
      requestCapture('http://synth.test/api/c', 'GET', clock.next()),
    ]);
    const { model } = await extractFromSynth(synth);
    expect(model.api.operations.map((operation) => operation.urlPattern)).toEqual(['/api/b', '/api/a', '/api/c']);
  });
});

describe('api-extractor — urlPattern parameterization', () => {
  test('all-digit and uuid segments become :id; query is stripped', async () => {
    const synth = await synthBundle([
      requestCapture('http://synth.test/api/items/12345?verbose=1', 'GET', clock.next()),
      responseCapture('http://synth.test/api/items/12345?verbose=1', 'GET', 200, clock.next()),
      requestCapture('http://synth.test/api/users/6f9619ff-8b86-d011-b42d-00c04fc964ff/items', 'GET', clock.next()),
      responseCapture('http://synth.test/api/users/6f9619ff-8b86-d011-b42d-00c04fc964ff/items', 'GET', 200, clock.next()),
      requestCapture('http://synth.test/api/items/pricing', 'GET', clock.next()),
      responseCapture('http://synth.test/api/items/pricing', 'GET', 200, clock.next()),
    ]);
    const { model } = await extractFromSynth(synth);
    expect(model.api.operations.map((operation) => operation.urlPattern)).toEqual([
      '/api/items/:id',
      '/api/users/:id/items',
      '/api/items/pricing',
    ]);
  });
});

describe('api-extractor — schemas degrade honestly', () => {
  test('non-JSON postData → absent requestSchema + warning + assumption (confidence <= 0.5)', async () => {
    const synth = await synthBundle([
      requestCapture('http://synth.test/api/echo', 'POST', clock.next(), { postData: 'not json at all' }),
      responseCapture('http://synth.test/api/echo', 'POST', 200, clock.next(), { bodyPreview: 'plain text' }),
    ]);
    const { model, warnings } = await extractFromSynth(synth);
    const assumptions = model.assumptions;
    const operation = model.api.operations[0]!;
    expect(operation.requestSchema).toBeUndefined();
    expect(operation.responseSchema).toBeUndefined();
    expect(warnings.some((warning) => warning.includes('request body for POST /api/echo is not JSON'))).toBe(true);
    expect(warnings.some((warning) => warning.includes('response body for POST /api/echo is not JSON'))).toBe(true);
    expect(assumptions.length).toBe(2);
    for (const assumption of assumptions) {
      expect(assumption.provenance.level).toBe('assumed');
      expect(assumption.provenance.confidence.value).toBeLessThanOrEqual(0.5);
      expect(assumption.provenance.confidence.evidenceRefs.length).toBe(1);
    }
  });

  test('truncated preview → assumption mentioning truncation', async () => {
    const synth = await synthBundle([
      requestCapture('http://synth.test/api/big', 'POST', clock.next(), {
        postData: '{"a":"aaaa…[truncated 100 chars]',
      }),
      responseCapture('http://synth.test/api/big', 'POST', 200, clock.next()),
    ]);
    const result = await extractFromSynth(synth);
    expect(result.model.api.operations[0]!.requestSchema).toBeUndefined();
    const truncatedAssumption = result.model.assumptions.find((assumption) => assumption.statement.includes('is truncated'));
    expect(truncatedAssumption).toBeDefined();
    expect(truncatedAssumption!.statement).toContain('request body for POST /api/big');
  });

  test('bodyless requests have NO schema and NO degradation noise', async () => {
    const synth = await synthBundle([
      requestCapture('http://synth.test/api/things', 'GET', clock.next()),
      responseCapture('http://synth.test/api/things', 'GET', 200, clock.next(), { bodyPreview: '[]' }),
    ]);
    const { model, warnings, model: { assumptions } } = await extractFromSynth(synth);
    expect(model.api.operations[0]!.requestSchema).toBeUndefined();
    expect(warnings.filter((warning) => warning.includes('schema')).length).toBe(0);
    expect(assumptions.length).toBe(0);
    expect(model.api.operations[0]!.responseSchema).toEqual({ type: 'array' });
  });

  test('errorSchema sketches the first >= 400 response body', async () => {
    const synth = await synthBundle([
      requestCapture('http://synth.test/api/flaky', 'GET', clock.next()),
      responseCapture('http://synth.test/api/flaky', 'GET', 503, clock.next(), { bodyPreview: '{"error":"unavailable"}' }),
      responseCapture('http://synth.test/api/flaky', 'GET', 200, clock.next(), { bodyPreview: '{"data":[]}' }),
    ]);
    const { model } = await extractFromSynth(synth);
    const operation = model.api.operations[0]!;
    expect(operation.errorSchema).toEqual({ type: 'object', keys: ['error'], valueTypes: { error: 'string' } });
    expect(operation.responseSchema).toEqual({ type: 'object', keys: ['data'], valueTypes: { data: 'array' } });
    expect(operation.observedExamples.length).toBe(3);
  });
});

describe('api-extractor — auth headers (names only, never values)', () => {
  test('authorization and cookie header names are surfaced; values never enter the model', async () => {
    const synth = await synthBundle([
      requestCapture('http://synth.test/api/secure', 'GET', clock.next(), {
        headers: { authorization: 'Bearer secret-token-value', cookie: 'session=abc123', accept: 'application/json' },
      }),
      responseCapture('http://synth.test/api/secure', 'GET', 200, clock.next()),
    ]);
    const { model } = await extractFromSynth(synth);
    const operation = model.api.operations[0]!;
    expect(operation.headersNeeded).toEqual(['authorization', 'cookie']);
    expect(operation.authDependency).toBe('authorization-header');
    const serialized = JSON.stringify(model);
    expect(serialized.includes('secret-token-value')).toBe(false);
    expect(serialized.includes('abc123')).toBe(false);
    expect(serialized.includes('application/json')).toBe(false); // non-auth header names are not claimed as needed
  });
});

describe('api-extractor — websocket operations', () => {
  test('ws frames both directions → transport websocket, no method, sketches both sides', async () => {
    const synth = await synthBundle([
      wsFrameCapture('ws://synth.test/socket?token=1', 'sent', '{"type":"ping"}', clock.next()),
      wsFrameCapture('ws://synth.test/socket?token=1', 'received', '{"type":"pong"}', clock.next()),
    ]);
    const { model, stats } = await extractFromSynth(synth);
    expect(stats.operationsEmitted).toBe(1);
    const operation = model.api.operations[0]!;
    expect(operation.transport).toBe('websocket');
    expect(operation.method).toBeUndefined();
    expect(operation.urlPattern).toBe('/socket');
    expect(operation.requestSchema).toEqual({ type: 'object', keys: ['type'], valueTypes: { type: 'string' } });
    expect(operation.responseSchema).toEqual({ type: 'object', keys: ['type'], valueTypes: { type: 'string' } });
    expect(operation.replayability).toBe('replayable');
    expect(operation.provenance.level).toBe('derived');
    expect(operation.provenance.confidence.value).toBe(0.5);
    expect(operation.observedExamples.length).toBe(2);
  });

  test('sent-only frames → incomplete exchange: unavailable + unreproducible', async () => {
    const synth = await synthBundle([wsFrameCapture('ws://synth.test/socket', 'sent', 'ping', clock.next())]);
    const { model } = await extractFromSynth(synth);
    const operation = model.api.operations[0]!;
    expect(operation.provenance.level).toBe('unavailable');
    expect(operation.replayability).toBe('unreproducible');
    expect(operation.responseSchema).toBeUndefined();
    expect(operation.requestSchema).toBeUndefined(); // 'ping' is not JSON
  });
});
