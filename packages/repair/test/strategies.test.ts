// CLAPP-042 — strategy unit tests (pure content transforms against REAL
// generated output: the golden plan is generated live via @clapp/codegen
// so the byte-perfection claims hold against the actual candidate layout,
// not frozen strings).

import { describe, expect, test } from 'bun:test';
import { generateApp } from '@clapp/codegen';
import { buildGoldenB01Plan } from '../fixtures/golden-b01-plan';
import type { DiffFinding } from '../src/diff-contract';
import {
  applyAttributeRestore,
  applyMockRestore,
  applyTextRestore,
  selectStrategy,
  verifyFinding,
} from '../src/strategies';

const ev: { evidenceId: string; kind: 'static'; sha256: string } = { evidenceId: 'ev_unit', kind: 'static', sha256: '0'.repeat(64) };

function textFinding(route: string, expectedText: string, actualText: string): DiffFinding {
  return {
    id: 'diff_unit_text',
    dimension: 'semantic',
    severity: 'critical',
    summary: 'unit',
    anchors: [{ stepIndex: 0, sourceIds: ['screen_x'] }],
    expected: { kind: 'text', route, text: expectedText },
    actual: { kind: 'text', route, text: actualText },
  };
}

function testidFinding(
  route: string,
  expectedTestId: string,
  init: { actualTestId?: string; tag?: string; text?: string; matchIndex?: number },
): DiffFinding {
  const expected: Record<string, unknown> = { kind: 'testid', route, testId: expectedTestId };
  const actual: Record<string, unknown> = { kind: 'testid', route };
  if (init.actualTestId !== undefined) {
    actual['testId'] = init.actualTestId;
  }
  for (const key of ['tag', 'text', 'matchIndex'] as const) {
    const value = init[key];
    if (value !== undefined) {
      expected[key] = value;
      actual[key] = value;
    }
  }
  return {
    id: 'diff_unit_testid',
    dimension: 'semantic',
    severity: 'critical',
    summary: 'unit',
    anchors: [{ stepIndex: 0, sourceIds: ['screen_x'] }],
    expected,
    actual,
  };
}

function mockFinding(expectedStatus: number, actualStatus: number, bodyJson?: unknown): DiffFinding {
  const expected: Record<string, unknown> = {
    kind: 'mock',
    method: 'GET',
    urlPattern: '/api/notes',
    statusCode: expectedStatus,
  };
  const actual: Record<string, unknown> = {
    kind: 'mock',
    method: 'GET',
    urlPattern: '/api/notes',
    statusCode: actualStatus,
  };
  if (bodyJson !== undefined) {
    expected['bodyJson'] = bodyJson;
    actual['bodyJson'] = bodyJson;
  }
  return {
    id: 'diff_unit_mock',
    dimension: 'network',
    severity: 'major',
    summary: 'unit',
    anchors: [{ stepIndex: 0, sourceIds: ['api_notes'], leftEvidence: ev, rightEvidence: ev }],
    expected,
    actual,
  };
}

describe('strategies against the real generated golden app', () => {
  test('text-restore inverts a heading text mutation byte-perfectly', async () => {
    const app = generateApp(await buildGoldenB01Plan());
    const pricing = app.files.find((file) => file.path === 'pages/pricing.html.ts');
    expect(pricing).toBeDefined();
    const pristine = pricing?.contents ?? '';

    const mutated = pristine.replace('Simple, honest pricing', 'Simple, dishonest pricing');
    expect(mutated).not.toBe(pristine);

    const finding = textFinding('/pricing.html', 'Simple, honest pricing', 'Simple, dishonest pricing');
    const result = applyTextRestore(mutated, finding);
    expect(result).not.toBeNull();
    expect(result?.edited).toBe(true);
    expect(result?.resolved).toBe(true);
    expect(result?.content).toBe(pristine); // BYTE-perfect restoration
    expect(verifyFinding(result?.content ?? '', finding)).toBe(true);
  });

  test('text-restore is idempotent when the expected text is already present', async () => {
    const app = generateApp(await buildGoldenB01Plan());
    const pristine = app.files.find((file) => file.path === 'pages/pricing.html.ts')?.contents ?? '';
    const finding = textFinding('/pricing.html', 'Simple, honest pricing', 'Simple, dishonest pricing');
    const result = applyTextRestore(pristine, finding);
    expect(result).not.toBeNull();
    expect(result?.edited).toBe(false);
    expect(result?.resolved).toBe(true);
  });

  test('text-restore abstains when the needle is absent or ambiguous', () => {
    const missing = textFinding('/pricing.html', 'A', 'needle-not-present');
    expect(applyTextRestore('no such text here', missing)).toBeNull();

    const ambiguous = textFinding('/pricing.html', 'A', 'dup');
    const content = 'x dup y dup z';
    expect(applyTextRestore(content, ambiguous)).toBeNull();
  });

  test('text-restore abstains when texts are equal or routes differ', () => {
    expect(applyTextRestore('x', textFinding('/r', 'same', 'same'))).toBeNull();
    const routeMismatch = {
      id: 'diff_unit_x',
      dimension: 'semantic' as const,
      severity: 'critical' as const,
      summary: 'unit',
      anchors: [{ stepIndex: 0, sourceIds: [] }],
      expected: { kind: 'text', route: '/a', text: 'x' },
      actual: { kind: 'text', route: '/b', text: 'y' },
    };
    expect(applyTextRestore('x', routeMismatch)).toBeNull();
  });

  test('attribute-restore re-adds a removed heading testid byte-perfectly (canonical slot)', async () => {
    const app = generateApp(await buildGoldenB01Plan());
    const contactSuccess = app.files.find((file) => file.path === 'pages/contact-success.html.ts');
    const pristine = contactSuccess?.contents ?? '';
    expect(pristine).toContain('<h1 data-testid="contact-success" role="heading">Thanks for reaching out!</h1>');

    const mutated = pristine.replace(' data-testid="contact-success"', '');
    expect(mutated).toContain('<h1 role="heading">Thanks for reaching out!</h1>');

    const finding = testidFinding('/contact-success.html', 'contact-success', {
      tag: 'h1',
      text: 'Thanks for reaching out!',
      matchIndex: 0,
    });
    const result = applyAttributeRestore(mutated, finding);
    expect(result).not.toBeNull();
    expect(result?.edited).toBe(true);
    expect(result?.resolved).toBe(true);
    expect(result?.content).toBe(pristine); // BYTE-perfect restoration
  });

  test('attribute-restore rewrites a renamed testid (unique occurrence)', async () => {
    const app = generateApp(await buildGoldenB01Plan());
    const pricing = app.files.find((file) => file.path === 'pages/pricing.html.ts')?.contents ?? '';
    const mutated = pricing.replace('data-testid="pricing-heading"', 'data-testid="pricing-headline"');
    const finding = testidFinding('/pricing.html', 'pricing-heading', { actualTestId: 'pricing-headline' });
    const result = applyAttributeRestore(mutated, finding);
    expect(result).not.toBeNull();
    expect(result?.content).toBe(pricing);
  });

  test('attribute-restore locates elements by ordinal among same-shape matches', async () => {
    const app = generateApp(await buildGoldenB01Plan());
    const index = app.files.find((file) => file.path === 'pages/index.html.ts')?.contents ?? '';
    // The footer Features link (no testid) is the SECOND <a> with text "Features".
    const finding = testidFinding('/', 'footer-features', {
      tag: 'a',
      text: 'Features',
      matchIndex: 1,
    });
    const result = applyAttributeRestore(index, finding);
    expect(result).not.toBeNull();
    // The insertion lands on the footer link (after href), not the nav link.
    expect(result?.content).toContain('<a href="/features.html" data-testid="footer-features">Features</a>');
    expect(result?.content.match(/data-testid="nav-features"/g)).toHaveLength(1);
  });

  test('attribute-restore abstains for unlocatable elements and unslottable tags', () => {
    const notFound = testidFinding('/pricing.html', 'x', {
      tag: 'h1',
      text: 'no such text',
      matchIndex: 0,
    });
    expect(applyAttributeRestore('whatever', notFound)).toBeNull();

    const paragraph = testidFinding('/pricing.html', 'p-testid', {
      tag: 'p',
      text: 'anything',
      matchIndex: 0,
    });
    expect(applyAttributeRestore('<p>anything</p>', paragraph)).toBeNull();
  });

  test('mock-restore inverts a status mutation byte-perfectly inside the endpoint entry', async () => {
    const app = generateApp(await buildGoldenB01Plan());
    const server = app.files.find((file) => file.path === 'server.ts');
    const pristine = server?.contents ?? '';
    expect(pristine).toContain('statusCode: 200');

    const mutated = pristine.replace('statusCode: 200', 'statusCode: 500');
    const finding = mockFinding(200, 500, { notes: [{ id: 'n1', title: 'Welcome to Nimbus' }] });
    const result = applyMockRestore(mutated, finding);
    expect(result).not.toBeNull();
    expect(result?.edited).toBe(true);
    expect(result?.resolved).toBe(true);
    expect(result?.content).toBe(pristine); // BYTE-perfect restoration
  });

  test('mock-restore restores a divergent body and abstains when the entry is absent', async () => {
    const app = generateApp(await buildGoldenB01Plan());
    const pristine = app.files.find((file) => file.path === 'server.ts')?.contents ?? '';

    // Status divergent + body divergent.
    const bodyMutation = pristine.replace(
      'bodyJson: {"notes":[{"id":"n1","title":"Welcome to Nimbus"}]}',
      'bodyJson: {"notes":[]}',
    );
    const statusAndBody: DiffFinding = {
      id: 'diff_unit_mock2',
      dimension: 'network',
      severity: 'major',
      summary: 'unit',
      anchors: [{ stepIndex: 0, sourceIds: ['api_notes'] }],
      expected: {
        kind: 'mock',
        method: 'GET',
        urlPattern: '/api/notes',
        statusCode: 200,
        bodyJson: { notes: [{ id: 'n1', title: 'Welcome to Nimbus' }] },
      },
      actual: { kind: 'mock', method: 'GET', urlPattern: '/api/notes', statusCode: 200, bodyJson: { notes: [] } },
    };
    const result = applyMockRestore(bodyMutation, statusAndBody);
    expect(result?.content).toBe(pristine);

    const noEntry = {
      id: 'diff_unit_mock3',
      dimension: 'network' as const,
      severity: 'major' as const,
      summary: 'unit',
      anchors: [{ stepIndex: 0, sourceIds: [] }],
      expected: { kind: 'mock', method: 'GET', urlPattern: '/api/unknown', statusCode: 200 },
      actual: { kind: 'mock', method: 'GET', urlPattern: '/api/unknown', statusCode: 500 },
    };
    expect(applyMockRestore(pristine, noEntry)).toBeNull();
  });

  test('selectStrategy dispatches by payload shape; unknown shapes get no strategy', () => {
    expect(selectStrategy(textFinding('/p.html', 'a', 'b'))).toEqual({
      strategy: 'text-restore',
      targetPath: 'pages/p.html.ts',
    });
    expect(selectStrategy(testidFinding('/p.html', 't', {}))?.strategy).toBe('attribute-restore');
    expect(selectStrategy(mockFinding(200, 500))?.strategy).toBe('mock-restore');
    const structural: DiffFinding = {
      id: 'diff_struct',
      dimension: 'semantic',
      severity: 'critical',
      summary: 'unit',
      anchors: [{ stepIndex: 0, sourceIds: [] }],
    };
    expect(selectStrategy(structural)).toBeNull();
    const foreignShape: DiffFinding = {
      id: 'diff_foreign',
      dimension: 'visual',
      severity: 'major',
      summary: 'unit',
      anchors: [{ stepIndex: 0, sourceIds: [] }],
      expected: { kind: 'pixels', blob: '...' },
      actual: { kind: 'pixels', blob: '!!' },
    };
    expect(selectStrategy(foreignShape)).toBeNull();
  });

  test('verifyFinding is false for unresolved findings and for payload-less ones', async () => {
    const app = generateApp(await buildGoldenB01Plan());
    const pristine = app.files.find((file) => file.path === 'pages/pricing.html.ts')?.contents ?? '';
    expect(verifyFinding(pristine, textFinding('/pricing.html', 'not there', 'nope'))).toBe(false);
    const structural: DiffFinding = {
      id: 'diff_struct',
      dimension: 'semantic',
      severity: 'critical',
      summary: 'unit',
      anchors: [{ stepIndex: 0, sourceIds: [] }],
    };
    expect(verifyFinding(pristine, structural)).toBe(false);
  });
});
