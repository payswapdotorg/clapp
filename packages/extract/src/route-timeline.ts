/**
 * @clapp/extract — route timeline: document-request order → route runs.
 *
 * Observation runs record in script order: a 'navigate' step issues a
 * DOCUMENT request (network.request, resourceType 'document') and the
 * dom-tree captures that follow belong to that route until the next
 * document request. This module renders that discipline:
 *
 *   - {@link buildRouteTimeline} extracts the ordered document-request
 *     events (with their normalized routes) from the consumed captures;
 *   - {@link RouteTimeline.routeAt} answers "which route was current when
 *     capture N was recorded" (most recent document request at or before
 *     that capture's index);
 *   - {@link RouteTimeline.runs} groups consecutive same-route document
 *     requests into runs — the consecutive-DISTINCT route sequence the
 *     transitions extractor turns into navigation transitions.
 */

import { normalizeRoute } from './url-pattern';
import type { ConsumedCapture, NetworkRequestCapture } from './capture-reader';

export interface RouteEvent {
  /** index of the document-request capture in the consumed-capture sequence. */
  index: number;
  /** normalized route (path, query/fragment stripped, trailing-slash-insensitive). */
  route: string;
  /** the full observed request URL (input payload evidence for transitions). */
  url: string;
  request: NetworkRequestCapture;
}

/** A maximal run of consecutive document requests to the same route. */
export interface RouteRun {
  route: string;
  /** requests in this run, in order. */
  requests: RouteEvent[];
}

export interface RouteTimeline {
  /** every document-request event, in capture order. */
  events: RouteEvent[];
  /** consecutive same-route groupings, in order. */
  runs: RouteRun[];
  /** the route current at capture index i (null before the first document request). */
  routeAt(index: number): RouteEvent | null;
}

export function isDocumentRequest(capture: ConsumedCapture): capture is NetworkRequestCapture {
  return capture.subkind === 'request' && capture.payload.resourceType === 'document';
}

export function buildRouteTimeline(captures: readonly ConsumedCapture[]): RouteTimeline {
  const events: RouteEvent[] = [];
  const runs: RouteRun[] = [];
  for (const capture of captures) {
    if (!isDocumentRequest(capture)) continue;
    const event: RouteEvent = {
      index: capture.index,
      route: normalizeRoute(capture.payload.url),
      url: capture.payload.url,
      request: capture,
    };
    events.push(event);
    const lastRun = runs[runs.length - 1];
    if (lastRun !== undefined && lastRun.route === event.route) {
      lastRun.requests.push(event);
    } else {
      runs.push({ route: event.route, requests: [event] });
    }
  }

  // routeAt is a hot lookup during extraction: precompute an aligned array
  // (captures are indexed 0..n-1; fills are monotonic while walking).
  const aligned: Array<RouteEvent | null> = new Array(captures.length).fill(null);
  let eventPosition = 0;
  let current: RouteEvent | null = null;
  for (let i = 0; i < captures.length; i++) {
    while (eventPosition < events.length && events[eventPosition]!.index <= i) {
      current = events[eventPosition]!;
      eventPosition++;
    }
    aligned[i] = current;
  }

  return {
    events,
    runs,
    routeAt: (index: number): RouteEvent | null => aligned[index] ?? null,
  };
}
