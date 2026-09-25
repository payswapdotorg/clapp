/**
 * CLAPP-022 test battery — the deterministic frontier policy.
 *
 * Hand-built states drive the policy directly (no explorer, no network):
 * decision-type coverage, act priority (fills before clicks), budget stops
 * firing exactly at the declared limits (including the affordability rule
 * that keeps maxSteps unshootable), and same-seed/same-states determinism.
 */

import { describe, expect, it } from 'bun:test';
import { createExplorationPolicy, createPrng } from '../src/policy';
import type { ActionableElement } from '../src/html-walker';
import type { ExplorationState } from '../src/policy';

function textbox(name: string, path: string): ActionableElement {
  return {
    path,
    tag: 'input',
    role: 'textbox',
    journeyRole: 'textbox',
    name,
    inputType: 'text',
    target: { role: 'textbox', name },
  };
}

function button(name: string, path: string): ActionableElement {
  return {
    path,
    tag: 'button',
    role: 'button',
    journeyRole: 'button',
    name,
    target: { role: 'button', name },
  };
}

function link(name: string, path: string): ActionableElement {
  return {
    path,
    tag: 'a',
    role: 'link',
    journeyRole: 'link',
    name,
    href: '/nowhere',
    target: { role: 'link', name },
  };
}

function state(overrides: Partial<ExplorationState> = {}): ExplorationState {
  return {
    stepsUsed: 0,
    currentRoute: '/',
    screensVisited: ['/'],
    frontier: [],
    untried: [],
    triedOnCurrentScreen: 0,
    pending: [],
    ...overrides,
  };
}

const POLICY = {
  entrypoints: ['/'],
  maxSteps: 100,
  maxScreens: 50,
  maxActionsPerScreen: 50,
  seed: 1,
};

describe('policy — decision types', () => {
  it('navigates the frontier (entrypoints seed the very first decision)', () => {
    const policy = createExplorationPolicy({ ...POLICY, entrypoints: ['/start'] });
    const decision = policy.nextAction(state({ screensVisited: [], currentRoute: '', frontier: [] }));
    expect(decision).toEqual({ type: 'navigate', route: '/start' });
  });

  it('acts on an untried candidate (fills before clicks)', () => {
    const policy = createExplorationPolicy(POLICY);
    const untried = [button('Submit', 'html>body>button'), textbox('Name', 'html>body>input')];
    const decision = policy.nextAction(state({ untried }));
    expect(decision.type).toBe('act');
    if (decision.type === 'act') {
      // The fill-class candidate wins regardless of document order.
      expect(decision.actionable.role).toBe('textbox');
      expect(decision.actionable.name).toBe('Name');
    }
  });

  it('never treats links/comboboxes as act candidates', () => {
    const policy = createExplorationPolicy(POLICY);
    const untried = [link('Docs', 'html>body>a')];
    const decision = policy.nextAction(state({ untried, frontier: [] }));
    // No actable candidate and no work → done (links belong to the frontier).
    expect(decision.type).toBe('done');
  });

  it('backtracks when the current screen is exhausted but another has work', () => {
    const policy = createExplorationPolicy(POLICY);
    const decision = policy.nextAction(
      state({
        untried: [],
        frontier: [],
        pending: [{ route: '/form', untriedCount: 2, triedCount: 0, journeyLength: 3 }],
      }),
    );
    expect(decision).toEqual({ type: 'backtrack', route: '/form' });
  });

  it('prefers acting on the current screen over backtracking or navigating', () => {
    const policy = createExplorationPolicy(POLICY);
    const decision = policy.nextAction(
      state({
        untried: [textbox('Name', 'html>body>input')],
        frontier: ['/pricing'],
        pending: [{ route: '/form', untriedCount: 1, triedCount: 0, journeyLength: 1 }],
      }),
    );
    expect(decision.type).toBe('act');
  });

  it('finishes naturally with frontierExhausted when no work remains', () => {
    const policy = createExplorationPolicy(POLICY);
    const decision = policy.nextAction(state({ untried: [], frontier: [], pending: [] }));
    expect(decision).toEqual({
      type: 'done',
      reason: 'all discovered routes visited and all act candidates tried',
      budgetStops: [],
      frontierExhausted: true,
    });
  });
});

describe('policy — budget stops fire exactly at the declared limits', () => {
  it('max-steps: done at stepsUsed === maxSteps', () => {
    const policy = createExplorationPolicy({ ...POLICY, maxSteps: 3 });
    const decision = policy.nextAction(state({ stepsUsed: 3, untried: [textbox('Name', 'p')] }));
    expect(decision.type).toBe('done');
    if (decision.type === 'done') {
      expect(decision.budgetStops).toEqual(['max-steps']);
      expect(decision.frontierExhausted).toBe(false);
    }
  });

  it('max-steps: an act is issued only when probe+apply (2 actions) still fit', () => {
    const policy = createExplorationPolicy({ ...POLICY, maxSteps: 3 });
    const affordable = policy.nextAction(state({ stepsUsed: 1, untried: [textbox('Name', 'p')] }));
    expect(affordable.type).toBe('act'); // 1 + 2 = 3 <= 3
    const tooTight = policy.nextAction(state({ stepsUsed: 2, untried: [textbox('Name', 'p')] }));
    expect(tooTight.type).toBe('done'); // 2 + 2 = 4 > 3
    if (tooTight.type === 'done') {
      expect(tooTight.budgetStops).toEqual(['max-steps']);
    }
  });

  it('max-steps: a backtrack whose prefix does not fit is not issued', () => {
    const policy = createExplorationPolicy({ ...POLICY, maxSteps: 3 });
    const decision = policy.nextAction(
      state({
        stepsUsed: 2,
        untried: [],
        frontier: [],
        pending: [{ route: '/form', untriedCount: 1, triedCount: 0, journeyLength: 2 }],
      }),
    );
    expect(decision.type).toBe('done'); // 2 + 2 = 4 > 3
    if (decision.type === 'done') {
      expect(decision.budgetStops).toEqual(['max-steps']);
      expect(decision.frontierExhausted).toBe(false); // work remained, budget blocked it
    }
  });

  it('max-screens: done the moment the screen budget is reached (conservative)', () => {
    const policy = createExplorationPolicy({ ...POLICY, maxScreens: 2 });
    const atLimit = policy.nextAction(
      state({ screensVisited: ['/', '/pricing'], untried: [textbox('Name', 'p')], frontier: ['/features'] }),
    );
    expect(atLimit.type).toBe('done');
    if (atLimit.type === 'done') {
      expect(atLimit.budgetStops).toEqual(['max-screens']);
    }
    const belowLimit = policy.nextAction(
      state({ screensVisited: ['/'], untried: [textbox('Name', 'p')], frontier: ['/features'] }),
    );
    expect(belowLimit.type).toBe('act'); // 1 < 2 — still working
  });

  it('max-actions-per-screen: caps acting on the current screen, navigates instead', () => {
    const policy = createExplorationPolicy({ ...POLICY, maxActionsPerScreen: 1 });
    const capped = policy.nextAction(
      state({ untried: [textbox('Name', 'p')], triedOnCurrentScreen: 1, frontier: ['/pricing'] }),
    );
    expect(capped.type).toBe('navigate'); // not act — the screen is capped
    if (capped.type === 'navigate') {
      expect(capped.route).toBe('/pricing');
    }
  });

  it('max-actions-per-screen: is the honest stop when it is all that blocks work', () => {
    const policy = createExplorationPolicy({ ...POLICY, maxActionsPerScreen: 1 });
    const decision = policy.nextAction(
      state({
        untried: [textbox('Name', 'p')],
        triedOnCurrentScreen: 1,
        frontier: [],
        pending: [{ route: '/form', untriedCount: 3, triedCount: 1, journeyLength: 1 }],
      }),
    );
    expect(decision.type).toBe('done');
    if (decision.type === 'done') {
      expect(decision.budgetStops).toEqual(['max-actions-per-screen']);
      expect(decision.frontierExhausted).toBe(false); // work remained, the cap blocked it
    }
  });
});

describe('policy — determinism', () => {
  const STATES: ExplorationState[] = [
    state({ screensVisited: [], currentRoute: '', frontier: [] }),
    state({ untried: [button('B1', 'p1'), textbox('T1', 'p2'), textbox('T2', 'p3')] }),
    state({ untried: [button('B1', 'p1'), button('B2', 'p4')] }),
    state({ untried: [], frontier: ['/pricing', '/features', '/contact'] }),
    state({ untried: [], frontier: ['/features', '/contact'] }),
    state({
      untried: [],
      frontier: [],
      pending: [
        { route: '/a', untriedCount: 1, triedCount: 0, journeyLength: 1 },
        { route: '/b', untriedCount: 2, triedCount: 0, journeyLength: 2 },
      ],
    }),
    state({ untried: [], frontier: [], pending: [] }),
  ];

  it('same seed + same state sequence ⇒ identical decision sequences', () => {
    const decide = (s: ExplorationState): string =>
      JSON.stringify(createExplorationPolicy({ ...POLICY, seed: 20260925 }).nextAction(s));
    const first = STATES.map(decide);
    // A second, independently constructed policy of the same seed, driven
    // through the same states, must produce identical decisions.
    const second = STATES.map(decide);
    expect(first).toEqual(second);
    expect(first.length).toBe(STATES.length);
    expect(first.some((line) => line.includes('"type":"act"'))).toBe(true);
    expect(first.some((line) => line.includes('"type":"navigate"'))).toBe(true);
    expect(first.some((line) => line.includes('"type":"backtrack"'))).toBe(true);
    expect(first.some((line) => line.includes('"type":"done"'))).toBe(true);
  });

  it('different seeds can order the same frontier differently (verified pair)', () => {
    const pick = (seed: number): string => {
      const decision = createExplorationPolicy({ ...POLICY, seed }).nextAction(
        state({ untried: [], frontier: ['/pricing', '/features', '/contact'] }),
      );
      if (decision.type !== 'navigate') throw new Error('expected navigate');
      return decision.route;
    };
    // Verified once by hand: these two seeds pick different frontier routes.
    expect(pick(1)).not.toBe(pick(2));
  });

  it('the splitmix32 PRNG is deterministic and in [0,1)', () => {
    const a = createPrng(42);
    const b = createPrng(42);
    const seqA = [a(), a(), a(), a(), a()];
    const seqB = [b(), b(), b(), b(), b()];
    expect(seqA).toEqual(seqB);
    for (const value of seqA) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
    expect(seqA[0]).not.toBe(seqA[1]);
  });
});
