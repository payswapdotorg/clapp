/**
 * @clapp/extract — transitions extractor.
 *
 * Consecutive DISTINCT routes in document order become IrTransition
 * entries: trigger {type 'action', action 'navigate'}, provenance
 * 'derived', evidenceRefs = the document requests + the dom captures on
 * both sides. Same-route captures never produce a transition (the route
 * runs are consecutive-distinct grouped — see route-timeline.ts).
 *
 * A navigation between routes where one side has NO screen (no dom capture
 * was recorded for that route) is SKIPPED with a warning: the transition
 * would reference a nonexistent state node, and inventing a screen without
 * DOM evidence is exactly the silent guesswork this package refuses.
 *
 * This is the honest ceiling of pure-evidence extraction: observation runs
 * record NO captures for action steps, so action-level transitions (click,
 * submit, ...) are simply not derivable here — that is exploration's job
 * (CLAPP-022), and the model carries the gap as a constraint string.
 *
 * input: { url } — the observed target URL of the navigation (the document
 * request that initiated it). outputs: the paired document response's
 * { status, mimeType } when one was recorded. sideEffects: [] (nothing
 * about side effects is observable from passive evidence).
 */

import type { EvidenceRef } from '@clapp/core';
import type { IrTransition, Provenance } from './ir-contract';
import type { ConsumedCapture, NetworkResponseCapture } from './capture-reader';
import { newTransitionId } from './ids';
import type { RouteRun, RouteTimeline } from './route-timeline';
import type { ScreenRecord } from './screens-extractor';

export interface TransitionsExtraction {
  transitions: IrTransition[];
  warnings: string[];
}

export function extractTransitions(
  captures: readonly ConsumedCapture[],
  timeline: RouteTimeline,
  recordsByRoute: ReadonlyMap<string, ScreenRecord>,
): TransitionsExtraction {
  const warnings: string[] = [];
  const transitions: IrTransition[] = [];

  for (let i = 0; i + 1 < timeline.runs.length; i++) {
    const fromRun = timeline.runs[i]!;
    const toRun = timeline.runs[i + 1]!;
    const fromRecord = recordsByRoute.get(fromRun.route);
    const toRecord = recordsByRoute.get(toRun.route);
    if (fromRecord === undefined || toRecord === undefined) {
      const missing = fromRecord === undefined ? fromRun.route : toRun.route;
      warnings.push(`navigation transition ${fromRun.route} -> ${toRun.route} not emitted: no screen for route ${missing} (no dom capture was recorded for it)`);
      continue;
    }
    transitions.push(buildTransition(fromRun, toRun, fromRecord, toRecord, captures));
  }

  return { transitions, warnings };
}

function buildTransition(
  fromRun: RouteRun,
  toRun: RouteRun,
  fromRecord: ScreenRecord,
  toRecord: ScreenRecord,
  captures: readonly ConsumedCapture[],
): IrTransition {
  // Document requests on both sides: the most recent request that observed
  // the from-route (state_before) and the request that navigated to the
  // to-route (the transition cause).
  const fromRequest = fromRun.requests[fromRun.requests.length - 1]!;
  const toRequest = toRun.requests[0]!;

  const evidenceRefs: EvidenceRef[] = [];
  const upsert = (ref: EvidenceRef): void => {
    if (!evidenceRefs.some((existing) => existing.evidenceId === ref.evidenceId)) {
      evidenceRefs.push({ ...ref });
    }
  };
  upsert(fromRequest.request.ref);
  upsert(toRequest.request.ref);
  for (const domRef of fromRecord.domRefs) upsert(domRef);
  for (const domRef of toRecord.domRefs) upsert(domRef);

  const documentResponse = findPairedResponse(toRequest.url, toRequest.request.payload.method, captures);
  const outputs: unknown[] | undefined = documentResponse === undefined
    ? undefined
    : [outputFromResponse(documentResponse)];

  const provenance: Provenance = {
    level: 'derived',
    confidence: {
      value: 0.85,
      rationale: 'navigation between distinct document routes observed in event order',
      evidenceRefs,
    },
  };

  return {
    id: newTransitionId(),
    fromScreenId: fromRecord.screen.id,
    toScreenId: toRecord.screen.id,
    trigger: { type: 'action', action: 'navigate' },
    input: { url: toRequest.url },
    ...(outputs !== undefined ? { outputs } : {}),
    sideEffects: [],
    provenance,
  };
}

function findPairedResponse(url: string, method: string, captures: readonly ConsumedCapture[]): NetworkResponseCapture | undefined {
  for (const capture of captures) {
    if (capture.kind !== 'network' || capture.subkind !== 'response') continue;
    if (capture.payload.url === url && capture.payload.method === method) {
      return capture;
    }
  }
  return undefined;
}

function outputFromResponse(response: NetworkResponseCapture): Record<string, unknown> {
  const payload = response.payload;
  const output: Record<string, unknown> = { status: payload.status };
  if (payload.mimeType !== undefined) {
    output['mimeType'] = payload.mimeType;
  }
  return output;
}
