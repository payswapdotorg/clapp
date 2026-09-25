// CLAPP-021 unit — capture reader: manifest walk, hash verification,
// honest degradation (never fatal).

import { describe, expect, test } from 'bun:test';
import { walkCaptures, assertManifestShape } from './capture-reader';
import type { EvidenceManifest } from '@clapp/evidence';
import type { EvidenceRef } from '@clapp/core';
import {
  SynthClock,
  domTreeCapture,
  docRequestCapture,
  el,
  extractFromSynth,
  pageTree,
  runtimeCapture,
  screenshotCapture,
  synthBundle,
} from './test-utils';

const clock = new SynthClock();

function homeTree(): ReturnType<typeof pageTree> {
  return pageTree([el('a', 'link', { text: 'Home', attrs: { href: '/' } })]);
}

describe('walkCaptures — happy path through a real recorded bundle', () => {
  test('parses known (kind, subkind) captures in event order with stats', async () => {
    const synth = await synthBundle([
      docRequestCapture('http://synth.test/', clock.next()),
      domTreeCapture(homeTree(), clock.next()),
      screenshotCapture(clock.next()),
      runtimeCapture(clock.next()),
    ]);
    const { stats } = await extractFromSynth(synth);
    expect(stats.capturesParsed).toBe(3); // doc request + dom + screenshot
    expect(stats.capturesSkipped).toBe(1); // runtime:console is not consumed by any v0 extractor
    expect(synth.bundle.manifest.evidence.length).toBe(4);
  });

  test('unknown subkind produces ONE deduped warning per combo but counts every capture', async () => {
    const synth = await synthBundle([
      runtimeCapture(clock.next(), 'fixture:one'),
      runtimeCapture(clock.next(), 'fixture:two'),
      runtimeCapture(clock.next(), 'fixture:three'),
    ]);
    const { warnings } = await extractFromSynth(synth);
    const comboWarnings = warnings.filter((warning) => warning.includes('kind=runtime, subkind=console'));
    expect(comboWarnings.length).toBe(1);
    expect(comboWarnings[0]).toContain('3 occurrences');
  });

  test('unknown dom subkind is skipped without touching screens', async () => {
    const synth = await synthBundle([
      docRequestCapture('http://synth.test/', clock.next()),
      { kind: 'dom', ts: clock.next(), payload: { subkind: 'dom-mutation', target: 'x' }, redacted: false },
    ]);
    const result = await extractFromSynth(synth);
    expect(result.model.screens.length).toBe(0);
    expect(result.stats.capturesSkipped).toBe(1);
    expect(result.warnings.some((warning) => warning.includes('kind=dom, subkind=dom-mutation'))).toBe(true);
  });

  test('malformed payload for a known subkind is skipped (dom-tree without root)', async () => {
    const synth = await synthBundle([
      docRequestCapture('http://synth.test/', clock.next()),
      { kind: 'dom', ts: clock.next(), payload: { subkind: 'dom-tree', nodeCount: 1, truncated: false }, redacted: false },
    ]);
    const result = await extractFromSynth(synth);
    expect(result.model.screens.length).toBe(0);
    expect(result.stats.capturesSkipped).toBe(1);
    expect(result.warnings.some((warning) => warning.includes('kind=dom, subkind=dom-tree'))).toBe(true);
  });
});

describe('walkCaptures — degradation is never fatal', () => {
  test('readArtifact returning null skips the capture with a warning', async () => {
    const synth = await synthBundle([
      docRequestCapture('http://synth.test/', clock.next()),
      domTreeCapture(homeTree(), clock.next()),
    ]);
    const { extractIrModel } = await import('./extraction');
    const result = await extractIrModel({
      bundle: synth.bundle,
      readArtifact: async () => null,
    });
    expect(result.model.screens.length).toBe(0);
    expect(result.stats.capturesParsed).toBe(0);
    expect(result.stats.capturesSkipped).toBe(2);
    expect(result.warnings.every((warning) => warning.includes('readArtifact returned null'))).toBe(true);
    // the bundle's refs are still cataloged (the catalog describes the bundle)
    expect(result.model.evidence.length).toBe(2);
  });

  test('tampered bytes (hash mismatch) are skipped with a warning', async () => {
    const synth = await synthBundle([
      docRequestCapture('http://synth.test/', clock.next()),
      domTreeCapture(homeTree(), clock.next()),
    ]);
    const { extractIrModel } = await import('./extraction');
    let calls = 0;
    const result = await extractIrModel({
      bundle: synth.bundle,
      readArtifact: async (id) => {
        const bytes = await synth.artifactStore.readBytes(id);
        if (bytes === null || calls++ > 0) {
          return new TextEncoder().encode('{"kind":"dom","ts":"2026-09-25T10:00:00.000Z","payload":{},"redacted":false}');
        }
        return bytes;
      },
    });
    expect(result.stats.capturesParsed).toBe(1);
    expect(result.stats.capturesSkipped).toBe(1);
    expect(result.warnings.some((warning) => warning.includes("hash to"))).toBe(true);
  });

  test('non-JSON artifact bytes (hash-matching) are skipped with a warning', async () => {
    const { sha256Hex } = await import('@clapp/core');
    const bytes = new TextEncoder().encode('this is not json');
    const ref: EvidenceRef = { evidenceId: 'ev_badjson', kind: 'dom', sha256: await sha256Hex(bytes) };
    const manifest: EvidenceManifest = {
      schemaVersion: 1,
      run: { id: 'run_handmade', targetId: 'bench/hand', kind: 'observation', status: 'completed', startedAt: '2026-09-25T10:00:00.000Z', environment: {} },
      events: [
        {
          runId: 'run_handmade',
          seq: 0,
          ts: '2026-09-25T10:00:00.000Z',
          kind: 'evidence.recorded',
          payload: { artifactId: 'art_badjson', sizeBytes: bytes.byteLength },
          evidenceRefs: [ref],
        },
      ],
      evidence: [ref],
      artifacts: [],
    };
    const walk = await walkCaptures(manifest, async () => bytes);
    expect(walk.captures.length).toBe(0);
    expect(walk.stats.capturesSkipped).toBe(1);
    expect(walk.warnings[0]).toContain('is not JSON');
  });

  test('capture-kind/ref-kind mismatch is skipped', async () => {
    const synth = await synthBundle([docRequestCapture('http://synth.test/', clock.next())]);
    // hand-mutate a copy of the manifest: claim the network ref is a dom ref
    const manifest = JSON.parse(JSON.stringify(synth.bundle.manifest)) as EvidenceManifest;
    const mutatedRef: EvidenceRef = { ...manifest.evidence[0]!, kind: 'dom' };
    manifest.evidence[0] = mutatedRef;
    for (const event of manifest.events) {
      for (const ref of event.evidenceRefs ?? []) {
        if (ref.evidenceId === mutatedRef.evidenceId) {
          ref.kind = 'dom';
        }
      }
    }
    const walk = await walkCaptures(manifest, (id) => synth.artifactStore.readBytes(id));
    expect(walk.captures.length).toBe(0);
    expect(walk.stats.capturesSkipped).toBe(1);
    expect(walk.warnings[0]).toContain("has kind 'network' but the ref claims 'dom'");
  });
});

describe('walkCaptures — manifest shape guards', () => {
  test('grossly malformed manifests throw ManifestShapeError', () => {
    expect(() => assertManifestShape({} as unknown as EvidenceManifest)).toThrow('manifest.run');
    expect(() => assertManifestShape({ run: { id: 'run_x' }, events: null } as unknown as EvidenceManifest)).toThrow('manifest.events');
    expect(() =>
      assertManifestShape({ run: { id: 'run_x' }, events: [], evidence: [{}], artifacts: [] } as unknown as EvidenceManifest),
    ).toThrow('malformed EvidenceRef');
  });

  test('refs listed in the manifest but not linked to any evidence.recorded event are warned about', async () => {
    const synth = await synthBundle([docRequestCapture('http://synth.test/', clock.next())]);
    const manifest = JSON.parse(JSON.stringify(synth.bundle.manifest)) as EvidenceManifest;
    manifest.evidence.push({ evidenceId: 'ev_orphan', kind: 'static', sha256: 'a'.repeat(64) });
    const walk = await walkCaptures(manifest, (id) => synth.artifactStore.readBytes(id));
    expect(walk.captures.length).toBe(1);
    expect(walk.warnings.some((warning) => warning.includes('ev_orphan'))).toBe(true);
  });
});
