/**
 * @clapp/repair — the b01-shaped GOLDEN PLAN fixture (CLAPP-042).
 *
 * A hand-constructed SynthesisPlan literal (typed against the CANONICAL
 * @clapp/plan contract types, a devDependency) that mirrors the bench-b01
 * corpus (packages/journey/fixtures/b01 — reachable via
 * @clapp/journey's resolveFixtureRoot) closely enough that ALL FOUR
 * seeded b01 journey records replay against a candidate generated from
 * it by @clapp/codegen:
 *
 * - 6 routes: /, /features.html, /pricing.html, /contact.html,
 *   /contact-success.html, /newsletter-success.html (the corpus file
 *   paths ARE the route paths — the seeded journeys navigate to exactly
 *   these);
 * - the exact b01 nav testids (logo-link, nav-toggle, nav-home,
 *   nav-features, nav-pricing, nav-contact) on every page;
 * - the EXACT b01 heading texts the journeys assert (hero/features/
 *   pricing/contact h1s, the two success-page h1s with their testids,
 *   the footer "Stay in the loop" h2);
 * - the exact image alt texts (Nimbus Notes logo, hero illustration);
 * - the footer (role contentinfo) with the Footer nav and MULTIPLE links
 *   named "Features" (main nav + footer nav) so the seeded nth-based
 *   selectors are exercised;
 * - the contact + newsletter GET forms exactly as the corpus declares
 *   them (labels, names, types, select options, submit labels/testids);
 * - ONE planned API endpoint (GET /api/notes) with a mock response — an
 *   honest 'planned' synthesis choice (the b01 corpus has no APIs; the
 *   mock exists so the repair battery can exercise mock-restore).
 *
 * HONESTY NOTES:
 * - Fixture ids are readable strings, not uuid v4 (the contract types
 *   are plain strings; the uuid convention is the planner's runtime
 *   concern, not a test fixture's — same discipline as the P3 golden
 *   fixtures).
 * - 'derived' provenance cites the corpus pages by their REAL sha256
 *   (computed here from the frozen corpus files) so the evidence refs
 *   are genuine, not fabricated hashes; the API endpoint, the server
 *   spec, and the layout landmarks are honest 'planned' choices.
 * - Lean-but-faithful: every journey-relevant corpus element is planned;
 *   non-journey corpus sections (teaser cards, plan lists, FAQ) are
 *   omitted — they are not part of the golden-plan discipline
 *   enumeration and no seeded journey observes them.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sha256Hex, type EvidenceRef } from '@clapp/core';
import {
  resolveFixtureRoot,
  resolveSeededJourneysDir,
  validateJourney,
  type Journey,
} from '@clapp/journey';
import type {
  MockResponse,
  PlanProvenance,
  PlannedAcceptance,
  PlannedApiEndpoint,
  PlannedElement,
  PlannedForm,
  PlannedPage,
  PlannedRoute,
  SynthesisPlan,
} from '@clapp/plan';

/** The golden plan's nominal port (tests always spawn with PORT=0). */
export const GOLDEN_PLAN_PORT = 46233;

/** The candidate application id carried in the diff reports. */
export const GOLDEN_CANDIDATE_APP_ID = 'appsyn_b01_repair_golden';

// ---------------------------------------------------------------------------
// Provenance helpers (real corpus hashes — genuine evidence, not fabricated)
// ---------------------------------------------------------------------------

/** Real sha256 of a frozen b01 corpus page (genuine evidence ref). */
async function corpusRef(file: string, suffix: string): Promise<EvidenceRef> {
  const bytes = await readFile(join(resolveFixtureRoot(), file), 'utf8');
  return { evidenceId: `ev_b01_${suffix}`, kind: 'static', sha256: await sha256Hex(bytes) };
}

/** The evidence-corpus rootHash stand-in: the sha256 over all six corpus page hashes. */
export async function corpusRootHash(): Promise<string> {
  const files = [
    'index.html',
    'features.html',
    'pricing.html',
    'contact.html',
    'contact-success.html',
    'newsletter-success.html',
  ];
  const hashes: string[] = [];
  for (const file of files) {
    const bytes = await readFile(join(resolveFixtureRoot(), file), 'utf8');
    hashes.push(await sha256Hex(bytes));
  }
  return sha256Hex(hashes.join('\n'));
}

/** Loads a seeded b01 journey record and validates it structurally. */
async function loadJourney(name: string): Promise<Journey> {
  const path = join(resolveSeededJourneysDir(), name);
  const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
  if (!validateJourney(parsed)) {
    throw new Error(`golden-b01-plan: seeded journey ${name} failed structural validation`);
  }
  return parsed;
}

/** The four SEEDED b01 journey records (the verification supply). */
export async function loadSeededB01Journeys(): Promise<Journey[]> {
  return [
    await loadJourney('b01-nav.json'),
    await loadJourney('b01-media.json'),
    await loadJourney('b01-newsletter.json'),
    await loadJourney('b01-contact.json'),
  ];
}

// ---------------------------------------------------------------------------
// Element builders (ids are el_<pageKey>_<suffix>; readable fixture ids)
// ---------------------------------------------------------------------------

function derivedRef(ref: EvidenceRef, screenId: string, rationale: string): PlanProvenance {
  return { level: 'derived', rationale, sourceIds: [screenId], evidenceRefs: [ref] };
}

function plannedProv(rationale: string): PlanProvenance {
  return { level: 'planned', rationale, sourceIds: [], evidenceRefs: [] };
}

/** The shared page header: banner → logo link, logo image, toggle, nav Main + 4 testid links. */
function headerElements(ref: EvidenceRef): PlannedElement[] {
  const provenance = derivedRef(ref, 'screen_b01', 'Mirrors the b01 site header: logo link, nav toggle, and the main navigation.');
  return [
    { id: 'el_header', kind: 'other', role: 'banner', provenance: plannedProv('Page header landmark — a synthesis container with no single IR source.') },
    { id: 'el_logo_link', kind: 'link', role: 'link', name: 'Nimbus Notes home', text: 'Nimbus Notes', href: '/', testId: 'logo-link', provenance },
    { id: 'el_logo_img', kind: 'image', role: 'img', name: 'Nimbus Notes logo', alt: 'Nimbus Notes logo', provenance },
    { id: 'el_nav_toggle', kind: 'button', role: 'button', name: 'Toggle navigation menu', testId: 'nav-toggle', provenance },
    { id: 'el_nav', kind: 'navigation', role: 'navigation', name: 'Main', provenance },
    { id: 'el_nav_home', kind: 'link', role: 'link', name: 'Home', text: 'Home', href: '/', testId: 'nav-home', provenance },
    { id: 'el_nav_features', kind: 'link', role: 'link', name: 'Features', text: 'Features', href: '/features.html', testId: 'nav-features', provenance },
    { id: 'el_nav_pricing', kind: 'link', role: 'link', name: 'Pricing', text: 'Pricing', href: '/pricing.html', testId: 'nav-pricing', provenance },
    { id: 'el_nav_contact', kind: 'link', role: 'link', name: 'Contact', text: 'Contact', href: '/contact.html', testId: 'nav-contact', provenance },
    { id: 'el_main', kind: 'other', role: 'main', provenance: plannedProv('Main content landmark — a synthesis container with no single IR source.') },
  ];
}

/** The shared page footer: contentinfo → Footer nav + 4 plain links, the h2, and the newsletter GET form. */
function footerElements(ref: EvidenceRef): PlannedElement[] {
  const provenance = derivedRef(ref, 'screen_b01', 'Mirrors the b01 footer: navigation, the newsletter form (GET), and its heading.');
  return [
    { id: 'el_footer', kind: 'other', role: 'contentinfo', provenance: plannedProv('Page footer landmark — a synthesis container with no single IR source.') },
    { id: 'el_foot_nav', kind: 'navigation', role: 'navigation', name: 'Footer', provenance },
    { id: 'el_foot_home', kind: 'link', role: 'link', name: 'Home', text: 'Home', href: '/', provenance },
    { id: 'el_foot_features', kind: 'link', role: 'link', name: 'Features', text: 'Features', href: '/features.html', provenance },
    { id: 'el_foot_pricing', kind: 'link', role: 'link', name: 'Pricing', text: 'Pricing', href: '/pricing.html', provenance },
    { id: 'el_foot_contact', kind: 'link', role: 'link', name: 'Contact', text: 'Contact', href: '/contact.html', provenance },
    { id: 'el_newsletter_h2', kind: 'heading', role: 'heading', text: 'Stay in the loop', level: 2, provenance },
    { id: 'el_newsletter_form', kind: 'form', role: 'form', formId: 'form_newsletter', provenance },
  ];
}

/** The newsletter form (GET) declared on every page's footer. */
const newsletterForm: PlannedForm = {
  id: 'form_newsletter',
  action: '/newsletter-success.html',
  method: 'get',
  fields: [
    { name: 'email', type: 'email', label: 'Email address', testId: 'newsletter-email', required: true, placeholder: 'you@example.com' },
  ],
  submitLabel: 'Subscribe',
  submitTestId: 'newsletter-submit',
  provenance: plannedProv('The b01 footer newsletter form — a GET submission to newsletter-success.html (planned as a page-scoped declaration).'),
};

/** The contact form (GET) declared on the contact page. */
const contactForm: PlannedForm = {
  id: 'form_contact',
  action: '/contact-success.html',
  method: 'get',
  fields: [
    { name: 'name', type: 'text', label: 'Your name', testId: 'contact-name', required: true },
    { name: 'email', type: 'email', label: 'Email address', testId: 'contact-email', required: true, placeholder: 'you@example.com' },
    {
      name: 'topic',
      type: 'select',
      label: 'Topic',
      testId: 'contact-topic',
      options: [
        { value: 'general', label: 'General question' },
        { value: 'support', label: 'Support' },
        { value: 'sales', label: 'Sales' },
      ],
    },
    { name: 'message', type: 'textarea', label: 'Message', testId: 'contact-message', required: true },
  ],
  submitLabel: 'Send message',
  submitTestId: 'contact-submit',
  provenance: plannedProv('The b01 contact form — a GET submission to contact-success.html (planned as a page-scoped declaration).'),
};

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

/** Builds the golden b01-shaped SynthesisPlan (async: real corpus hashes). */
export async function buildGoldenB01Plan(): Promise<SynthesisPlan> {
  const [indexRef, featuresRef, pricingRef, contactRef, contactSuccessRef, newsletterSuccessRef] =
    await Promise.all([
      corpusRef('index.html', 'index'),
      corpusRef('features.html', 'features'),
      corpusRef('pricing.html', 'pricing'),
      corpusRef('contact.html', 'contact'),
      corpusRef('contact-success.html', 'contact_success'),
      corpusRef('newsletter-success.html', 'newsletter_success'),
    ]);

  const routes: PlannedRoute[] = [
    { id: 'route_index', path: '/', pageId: 'page_index', provenance: derivedRef(indexRef, 'screen_b01', 'The corpus home page route.') },
    { id: 'route_features', path: '/features.html', pageId: 'page_features', provenance: derivedRef(featuresRef, 'screen_b01', 'The corpus features page route.') },
    { id: 'route_pricing', path: '/pricing.html', pageId: 'page_pricing', provenance: derivedRef(pricingRef, 'screen_b01', 'The corpus pricing page route.') },
    { id: 'route_contact', path: '/contact.html', pageId: 'page_contact', provenance: derivedRef(contactRef, 'screen_b01', 'The corpus contact page route.') },
    { id: 'route_contact_success', path: '/contact-success.html', pageId: 'page_contact_success', provenance: derivedRef(contactSuccessRef, 'screen_b01', 'The corpus contact success page route.') },
    { id: 'route_newsletter_success', path: '/newsletter-success.html', pageId: 'page_newsletter_success', provenance: derivedRef(newsletterSuccessRef, 'screen_b01', 'The corpus newsletter success page route.') },
  ];

  const pages: PlannedPage[] = [
    {
      id: 'page_index',
      routeId: 'route_index',
      title: 'Capture every idea, calmly — Nimbus Notes',
      elements: [
        ...headerElements(indexRef),
        { id: 'el_index_h1', kind: 'heading', role: 'heading', text: 'Capture every idea, calmly', level: 1, testId: 'hero-heading', provenance: derivedRef(indexRef, 'screen_b01', 'The b01 hero heading.') },
        { id: 'el_index_lead', kind: 'text', text: 'Nimbus Notes is a calm, fast notebook for small teams: quick capture, smart links, and no shouting interfaces.', provenance: derivedRef(indexRef, 'screen_b01', 'The b01 hero lead paragraph.') },
        { id: 'el_index_hero_img', kind: 'image', role: 'img', name: 'Illustration of notes organized among clouds', alt: 'Illustration of notes organized among clouds', testId: 'hero-illustration', provenance: derivedRef(indexRef, 'screen_b01', 'The b01 hero illustration (asserted by the media journey).') },
        { id: 'el_index_cta_contact', kind: 'link', role: 'link', name: 'Get started', text: 'Get started', href: '/contact.html', testId: 'cta-get-started', provenance: derivedRef(indexRef, 'screen_b01', 'The b01 hero CTA to the contact page.') },
        { id: 'el_index_cta_pricing', kind: 'link', role: 'link', name: 'See pricing', text: 'See pricing', href: '/pricing.html', testId: 'cta-pricing', provenance: derivedRef(indexRef, 'screen_b01', 'The b01 hero CTA to the pricing page.') },
        ...footerElements(indexRef),
      ],
      forms: [newsletterForm],
      provenance: derivedRef(indexRef, 'screen_b01', 'The corpus index page.'),
    },
    {
      id: 'page_features',
      routeId: 'route_features',
      title: 'Features — Nimbus Notes',
      elements: [
        ...headerElements(featuresRef),
        { id: 'el_features_h1', kind: 'heading', role: 'heading', text: 'Everything you need to stay organized', level: 1, testId: 'features-heading', provenance: derivedRef(featuresRef, 'screen_b01', 'The b01 features heading (asserted by the nav + media journeys).') },
        { id: 'el_features_lead', kind: 'text', text: 'Four capabilities, no sprawling admin console. Each one earns its place.', provenance: derivedRef(featuresRef, 'screen_b01', 'The b01 features lead paragraph.') },
        { id: 'el_features_cta', kind: 'link', role: 'link', name: 'Talk to us', text: 'Talk to us', href: '/contact.html', testId: 'features-cta', provenance: derivedRef(featuresRef, 'screen_b01', 'The b01 features CTA to the contact page.') },
        ...footerElements(featuresRef),
      ],
      forms: [newsletterForm],
      provenance: derivedRef(featuresRef, 'screen_b01', 'The corpus features page.'),
    },
    {
      id: 'page_pricing',
      routeId: 'route_pricing',
      title: 'Pricing — Nimbus Notes',
      elements: [
        ...headerElements(pricingRef),
        { id: 'el_pricing_h1', kind: 'heading', role: 'heading', text: 'Simple, honest pricing', level: 1, testId: 'pricing-heading', provenance: derivedRef(pricingRef, 'screen_b01', 'The b01 pricing heading (asserted by the nav journey).') },
        { id: 'el_pricing_lead', kind: 'text', text: 'Every plan includes the full feature set. You only pay for team size and support depth.', provenance: derivedRef(pricingRef, 'screen_b01', 'The b01 pricing lead paragraph.') },
        ...footerElements(pricingRef),
      ],
      forms: [newsletterForm],
      provenance: derivedRef(pricingRef, 'screen_b01', 'The corpus pricing page.'),
    },
    {
      id: 'page_contact',
      routeId: 'route_contact',
      title: 'Contact — Nimbus Notes',
      elements: [
        ...headerElements(contactRef),
        { id: 'el_contact_h1', kind: 'heading', role: 'heading', text: "We'd love to hear from you", level: 1, testId: 'contact-heading', provenance: derivedRef(contactRef, 'screen_b01', 'The b01 contact heading (asserted by the nav + contact journeys).') },
        { id: 'el_contact_lead', kind: 'text', text: 'Questions, support, or sales — one form, no ticket maze.', provenance: derivedRef(contactRef, 'screen_b01', 'The b01 contact lead paragraph.') },
        { id: 'el_contact_form', kind: 'form', role: 'form', formId: 'form_contact', testId: 'contact-form', provenance: derivedRef(contactRef, 'screen_b01', 'The b01 contact form (GET).') },
        ...footerElements(contactRef),
      ],
      forms: [contactForm, newsletterForm],
      provenance: derivedRef(contactRef, 'screen_b01', 'The corpus contact page.'),
    },
    {
      id: 'page_contact_success',
      routeId: 'route_contact_success',
      title: 'Thanks for reaching out! — Nimbus Notes',
      elements: [
        ...headerElements(contactSuccessRef),
        { id: 'el_contact_success_h1', kind: 'heading', role: 'heading', text: 'Thanks for reaching out!', level: 1, testId: 'contact-success', provenance: derivedRef(contactSuccessRef, 'screen_b01', 'The b01 contact success heading (asserted by testid by the contact journey).') },
        { id: 'el_contact_success_p', kind: 'text', text: "We'll get back to you within two business days.", provenance: derivedRef(contactSuccessRef, 'screen_b01', 'The b01 contact success paragraph.') },
        { id: 'el_back_home', kind: 'link', role: 'link', name: 'Back to home', text: 'Back to home', href: '/', testId: 'back-home', provenance: derivedRef(contactSuccessRef, 'screen_b01', 'The b01 back-to-home link (clicked by the contact journey).') },
        ...footerElements(contactSuccessRef),
      ],
      forms: [newsletterForm],
      provenance: derivedRef(contactSuccessRef, 'screen_b01', 'The corpus contact success page.'),
    },
    {
      id: 'page_newsletter_success',
      routeId: 'route_newsletter_success',
      title: "You're on the list! — Nimbus Notes",
      elements: [
        ...headerElements(newsletterSuccessRef),
        { id: 'el_newsletter_success_h1', kind: 'heading', role: 'heading', text: "You're on the list!", level: 1, testId: 'newsletter-success', provenance: derivedRef(newsletterSuccessRef, 'screen_b01', 'The b01 newsletter success heading (asserted by testid by the newsletter journey).') },
        { id: 'el_newsletter_success_p', kind: 'text', text: 'Look out for a short hello from us once a month. No spam, and you can unsubscribe any time.', provenance: derivedRef(newsletterSuccessRef, 'screen_b01', 'The b01 newsletter success paragraph.') },
        ...footerElements(newsletterSuccessRef),
      ],
      forms: [newsletterForm],
      provenance: derivedRef(newsletterSuccessRef, 'screen_b01', 'The corpus newsletter success page.'),
    },
  ];

  const endpoints: PlannedApiEndpoint[] = [
    {
      id: 'api_notes',
      method: 'GET',
      urlPattern: '/api/notes',
      sourceOperationIds: [],
      provenance: plannedProv('A planned mock endpoint (the b01 corpus has no APIs; this exists so the repair battery can exercise mock-restore).'),
    },
  ];

  const mocks: MockResponse[] = [
    {
      id: 'mock_notes_ok',
      endpointId: 'api_notes',
      statusCode: 200,
      bodyJson: { notes: [{ id: 'n1', title: 'Welcome to Nimbus' }] },
    },
  ];

  const acceptance: PlannedAcceptance[] = [
    {
      id: 'acc_nav',
      journeyId: 'journey_5bee1e16-86b8-4447-8c9e-26ee583a341a',
      purpose: 'B01 navigation walkthrough',
      steps: [
        'navigate /',
        'assert Main navigation',
        'click nav-features',
        'assert features heading',
        'click first Pricing link',
        'assert pricing heading',
        'click nav-home',
        'assert hero heading',
        'click first Contact link',
        'assert contact heading',
        'wait',
      ],
      expectedRoute: '/contact.html',
      mustSeeElementIds: ['el_contact_h1'],
      sourceJourneyIds: ['journey_5bee1e16-86b8-4447-8c9e-26ee583a341a'],
      provenance: derivedRef(contactRef, 'screen_b01', 'The seeded nav journey ends on the contact page.'),
    },
    {
      id: 'acc_media',
      journeyId: 'journey_3a803288-80fa-48d1-8cff-274d36bcc857',
      purpose: 'B01 media and assets tour',
      steps: [
        'navigate /',
        'assert logo image',
        'assert hero illustration',
        'wait',
        'click first Features link',
        'assert features heading',
        'assert logo image',
        'click second Features link',
        'assert features heading',
        'assert footer (contentinfo)',
      ],
      expectedRoute: '/features.html',
      mustSeeElementIds: ['el_footer'],
      sourceJourneyIds: ['journey_3a803288-80fa-48d1-8cff-274d36bcc857'],
      provenance: derivedRef(featuresRef, 'screen_b01', 'The seeded media journey ends on the features page.'),
    },
    {
      id: 'acc_newsletter',
      journeyId: 'journey_05441478-5197-4c92-b553-b66ea11b84c3',
      purpose: 'B01 newsletter subscribe via Enter',
      steps: [
        'navigate /',
        'fill Email address',
        'press Enter',
        'assert newsletter-success',
        'wait',
      ],
      expectedRoute: '/newsletter-success.html',
      mustSeeElementIds: ['el_newsletter_success_h1'],
      sourceJourneyIds: ['journey_05441478-5197-4c92-b553-b66ea11b84c3'],
      provenance: derivedRef(newsletterSuccessRef, 'screen_b01', 'The seeded newsletter journey ends on the success page.'),
    },
    {
      id: 'acc_contact',
      journeyId: 'journey_693afe48-c999-4e31-8328-ec1bd92d9780',
      purpose: 'B01 contact form round-trip',
      steps: [
        'navigate /contact.html',
        'assert contact heading',
        'fill Your name',
        'fill contact-email',
        'fill contact-message',
        'click Send message',
        'assert contact-success',
        'click Back to home',
        'assert hero heading',
      ],
      expectedRoute: '/',
      mustSeeElementIds: ['el_index_h1'],
      sourceJourneyIds: ['journey_693afe48-c999-4e31-8328-ec1bd92d9780'],
      provenance: derivedRef(indexRef, 'screen_b01', 'The seeded contact journey ends on the home page.'),
    },
  ];

  return {
    planVersion: '0.1',
    application: {
      id: GOLDEN_CANDIDATE_APP_ID,
      name: 'Nimbus Notes',
      platform: 'web',
      sourceModelId: 'app_b01_repair_fixture',
      entrypoints: ['/'],
    },
    routes,
    pages,
    navigation: [],
    storage: [],
    api: { endpoints, mocks },
    acceptance,
    server: {
      startCommand: 'bun server.ts',
      port: GOLDEN_PLAN_PORT,
      healthPath: '/',
    },
    assumptions: [],
    constraints: [
      'byte-deterministic candidate generation (same plan → identical tree)',
      'every seeded b01 journey selector must resolve on every planned page',
      'the loop under test never reads this plan — repairs are evidence-driven from diff findings only',
    ],
  };
}
