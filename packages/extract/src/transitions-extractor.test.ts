// CLAPP-021 unit — transitions extractor: consecutive distinct routes in
// document order, evidence citations on both sides, honest skips.

import { describe, expect, test } from 'bun:test';
import {
  SynthClock,
  docRequestCapture,
  domTreeCapture,
  el,
  extractFromSynth,
  pageTree,
  responseCapture,
  synthBundle,
} from './test-utils';

const clock = new SynthClock();

function tree(): ReturnType<typeof pageTree> {
  return pageTree([el('a', 'link', { text: 'Next', attrs: { href: '/next' } })]);
}

describe('transitions-extractor — navigation transitions', () => {
  test('three distinct routes in order → two transitions with from/to screens and navigate trigger', async () => {
    const synth = await synthBundle([
      docRequestCapture('http://synth.test/', clock.next()),
      responseCapture('http://synth.test/', 'GET', 200, clock.next(), { mimeType: 'text/html' }),
      domTreeCapture(tree(), clock.next()),
      docRequestCapture('http://synth.test/pricing', clock.next()),
      responseCapture('http://synth.test/pricing', 'GET', 200, clock.next(), { mimeType: 'text/html' }),
      domTreeCapture(tree(), clock.next()),
      docRequestCapture('http://synth.test/features', clock.next()),
      domTreeCapture(tree(), clock.next()),
    ]);
    const { model, stats } = await extractFromSynth(synth);
    expect(stats.transitionsEmitted).toBe(2);
    const routeById = new Map(model.screens.map((screen) => [screen.id, screen.route]));
    expect(model.state.transitions.map((transition) => [routeById.get(transition.fromScreenId), routeById.get(transition.toScreenId)])).toEqual([
      ['/', '/pricing'],
      ['/pricing', '/features'],
    ]);
    for (const transition of model.state.transitions) {
      expect(transition.trigger).toEqual({ type: 'action', action: 'navigate' });
      expect(transition.sideEffects).toEqual([]);
      expect(transition.provenance.level).toBe('derived');
    }
    // input = observed navigation URL of the to-side document request
    expect(model.state.transitions[0]!.input).toEqual({ url: 'http://synth.test/pricing' });
    // outputs = the paired document response (status + mimeType)
    expect(model.state.transitions[0]!.outputs).toEqual([{ status: 200, mimeType: 'text/html' }]);
    expect(model.state.transitions[1]!.outputs).toBeUndefined(); // no response recorded for /features
    // evidenceRefs = document requests + dom captures on both sides
    const first = model.state.transitions[0]!;
    const evidenceIds = first.provenance.confidence.evidenceRefs.map((ref) => ref.evidenceId);
    expect(evidenceIds.length).toBe(4); // doc / + doc /pricing + dom / + dom /pricing
  });

  test('consecutive same-route captures produce no transition', async () => {
    const synth = await synthBundle([
      docRequestCapture('http://synth.test/', clock.next()),
      domTreeCapture(tree(), clock.next()),
      docRequestCapture('http://synth.test/', clock.next()),
      domTreeCapture(tree(), clock.next()),
    ]);
    const { model } = await extractFromSynth(synth);
    expect(model.state.transitions.length).toBe(0);
    expect(model.screens.length).toBe(1);
  });

  test('A→B→A yields two transitions (return navigation is a real transition)', async () => {
    const synth = await synthBundle([
      docRequestCapture('http://synth.test/a', clock.next()),
      domTreeCapture(tree(), clock.next()),
      docRequestCapture('http://synth.test/b', clock.next()),
      domTreeCapture(tree(), clock.next()),
      docRequestCapture('http://synth.test/a', clock.next()),
      domTreeCapture(tree(), clock.next()),
    ]);
    const { model } = await extractFromSynth(synth);
    const routeById = new Map(model.screens.map((screen) => [screen.id, screen.route]));
    expect(model.state.transitions.map((transition) => [routeById.get(transition.fromScreenId), routeById.get(transition.toScreenId)])).toEqual([
      ['/a', '/b'],
      ['/b', '/a'],
    ]);
  });

  test('a route with no screen (no dom capture) skips its transitions with a warning', async () => {
    const synth = await synthBundle([
      docRequestCapture('http://synth.test/a', clock.next()),
      domTreeCapture(tree(), clock.next()),
      docRequestCapture('http://synth.test/b', clock.next()), // no dom capture for /b
      docRequestCapture('http://synth.test/c', clock.next()),
      domTreeCapture(tree(), clock.next()),
    ]);
    const { model, warnings } = await extractFromSynth(synth);
    expect(model.screens.map((screen) => screen.route)).toEqual(['/a', '/c']);
    expect(model.state.transitions.length).toBe(0); // a→b and b→c both reference the missing /b screen
    expect(warnings.filter((warning) => warning.includes('not emitted: no screen for route /b')).length).toBe(2);
  });
});
