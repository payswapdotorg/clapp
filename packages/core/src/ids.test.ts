import { describe, expect, it } from 'bun:test';
import { newArtifactId, newEvidenceId, newRunId } from './index';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('packages/core id helpers', () => {
  it('newRunId() returns "run_" + uuid v4', () => {
    const id = newRunId();
    expect(id.startsWith('run_')).toBe(true);
    expect(UUID_V4.test(id.slice('run_'.length))).toBe(true);
  });

  it('newArtifactId() returns "art_" + uuid v4', () => {
    const id = newArtifactId();
    expect(id.startsWith('art_')).toBe(true);
    expect(UUID_V4.test(id.slice('art_'.length))).toBe(true);
  });

  it('newEvidenceId() returns "ev_" + uuid v4', () => {
    const id = newEvidenceId();
    expect(id.startsWith('ev_')).toBe(true);
    expect(UUID_V4.test(id.slice('ev_'.length))).toBe(true);
  });

  it('identifiers are unique across calls', () => {
    const runs = new Set(Array.from({ length: 128 }, () => newRunId()));
    const artifacts = new Set(Array.from({ length: 128 }, () => newArtifactId()));
    const evidence = new Set(Array.from({ length: 128 }, () => newEvidenceId()));
    expect(runs.size).toBe(128);
    expect(artifacts.size).toBe(128);
    expect(evidence.size).toBe(128);
  });
});
