/**
 * CLAPP-012 test battery — the DOM ActionApplier + replayJourney.
 *
 * Uses an injected fetch stub (no server, no network) so every behavior —
 * navigation, form submission, selector resolution, ambiguity, visibility,
 * error codes — is tested deterministically. Real-HTTP integration is
 * covered by corpus.test.ts and sandbox-proof.test.ts.
 */

import { describe, expect, it } from 'bun:test';
import { createDomApplier, JourneyReplayError, replayJourney } from './replayer';
import { createRecorder } from './recorder';
import type { ActionApplier, Journey } from './journey-contract';

interface RecordedRequest {
  url: string;
  method: string;
  body?: string;
}

function stubFetch(pages: Record<string, string>): {
  fetchImpl: typeof fetch;
  requests: RecordedRequest[];
} {
  const requests: RecordedRequest[] = [];
  const fetchImpl = (async (input: URL | string, init?: RequestInit): Promise<Response> => {
    const url = input instanceof URL ? input.href : input;
    const parsed = new URL(url);
    const body = pages[parsed.pathname];
    requests.push({
      url,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? init.body : undefined,
    });
    if (body === undefined) {
      return new Response('<!DOCTYPE html><html lang="en"><body><p>missing</p></body></html>', {
        status: 404,
      });
    }
    return new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });
  }) as typeof fetch;
  return { fetchImpl, requests };
}

const HOME = `<!DOCTYPE html>
<html lang="en"><head><title>home</title></head><body>
<header><nav aria-label="Main">
  <a href="page.html" data-testid="nav-page">Page</a>
  <a href="page.html">Page</a>
  <a href="#main-content">Skip</a>
</nav></header>
<main id="main-content">
  <h1 data-testid="home-heading">Home</h1>
  <img src="logo.svg" alt="ACME logo">
  <p><button type="button" data-testid="plain-button">Just a button</button></p>
  <form action="search.html" method="get">
    <label for="q">Search</label>
    <input id="q" name="q" type="text">
    <input type="hidden" name="lang" value="en">
    <button type="submit" data-testid="search-submit">Search</button>
  </form>
  <form action="subscribe.html" method="post">
    <label for="mail">Email address</label>
    <input id="mail" name="email" type="email">
    <button type="submit">Subscribe</button>
  </form>
  <p hidden data-testid="hidden-para">Invisible</p>
  <p style="display: none;" data-testid="styled-hidden">Also invisible</p>
  <input type="hidden" name="ghost" data-testid="hidden-input">
  <span aria-hidden="true" data-testid="aria-hidden-span">ignored</span>
</main>
</body></html>`;

const PAGE = `<!DOCTYPE html>
<html lang="en"><head><title>page</title></head><body>
<main id="main-content"><h1>Page the first</h1></main>
</body></html>`;

function homeApplier(options: { pages?: Record<string, string>; strict?: boolean; allowCrossOrigin?: boolean } = {}): {
  applier: ActionApplier;
  requests: RecordedRequest[];
} {
  const { fetchImpl, requests } = stubFetch({
    '/': HOME,
    '/page.html': PAGE,
    '/search.html': '<!DOCTYPE html><html lang="en"><body><main><h1>Results</h1></main></body></html>',
    '/subscribe.html': '<!DOCTYPE html><html lang="en"><body><main><h1>Subscribed</h1></main></body></html>',
    ...options.pages,
  });
  return {
    applier: createDomApplier({
      baseUrl: 'http://stub.test/',
      fetchImpl,
      strict: options.strict,
      allowCrossOrigin: options.allowCrossOrigin,
    }),
    requests,
  };
}

async function captureError(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
    return undefined;
  } catch (error) {
    return error;
  }
}

describe('DOM applier — navigate', () => {
  it('fetches the page and makes it current', async () => {
    const { applier, requests } = homeApplier();
    await applier.apply({ type: 'navigate', url: '/' });
    expect(requests.map((request) => request.url)).toEqual(['http://stub.test/']);
    await applier.apply({ type: 'assert-visible', target: { testId: 'home-heading' } });
  });

  it('resolves relative URLs against the current page', async () => {
    const { applier, requests } = homeApplier();
    await applier.apply({ type: 'navigate', url: '/' });
    await applier.apply({ type: 'click', target: { testId: 'nav-page' } });
    expect(requests[1]?.url).toBe('http://stub.test/page.html');
  });

  it('fragment-only navigation does not refetch', async () => {
    const { applier, requests } = homeApplier();
    await applier.apply({ type: 'navigate', url: '/' });
    await applier.apply({ type: 'click', target: { role: 'link', name: 'Skip' } });
    expect(requests).toHaveLength(1);
  });

  it('same-URL navigation does not refetch (browser parity)', async () => {
    const { applier, requests } = homeApplier();
    await applier.apply({ type: 'navigate', url: '/' });
    await applier.apply({ type: 'navigate', url: '/' });
    expect(requests).toHaveLength(1);
  });

  it('non-2xx navigation throws navigate-failed with status and url', async () => {
    const { applier } = homeApplier();
    const error = await captureError(() => applier.apply({ type: 'navigate', url: '/nope.html' }));
    expect(error).toBeInstanceOf(JourneyReplayError);
    const replayError = error as JourneyReplayError;
    expect(replayError.code).toBe('navigate-failed');
    expect(replayError.details).toMatchObject({ url: 'http://stub.test/nope.html', status: 404 });
  });

  it('cross-origin navigation is blocked by default and allowed when opted in', async () => {
    const blocked = homeApplier();
    const blockedError = await captureError(() =>
      blocked.applier.apply({ type: 'navigate', url: 'https://elsewhere.test/' }),
    );
    expect((blockedError as JourneyReplayError).code).toBe('navigate-blocked');
    expect((blockedError as JourneyReplayError).details).toMatchObject({
      from: 'http://stub.test',
      to: 'https://elsewhere.test',
    });

    // The stub answers any pathname on any origin.
    const allowed = homeApplier({ allowCrossOrigin: true });
    const error = await captureError(() =>
      allowed.applier.apply({ type: 'navigate', url: 'https://elsewhere.test/' }),
    );
    expect(error).toBeUndefined();
  });

  it('non-HTTP protocols throw navigate-unsupported', async () => {
    const { applier } = homeApplier();
    const error = await captureError(() => applier.apply({ type: 'navigate', url: 'data:text/plain,hi' }));
    expect((error as JourneyReplayError).code).toBe('navigate-unsupported');
  });
});

describe('DOM applier — selector resolution', () => {
  it('resolves by testId', async () => {
    const { applier } = homeApplier();
    await applier.apply({ type: 'navigate', url: '/' });
    await applier.apply({ type: 'assert-visible', target: { testId: 'home-heading' } });
  });

  it('resolves by implicit role + accessible name (label association)', async () => {
    const { applier } = homeApplier();
    await applier.apply({ type: 'navigate', url: '/' });
    await applier.apply({ type: 'fill', target: { role: 'textbox', name: 'Search' }, value: 'abc' });
  });

  it('resolves by role + name for headings, images (alt), and aria-labels', async () => {
    const { applier } = homeApplier();
    await applier.apply({ type: 'navigate', url: '/' });
    await applier.apply({ type: 'assert-visible', target: { role: 'heading', name: 'Home' } });
    await applier.apply({ type: 'assert-visible', target: { role: 'img', name: 'ACME logo' } });
    await applier.apply({
      type: 'assert-visible',
      target: { role: 'navigation', name: 'Main' },
    });
  });

  it('throws target-not-found with matchCount 0 for unknown targets', async () => {
    const { applier } = homeApplier();
    await applier.apply({ type: 'navigate', url: '/' });
    const error = await captureError(() =>
      applier.apply({ type: 'assert-visible', target: { testId: 'missing' } }),
    );
    const replayError = error as JourneyReplayError;
    expect(replayError.code).toBe('target-not-found');
    expect(replayError.details).toMatchObject({ matchCount: 0 });
    expect(replayError.message).toContain('http://stub.test/');
  });

  it('strict mode: ambiguous selector without nth throws target-ambiguous', async () => {
    const { applier } = homeApplier();
    await applier.apply({ type: 'navigate', url: '/' });
    const error = await captureError(() =>
      applier.apply({ type: 'click', target: { role: 'link', name: 'Page' } }),
    );
    const replayError = error as JourneyReplayError;
    expect(replayError.code).toBe('target-ambiguous');
    expect(replayError.details).toMatchObject({ matchCount: 2 });
  });

  it('nth disambiguates: 0 picks the header link, 1 the bare duplicate', async () => {
    const { applier, requests } = homeApplier();
    await applier.apply({ type: 'navigate', url: '/' });
    await applier.apply({ type: 'click', target: { role: 'link', name: 'Page', nth: 0 } });
    await applier.apply({ type: 'navigate', url: '/' });
    await applier.apply({ type: 'click', target: { role: 'link', name: 'Page', nth: 1 } });
    expect(requests.filter((request) => request.url === 'http://stub.test/page.html')).toHaveLength(2);
  });

  it('nth out of range throws target-not-found with matchCount', async () => {
    const { applier } = homeApplier();
    await applier.apply({ type: 'navigate', url: '/' });
    const error = await captureError(() =>
      applier.apply({ type: 'click', target: { role: 'link', name: 'Page', nth: 9 } }),
    );
    expect((error as JourneyReplayError).details).toMatchObject({ matchCount: 2, nth: 9 });
  });

  it('lenient mode (strict: false) takes the first match', async () => {
    const { applier } = homeApplier({ strict: false });
    await applier.apply({ type: 'navigate', url: '/' });
    await applier.apply({ type: 'click', target: { role: 'link', name: 'Page' } });
  });

  it('aria-hidden elements never match', async () => {
    const { applier } = homeApplier();
    await applier.apply({ type: 'navigate', url: '/' });
    const error = await captureError(() =>
      applier.apply({ type: 'assert-visible', target: { testId: 'aria-hidden-span' } }),
    );
    expect((error as JourneyReplayError).code).toBe('target-not-found');
  });

  it('acting before any navigate throws target-not-found', async () => {
    const { applier } = homeApplier();
    const error = await captureError(() =>
      applier.apply({ type: 'assert-visible', target: { testId: 'home-heading' } }),
    );
    expect((error as JourneyReplayError).code).toBe('target-not-found');
    expect((error as JourneyReplayError).message).toContain('No page has been navigated');
  });
});

describe('DOM applier — assert-visible', () => {
  it('rejects hidden attribute, inline display:none, ancestor hidden, and hidden inputs', async () => {
    const { applier } = homeApplier();
    await applier.apply({ type: 'navigate', url: '/' });
    const hidden = await captureError(() =>
      applier.apply({ type: 'assert-visible', target: { testId: 'hidden-para' } }),
    );
    expect((hidden as JourneyReplayError).code).toBe('assert-visible-failed');
    expect((hidden as JourneyReplayError).details).toMatchObject({ reason: 'hidden attribute' });

    const styled = await captureError(() =>
      applier.apply({ type: 'assert-visible', target: { testId: 'styled-hidden' } }),
    );
    expect((styled as JourneyReplayError).details).toMatchObject({
      reason: 'inline style display:none',
    });

    const input = await captureError(() =>
      applier.apply({ type: 'assert-visible', target: { testId: 'hidden-input' } }),
    );
    expect((input as JourneyReplayError).details).toMatchObject({ reason: 'input type=hidden' });
  });
});

describe('DOM applier — fill', () => {
  it('fills text inputs and textareas; value is submitted with the form', async () => {
    const { applier, requests } = homeApplier();
    await applier.apply({ type: 'navigate', url: '/' });
    await applier.apply({ type: 'fill', target: { role: 'textbox', name: 'Search' }, value: 'notes' });
    await applier.apply({ type: 'click', target: { testId: 'search-submit' } });
    const submitted = requests[requests.length - 1]?.url ?? '';
    expect(submitted).toBe('http://stub.test/search.html?q=notes&lang=en');
  });

  it('fill on a non-fillable element throws fill-not-supported', async () => {
    const { applier } = homeApplier();
    await applier.apply({ type: 'navigate', url: '/' });
    const error = await captureError(() =>
      applier.apply({ type: 'fill', target: { role: 'button', name: 'Just a button' }, value: 'x' }),
    );
    const replayError = error as JourneyReplayError;
    expect(replayError.code).toBe('fill-not-supported');
    expect(replayError.details).toMatchObject({ tagName: 'button' });
  });
});

describe('DOM applier — click', () => {
  it('clicking a submit button submits its form as GET with control values', async () => {
    const { applier, requests } = homeApplier();
    await applier.apply({ type: 'navigate', url: '/' });
    await applier.apply({ type: 'fill', target: { role: 'textbox', name: 'Search' }, value: 'x y' });
    await applier.apply({ type: 'click', target: { testId: 'search-submit' } });
    expect(requests[requests.length - 1]?.url).toBe('http://stub.test/search.html?q=x+y&lang=en');
  });

  it('clicking a non-interactive element is a documented no-op success', async () => {
    const { applier, requests } = homeApplier();
    await applier.apply({ type: 'navigate', url: '/' });
    await applier.apply({ type: 'click', target: { testId: 'plain-button' } });
    expect(requests).toHaveLength(1);
  });

  it('clicking a plain (type=button) button does not submit any form', async () => {
    const { applier, requests } = homeApplier();
    await applier.apply({ type: 'navigate', url: '/' });
    await applier.apply({ type: 'click', target: { role: 'button', name: 'Just a button' } });
    expect(requests).toHaveLength(1);
  });
});

describe('DOM applier — press', () => {
  it('Enter in a filled field submits that field\'s form (GET)', async () => {
    const { applier, requests } = homeApplier();
    await applier.apply({ type: 'navigate', url: '/' });
    await applier.apply({ type: 'fill', target: { role: 'textbox', name: 'Search' }, value: 'press' });
    await applier.apply({ type: 'press', key: 'Enter' });
    expect(requests[requests.length - 1]?.url).toBe('http://stub.test/search.html?q=press&lang=en');
  });

  it('Enter after a POST form fill submits as POST with a urlencoded body', async () => {
    const { applier, requests } = homeApplier();
    await applier.apply({ type: 'navigate', url: '/' });
    await applier.apply({
      type: 'fill',
      target: { role: 'textbox', name: 'Email address' },
      value: 'a@example.net',
    });
    await applier.apply({ type: 'press', key: 'Enter' });
    const last = requests[requests.length - 1];
    expect(last?.method).toBe('POST');
    expect(last?.url).toBe('http://stub.test/subscribe.html');
    expect(last?.body).toBe('email=a%40example.net');
  });

  it('non-Enter keys and Enter without prior interaction are no-ops', async () => {
    const { applier, requests } = homeApplier();
    await applier.apply({ type: 'navigate', url: '/' });
    await applier.apply({ type: 'press', key: 'Tab' });
    await applier.apply({ type: 'press', key: 'Enter' });
    expect(requests).toHaveLength(1);
  });
});

describe('DOM applier — wait', () => {
  it('waits the requested milliseconds', async () => {
    const { applier } = homeApplier();
    const started = Date.now();
    await applier.apply({ type: 'wait', ms: 60 });
    expect(Date.now() - started).toBeGreaterThanOrEqual(50);
  });
});

describe('replayJourney — orchestration', () => {
  function journeyWith(actions: Journey['actions']): Journey {
    return {
      id: 'journey_00000000-0000-4000-8000-000000000000',
      name: 'test',
      targetId: 'bench/b01-static',
      actions,
    };
  }

  it('applies actions in order and returns a summary', async () => {
    const { applier, requests } = homeApplier();
    const summary = await replayJourney(
      journeyWith([
        { type: 'navigate', url: '/' },
        { type: 'assert-visible', target: { role: 'heading', name: 'Home' } },
        { type: 'click', target: { testId: 'nav-page' } },
        { type: 'assert-visible', target: { role: 'heading', name: 'Page the first' } },
      ]),
      applier,
    );
    expect(summary.actionsApplied).toBe(4);
    expect(summary.journeyId).toBe('journey_00000000-0000-4000-8000-000000000000');
    expect(summary.durationMs).toBeGreaterThanOrEqual(0);
    expect(requests.map((request) => new URL(request.url).pathname)).toEqual(['/', '/page.html']);
  });

  it('annotates failures with actionIndex and the action', async () => {
    const { applier } = homeApplier();
    const error = await captureError(() =>
      replayJourney(
        journeyWith([
          { type: 'navigate', url: '/' },
          { type: 'assert-visible', target: { testId: 'missing' } },
        ]),
        applier,
      ),
    );
    const replayError = error as JourneyReplayError;
    expect(replayError).toBeInstanceOf(JourneyReplayError);
    expect(replayError.actionIndex).toBe(1);
    expect(replayError.action).toEqual({ type: 'assert-visible', target: { testId: 'missing' } });
    expect(replayError.toJSON()).toMatchObject({ code: 'target-not-found', actionIndex: 1 });
  });

  it('rejects structurally invalid journeys with journey-invalid', async () => {
    const { applier } = homeApplier();
    const error = await captureError(() =>
      replayJourney(journeyWith([{ type: 'wait', ms: -1 }]), applier),
    );
    const replayError = error as JourneyReplayError;
    expect(replayError.code).toBe('journey-invalid');
    expect(JSON.stringify(replayError.details)).toContain('non-negative integer');
  });

  it('wraps non-JourneyReplayError failures as action-failed', async () => {
    const applier: ActionApplier = {
      apply: async () => {
        throw new Error('boom');
      },
    };
    const error = await captureError(() =>
      replayJourney(journeyWith([{ type: 'wait', ms: 1 }]), applier),
    );
    const replayError = error as JourneyReplayError;
    expect(replayError.code).toBe('action-failed');
    expect(replayError.actionIndex).toBe(0);
    expect(replayError.message).toContain('boom');
  });

  it('recorded journeys replay end-to-end through the same applier', async () => {
    const { applier, requests } = homeApplier();
    const recorder = createRecorder({ name: 'recorded' });
    recorder.start('bench/b01-static');
    recorder.record({ type: 'navigate', url: '/' });
    recorder.record({ type: 'fill', target: { role: 'textbox', name: 'Search' }, value: 'rec' });
    recorder.record({ type: 'click', target: { testId: 'search-submit' } });
    const journey = recorder.finish();
    const summary = await replayJourney(journey, applier);
    expect(summary.actionsApplied).toBe(3);
    expect(requests[requests.length - 1]?.url).toBe('http://stub.test/search.html?q=rec&lang=en');
  });
});
