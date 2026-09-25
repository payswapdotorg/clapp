/**
 * @clapp/observe — shared test doubles & e2e helpers (NOT part of the
 * package's public API surface; used by this package's test suite).
 *
 * - FakeEvidenceRecorder: implements the EvidenceRecorder port the way
 *   @clapp/evidence will — canonical bytes hashed with @clapp/core
 *   sha256Hex, one EvidenceRef per record — proving payload
 *   canonical-serializability end-to-end.
 * - browserAvailable(): memoized Playwright chromium launch probe; e2e
 *   suites skip cleanly when no browser binary is present.
 * - fixture loading for the sandboxed fixture server.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { newEvidenceId, newRunId, sha256Hex, type EvidenceRef } from '@clapp/core';
import type { Browser } from 'playwright';
import { chromium } from 'playwright';
import { canonicalJson } from './canonical-json';
import type { CaptureRecord, EvidenceRecorder } from './capture-contract';

export class FakeEvidenceRecorder implements EvidenceRecorder {
  readonly runId = newRunId();
  readonly records: CaptureRecord[] = [];
  readonly refs: EvidenceRef[] = [];
  flushCalls = 0;

  async record(capture: CaptureRecord): Promise<EvidenceRef> {
    // canonicalJson THROWS on non-serializable payloads — recording doubles
    // as the canonicalizability assertion for every captured record
    const canonical = canonicalJson(capture.payload);
    const ref: EvidenceRef = { evidenceId: newEvidenceId(), kind: capture.kind, sha256: await sha256Hex(canonical) };
    this.records.push(capture);
    this.refs.push(ref);
    return ref;
  }

  async flush(): Promise<EvidenceRef[]> {
    this.flushCalls++;
    return this.refs;
  }
}

let browserAvailability: boolean | null = null;

/** Memoized probe: can this environment launch Playwright chromium? */
export async function browserAvailable(): Promise<boolean> {
  if (browserAvailability === null) {
    try {
      const browser = await chromium.launch({ headless: true });
      await browser.close();
      browserAvailability = true;
    } catch {
      browserAvailability = false;
    }
  }
  return browserAvailability;
}

/** Launches the shared e2e browser (caller closes it). */
export async function launchE2eBrowser(): Promise<Browser> {
  return chromium.launch({ headless: true });
}

const FIXTURE_DIR = join(import.meta.dir, '..', 'fixtures', 'server');

/** Reads the fixture-server files as a fixtures map for launchServerInSandbox. */
export function loadServerFixtures(): Record<string, string> {
  const files: Array<[string, string]> = [
    ['server.ts', join(FIXTURE_DIR, 'server.ts')],
    ['public/index.html', join(FIXTURE_DIR, 'public', 'index.html')],
    ['public/app.js', join(FIXTURE_DIR, 'public', 'app.js')],
    ['public/style.css', join(FIXTURE_DIR, 'public', 'style.css')],
    ['public/manifest.webmanifest', join(FIXTURE_DIR, 'public', 'manifest.webmanifest')],
    ['public/sw.js', join(FIXTURE_DIR, 'public', 'sw.js')],
    ['public/logo.svg', join(FIXTURE_DIR, 'public', 'logo.svg')],
  ];
  const fixtures: Record<string, string> = {};
  for (const [relative, absolute] of files) {
    fixtures[relative] = readFileSync(absolute, 'utf8');
  }
  return fixtures;
}

// runtime-assembled fake secrets from the fixture API (never whole literals)
export const fixtureEmailParts = ['ops', '@', 'clapp-fixture', '.', 'example'];
export const fixtureJwtHead = 'eyJhbGciOiJIUzI1NiJ9';
