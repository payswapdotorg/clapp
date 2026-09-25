// CLAPP-010 unit tests — network log channel (request/response/failure/WS).

import { describe, expect, test } from 'bun:test';
import {
  buildRequestFailedPayload,
  buildRequestPayload,
  buildResponsePayload,
  buildWsFramePayload,
  reduceNetworkLog,
  truncateText,
  type NetworkCapturePayload,
} from './network';

describe('payload builders', () => {
  test('request payload: postData included only when present', () => {
    expect(
      buildRequestPayload({ url: 'http://x/api', method: 'POST', resourceType: 'fetch', headers: {}, postData: 'a=1' }),
    ).toEqual({ subkind: 'request', url: 'http://x/api', method: 'POST', resourceType: 'fetch', headers: {}, postData: 'a=1' });
    const without = buildRequestPayload({ url: 'http://x/', method: 'GET', resourceType: 'document', headers: {}, postData: null });
    expect(without.postData).toBeUndefined();
  });

  test('response payload: empty statusText pruned, preview truncated, flags only when true', () => {
    const payload = buildResponsePayload({
      url: 'http://x/',
      method: 'GET',
      resourceType: 'document',
      status: 200,
      statusText: '',
      headers: { 'content-type': 'text/html' },
      mimeType: 'text/html',
      bodyPreview: 'x'.repeat(600),
      fromServiceWorker: false,
      sizeBytes: 1234,
    });
    expect(payload.statusText).toBeUndefined();
    expect(payload.fromServiceWorker).toBeUndefined();
    expect(payload.bodyPreview?.startsWith('xxxx')).toBe(true);
    expect(payload.bodyPreview?.length).toBeLessThanOrEqual(512 + 40); // cap + truncation marker
    expect(payload.sizeBytes).toBe(1234);
  });

  test('volatile per-response timestamp headers (date, age) are stripped for replay determinism', () => {
    const payload = buildResponsePayload({
      url: 'http://x/',
      method: 'GET',
      resourceType: 'document',
      status: 200,
      headers: { 'content-type': 'text/html', date: 'Fri, 25 Sep 2026 05:19:54 GMT', AGE: '17', 'x-stable': 'yes' },
    });
    expect(payload.headers).toEqual({ 'content-type': 'text/html', 'x-stable': 'yes' });
    const request = buildRequestPayload({
      url: 'http://x/',
      method: 'GET',
      resourceType: 'document',
      headers: { date: 'zzz', accept: 'text/html' },
    });
    expect(request.headers).toEqual({ accept: 'text/html' });
  });

  test('requestfailed payload shape', () => {
    expect(buildRequestFailedPayload({ url: 'http://x/', method: 'GET', resourceType: 'xhr', errorText: 'net::ERR_FAILED' })).toEqual({
      subkind: 'requestfailed',
      url: 'http://x/',
      method: 'GET',
      resourceType: 'xhr',
      errorText: 'net::ERR_FAILED',
    });
  });

  test('ws frame payload: text and binary variants', () => {
    const text = buildWsFramePayload('ws://x/ws', 'sent', 'ping-from-fixture');
    expect(text).toEqual({ subkind: 'ws-frame', url: 'ws://x/ws', direction: 'sent', payload: 'ping-from-fixture', byteLength: 17, isBinary: false });
    const binary = buildWsFramePayload('ws://x/ws', 'received', new Uint8Array([1, 2, 3]));
    expect(binary.isBinary).toBe(true);
    expect(binary.byteLength).toBe(3);
  });
});

describe('truncateText', () => {
  test('short strings pass through; long strings carry a truncation marker', () => {
    expect(truncateText('short', 100)).toBe('short');
    const cut = truncateText('a'.repeat(300), 100);
    expect(cut.startsWith('a'.repeat(100))).toBe(true);
    expect(cut).toContain('truncated 200 chars');
  });
});

describe('reduceNetworkLog', () => {
  test('counts phases, resource types, ws directions; urls sorted unique', () => {
    const payloads: NetworkCapturePayload[] = [
      { subkind: 'request', url: 'http://x/b', method: 'GET', resourceType: 'document', headers: {} },
      { subkind: 'request', url: 'http://x/a', method: 'GET', resourceType: 'stylesheet', headers: {} },
      { subkind: 'request', url: 'http://x/b', method: 'GET', resourceType: 'document', headers: {} },
      { subkind: 'response', url: 'http://x/b', method: 'GET', status: 200, resourceType: 'document', headers: {} },
      { subkind: 'requestfailed', url: 'http://x/c', method: 'GET', errorText: 'boom' },
      { subkind: 'ws-frame', url: 'ws://x/ws', direction: 'sent', payload: 'p', byteLength: 1, isBinary: false },
      { subkind: 'ws-frame', url: 'ws://x/ws', direction: 'received', payload: 'e:p', byteLength: 3, isBinary: false },
    ];
    const summary = reduceNetworkLog(payloads);
    expect(summary.requests).toBe(3);
    expect(summary.responses).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.wsFrames).toBe(2);
    expect(summary.wsFramesSent).toBe(1);
    expect(summary.wsFramesReceived).toBe(1);
    expect(summary.byResourceType['document']).toBe(2);
    expect(summary.urls).toEqual(['http://x/a', 'http://x/b']);
  });

  test('empty input is all zeros', () => {
    const summary = reduceNetworkLog([]);
    expect(summary.requests).toBe(0);
    expect(summary.responses).toBe(0);
    expect(summary.urls).toEqual([]);
  });
});
