/**
 * @clapp/codegen — the golden b01-shaped SynthesisPlan fixture (CLAPP-031).
 *
 * A hand-constructed plan literal that mirrors the bench-b01 corpus
 * (packages/journey/fixtures/b01) and satisfies EVERY target selector of
 * the four seeded journeys (packages/journey/fixtures/journeys/*.json):
 * nav testids (nav-home/nav-features/nav-pricing/nav-contact), the exact
 * b01 heading texts, the exact image alt texts, one <footer> (role
 * contentinfo) per page, TWO links named "Features" per page (main nav +
 * footer nav — the media journey selects them by nth 0 and nth 1), the
 * contact form (name/email/topic-select/message), the footer newsletter
 * form (email), and the contact-success / newsletter-success pages with
 * their testids. The corpus + journey records are truth; the killer
 * acceptance test replays all four seeded journeys against the app
 * generated from THIS plan.
 *
 * HONEST NOTES:
 * - Element/route/page/form/... ids are deterministic uuid-v4-SHAPED
 *   placeholders ("00000000-0000-4000-8000-…", version 4 + variant bits
 *   intact) — this is a fixture, not a planner output; @clapp/plan
 *   (CLAPP-030) mints real ids.
 * - The evidenceRefs are structural stand-ins (sha256 of 64 zeros — an
 *   obviously non-real placeholder, not secret-shaped). @clapp/plan
 *   derives real refs from sealed evidence bundles.
 * - Screen ids in sourceIds reference the IR screens the b01 corpus was
 *   modeled as during P2.
 */

import type { EvidenceRef } from '@clapp/core';
import type {
  PlanProvenance,
  PlannedElement,
  PlannedForm,
  PlannedPage,
  PlannedRoute,
  SynthesisPlan,
} from '../src/synthesis-contract';

const UUID_PREFIX = '00000000-0000-4000-8000-';

const pad = (value: number, width = 2): string => String(value).padStart(width, '0');

let evidenceCounter = 0;

/** Placeholder evidence ref (see the fixture header note). */
function evRef(): EvidenceRef {
  evidenceCounter += 1;
  return {
    evidenceId: `ev_${UUID_PREFIX}${pad(evidenceCounter, 12)}`,
    kind: 'static',
    sha256: '0'.repeat(64),
  };
}

function derived(screenId: string, rationale: string): PlanProvenance {
  return { level: 'derived', rationale, sourceIds: [screenId], evidenceRefs: [evRef()] };
}

function planned(rationale: string): PlanProvenance {
  return { level: 'planned', rationale, sourceIds: [], evidenceRefs: [] };
}

const SCREEN_HOME = `screen_${UUID_PREFIX}000000000001`;
const SCREEN_FEATURES = `screen_${UUID_PREFIX}000000000002`;
const SCREEN_PRICING = `screen_${UUID_PREFIX}000000000003`;
const SCREEN_CONTACT = `screen_${UUID_PREFIX}000000000004`;
const SCREEN_CONTACT_SUCCESS = `screen_${UUID_PREFIX}000000000005`;
const SCREEN_NEWSLETTER_SUCCESS = `screen_${UUID_PREFIX}000000000006`;

/** Element ids are literal, uuid-v4-shaped: el_…{page:02}{seq:03} in a 12-digit tail. */
function elementId(page: number, seq: number): string {
  return `el_${UUID_PREFIX}${'0'.repeat(7)}${pad(page, 2)}${pad(seq, 3)}`;
}

interface ElementInit {
  kind: PlannedElement['kind'];
  testId?: string;
  role?: string;
  name?: string;
  text?: string;
  href?: string;
  alt?: string;
  formId?: string;
  level?: number;
}

function el(page: number, seq: number, screenId: string, init: ElementInit): PlannedElement {
  return { id: elementId(page, seq), ...init, provenance: derived(screenId, `Renders the observed b01 ${init.kind} from ${screenId}.`) };
}

function elPlanned(page: number, seq: number, init: ElementInit, rationale: string): PlannedElement {
  return { id: elementId(page, seq), ...init, provenance: planned(rationale) };
}

/** The shared page header: banner → logo link, logo image, nav Main + 4 links. */
function headerBlock(page: number, screenId: string): PlannedElement[] {
  const navLink = (seq: number, testId: string, text: string, href: string): PlannedElement =>
    el(page, seq, screenId, { kind: 'link', testId, text, href });
  return [
    elPlanned(page, 1, { kind: 'other', role: 'banner' }, 'Page header landmark — a synthesis container with no single IR source.'),
    el(page, 2, screenId, { kind: 'link', testId: 'logo-link', name: 'Nimbus Notes home', text: 'Nimbus Notes', href: '/' }),
    el(page, 3, screenId, { kind: 'image', alt: 'Nimbus Notes logo' }),
    el(page, 4, screenId, { kind: 'navigation', name: 'Main' }),
    navLink(5, 'nav-home', 'Home', '/'),
    navLink(6, 'nav-features', 'Features', '/features.html'),
    navLink(7, 'nav-pricing', 'Pricing', '/pricing.html'),
    navLink(8, 'nav-contact', 'Contact', '/contact.html'),
    elPlanned(page, 9, { kind: 'other', role: 'main' }, 'Main content landmark — a synthesis container with no single IR source.'),
  ];
}

/** The shared page footer: contentinfo → nav Footer + 4 links, newsletter form, copyright. */
function footerBlock(page: number, screenId: string, startSeq: number, newsletterFormId: string): PlannedElement[] {
  const seq = { value: startSeq };
  const next = (): number => {
    const current = seq.value;
    seq.value += 1;
    return current;
  };
  const plainLink = (text: string, href: string): PlannedElement =>
    el(page, next(), screenId, { kind: 'link', text, href });
  return [
    elPlanned(page, next(), { kind: 'other', role: 'contentinfo' }, 'Page footer landmark — a synthesis container with no single IR source.'),
    el(page, next(), screenId, { kind: 'navigation', name: 'Footer' }),
    plainLink('Home', '/'),
    plainLink('Features', '/features.html'),
    plainLink('Pricing', '/pricing.html'),
    plainLink('Contact', '/contact.html'),
    el(page, next(), screenId, { kind: 'form', formId: newsletterFormId }),
    el(page, next(), screenId, { kind: 'text', text: '© 2026 Nimbus Notes. A CLAPP b01 benchmark fixture.' }),
  ];
}

const CONTACT_FORM_ID = `form_${UUID_PREFIX}0000000000f1`;
const NEWSLETTER_FORM_ID = `form_${UUID_PREFIX}0000000000f2`;

/** The b01 contact form (name/email/topic/message, GET → contact-success). */
const CONTACT_FORM: PlannedForm = {
  id: CONTACT_FORM_ID,
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
  provenance: derived(SCREEN_CONTACT, 'The b01 contact form with its observed fields, select options and submit affordance.'),
};

/** The b01 footer newsletter form (email, GET → newsletter-success). */
const NEWSLETTER_FORM: PlannedForm = {
  id: NEWSLETTER_FORM_ID,
  action: '/newsletter-success.html',
  method: 'get',
  fields: [
    { name: 'email', type: 'email', label: 'Email address', testId: 'newsletter-email', required: true, placeholder: 'you@example.com' },
  ],
  submitLabel: 'Subscribe',
  submitTestId: 'newsletter-submit',
  provenance: derived(SCREEN_HOME, 'The b01 newsletter form carried by every page footer.'),
};

// ---- pages -------------------------------------------------------------------

const HOME_PAGE: PlannedPage = {
  id: `page_${UUID_PREFIX}000000000001`,
  routeId: `route_${UUID_PREFIX}000000000001`,
  title: 'Capture every idea, calmly — Nimbus Notes',
  elements: [
    ...headerBlock(1, SCREEN_HOME),
    el(1, 10, SCREEN_HOME, { kind: 'heading', level: 1, testId: 'hero-heading', text: 'Capture every idea, calmly' }),
    el(1, 11, SCREEN_HOME, { kind: 'text', text: 'Nimbus Notes is a calm, fast notebook for small teams: quick capture, smart links, and no shouting interfaces.' }),
    el(1, 12, SCREEN_HOME, { kind: 'image', testId: 'hero-illustration', alt: 'Illustration of notes organized among clouds' }),
    el(1, 13, SCREEN_HOME, { kind: 'link', testId: 'cta-get-started', text: 'Get started', href: '/contact.html' }),
    el(1, 14, SCREEN_HOME, { kind: 'link', testId: 'cta-pricing', text: 'See pricing', href: '/pricing.html' }),
    el(1, 15, SCREEN_HOME, { kind: 'heading', level: 2, text: 'Why teams choose Nimbus' }),
    el(1, 16, SCREEN_HOME, { kind: 'heading', level: 3, text: 'Fast capture' }),
    el(1, 17, SCREEN_HOME, { kind: 'text', text: 'A new note is one keystroke away. No modals, no required fields, no ceremony.' }),
    el(1, 18, SCREEN_HOME, { kind: 'link', name: 'Learn more about fast capture', text: 'Learn more', href: '/features.html' }),
    el(1, 19, SCREEN_HOME, { kind: 'heading', level: 3, text: 'Smart linking' }),
    el(1, 20, SCREEN_HOME, { kind: 'text', text: 'Notes mention each other with plain links, and the graph keeps itself tidy.' }),
    el(1, 21, SCREEN_HOME, { kind: 'link', name: 'Learn more about smart linking', text: 'Learn more', href: '/features.html' }),
    el(1, 22, SCREEN_HOME, { kind: 'link', testId: 'cta-explore-features', text: 'Explore all features', href: '/features.html' }),
    ...footerBlock(1, SCREEN_HOME, 23, NEWSLETTER_FORM_ID),
  ],
  forms: [NEWSLETTER_FORM],
  provenance: derived(SCREEN_HOME, 'The b01 home page (index.html) as observed.'),
};

const FEATURES_PAGE: PlannedPage = {
  id: `page_${UUID_PREFIX}000000000002`,
  routeId: `route_${UUID_PREFIX}000000000002`,
  title: 'Features — Nimbus Notes',
  elements: [
    ...headerBlock(2, SCREEN_FEATURES),
    el(2, 10, SCREEN_FEATURES, { kind: 'heading', level: 1, testId: 'features-heading', text: 'Everything you need to stay organized' }),
    el(2, 11, SCREEN_FEATURES, { kind: 'text', text: 'Four capabilities, no sprawling admin console. Each one earns its place.' }),
    el(2, 12, SCREEN_FEATURES, { kind: 'heading', level: 2, text: 'Fast capture' }),
    el(2, 13, SCREEN_FEATURES, { kind: 'text', text: 'A new note is one keystroke away, from anywhere in the app. Titles are optional; everything is searchable the moment it exists.' }),
    el(2, 14, SCREEN_FEATURES, {
      kind: 'list',
      text: 'Instant note creation with a single shortcut\nOptional titles — first line becomes the title when you want one\nEverything indexed as you type',
    }),
    el(2, 15, SCREEN_FEATURES, { kind: 'heading', level: 2, text: 'Smart linking' }),
    el(2, 16, SCREEN_FEATURES, { kind: 'text', text: 'Notes mention each other with plain links. Backlinks assemble themselves, and the graph view stays readable even at a thousand notes.' }),
    el(2, 17, SCREEN_FEATURES, {
      kind: 'list',
      text: 'Plain-text mentions that resolve to notes\nAutomatic backlinks on every note\nA graph you can actually read',
    }),
    el(2, 18, SCREEN_FEATURES, { kind: 'link', testId: 'features-cta', text: 'Talk to us', href: '/contact.html' }),
    ...footerBlock(2, SCREEN_FEATURES, 19, NEWSLETTER_FORM_ID),
  ],
  forms: [NEWSLETTER_FORM],
  provenance: derived(SCREEN_FEATURES, 'The b01 features page (features.html) as observed.'),
};

const PRICING_PAGE: PlannedPage = {
  id: `page_${UUID_PREFIX}000000000003`,
  routeId: `route_${UUID_PREFIX}000000000003`,
  title: 'Pricing — Nimbus Notes',
  elements: [
    ...headerBlock(3, SCREEN_PRICING),
    el(3, 10, SCREEN_PRICING, { kind: 'heading', level: 1, testId: 'pricing-heading', text: 'Simple, honest pricing' }),
    el(3, 11, SCREEN_PRICING, { kind: 'text', text: 'Every plan includes the full feature set. You only pay for team size and support depth.' }),
    el(3, 12, SCREEN_PRICING, { kind: 'heading', level: 2, text: 'Starter' }),
    el(3, 13, SCREEN_PRICING, { kind: 'text', text: '$0 / forever' }),
    el(3, 14, SCREEN_PRICING, { kind: 'list', text: 'One workspace\nUnlimited notes\nCommunity support' }),
    el(3, 15, SCREEN_PRICING, { kind: 'link', testId: 'plan-starter-cta', text: 'Choose Starter', href: '/contact.html' }),
    el(3, 16, SCREEN_PRICING, { kind: 'heading', level: 2, text: 'Team' }),
    el(3, 17, SCREEN_PRICING, { kind: 'text', text: '$8 / user / month' }),
    el(3, 18, SCREEN_PRICING, { kind: 'list', text: 'Shared spaces\nMentions and digests\nEmail support' }),
    el(3, 19, SCREEN_PRICING, { kind: 'link', testId: 'plan-team-cta', text: 'Choose Team', href: '/contact.html' }),
    el(3, 20, SCREEN_PRICING, { kind: 'heading', level: 2, text: 'Studio' }),
    el(3, 21, SCREEN_PRICING, { kind: 'text', text: '$15 / user / month' }),
    el(3, 22, SCREEN_PRICING, { kind: 'list', text: 'Everything in Team\nSAML sign-in\nPriority support' }),
    el(3, 23, SCREEN_PRICING, { kind: 'link', testId: 'plan-studio-cta', text: 'Choose Studio', href: '/contact.html' }),
    el(3, 24, SCREEN_PRICING, { kind: 'heading', level: 2, text: 'Frequently asked questions' }),
    el(3, 25, SCREEN_PRICING, { kind: 'heading', level: 3, text: 'Is there really a free plan?' }),
    el(3, 26, SCREEN_PRICING, { kind: 'text', text: 'Yes — Starter is free forever, with no note limits and no expiring trial.' }),
    el(3, 27, SCREEN_PRICING, { kind: 'heading', level: 3, text: 'Can I export my notes?' }),
    el(3, 28, SCREEN_PRICING, { kind: 'text', text: 'Always. Every note exports as plain text, and whole workspaces export as a single archive.' }),
    ...footerBlock(3, SCREEN_PRICING, 29, NEWSLETTER_FORM_ID),
  ],
  forms: [NEWSLETTER_FORM],
  provenance: derived(SCREEN_PRICING, 'The b01 pricing page (pricing.html) as observed.'),
};

const CONTACT_PAGE: PlannedPage = {
  id: `page_${UUID_PREFIX}000000000004`,
  routeId: `route_${UUID_PREFIX}000000000004`,
  title: "Contact — Nimbus Notes",
  elements: [
    ...headerBlock(4, SCREEN_CONTACT),
    el(4, 10, SCREEN_CONTACT, { kind: 'heading', level: 1, testId: 'contact-heading', text: "We'd love to hear from you" }),
    el(4, 11, SCREEN_CONTACT, { kind: 'text', text: 'Questions, support, or sales — one form, no ticket maze.' }),
    el(4, 12, SCREEN_CONTACT, { kind: 'form', testId: 'contact-form', formId: CONTACT_FORM_ID }),
    el(4, 13, SCREEN_CONTACT, { kind: 'heading', level: 2, text: 'Other ways to reach us' }),
    el(4, 14, SCREEN_CONTACT, { kind: 'text', text: 'Write to hello@nimbusnotes.example any time. We reply within two business days.' }),
    ...footerBlock(4, SCREEN_CONTACT, 15, NEWSLETTER_FORM_ID),
  ],
  forms: [CONTACT_FORM, NEWSLETTER_FORM],
  provenance: derived(SCREEN_CONTACT, 'The b01 contact page (contact.html) as observed.'),
};

const CONTACT_SUCCESS_PAGE: PlannedPage = {
  id: `page_${UUID_PREFIX}000000000005`,
  routeId: `route_${UUID_PREFIX}000000000005`,
  title: 'Thanks for reaching out! — Nimbus Notes',
  elements: [
    ...headerBlock(5, SCREEN_CONTACT_SUCCESS),
    el(5, 10, SCREEN_CONTACT_SUCCESS, { kind: 'heading', level: 1, testId: 'contact-success', text: 'Thanks for reaching out!' }),
    el(5, 11, SCREEN_CONTACT_SUCCESS, { kind: 'text', text: "We'll get back to you within two business days." }),
    el(5, 12, SCREEN_CONTACT_SUCCESS, { kind: 'link', testId: 'back-home', text: 'Back to home', href: '/' }),
    ...footerBlock(5, SCREEN_CONTACT_SUCCESS, 13, NEWSLETTER_FORM_ID),
  ],
  forms: [NEWSLETTER_FORM],
  provenance: derived(SCREEN_CONTACT_SUCCESS, 'The b01 contact-success page (contact-success.html) as observed.'),
};

const NEWSLETTER_SUCCESS_PAGE: PlannedPage = {
  id: `page_${UUID_PREFIX}000000000006`,
  routeId: `route_${UUID_PREFIX}000000000006`,
  title: "You're on the list! — Nimbus Notes",
  elements: [
    ...headerBlock(6, SCREEN_NEWSLETTER_SUCCESS),
    el(6, 10, SCREEN_NEWSLETTER_SUCCESS, { kind: 'heading', level: 1, testId: 'newsletter-success', text: "You're on the list!" }),
    el(6, 11, SCREEN_NEWSLETTER_SUCCESS, { kind: 'text', text: 'Look out for a short hello from us once a month. No spam, and you can unsubscribe any time.' }),
    el(6, 12, SCREEN_NEWSLETTER_SUCCESS, { kind: 'link', testId: 'back-home', text: 'Back to home', href: '/' }),
    ...footerBlock(6, SCREEN_NEWSLETTER_SUCCESS, 13, NEWSLETTER_FORM_ID),
  ],
  forms: [NEWSLETTER_FORM],
  provenance: derived(SCREEN_NEWSLETTER_SUCCESS, 'The b01 newsletter-success page (newsletter-success.html) as observed.'),
};

// ---- routes ------------------------------------------------------------------

function route(n: number, path: string, pageId: string, screenId: string): PlannedRoute {
  return {
    id: `route_${UUID_PREFIX}${pad(n, 12)}`,
    path,
    pageId,
    provenance: derived(screenId, `The observed b01 route ${path}.`),
  };
}

const GOLDEN_ROUTES: PlannedRoute[] = [
  route(1, '/', HOME_PAGE.id, SCREEN_HOME),
  route(2, '/features.html', FEATURES_PAGE.id, SCREEN_FEATURES),
  route(3, '/pricing.html', PRICING_PAGE.id, SCREEN_PRICING),
  route(4, '/contact.html', CONTACT_PAGE.id, SCREEN_CONTACT),
  route(5, '/contact-success.html', CONTACT_SUCCESS_PAGE.id, SCREEN_CONTACT_SUCCESS),
  route(6, '/newsletter-success.html', NEWSLETTER_SUCCESS_PAGE.id, SCREEN_NEWSLETTER_SUCCESS),
];

// ---- the golden plan -----------------------------------------------------------

/** Element ids referenced by the acceptance entries (terminal assert-visible targets). */
export const GOLDEN_ELEMENT_IDS = {
  homeHeroHeading: elementId(1, 10),
  featuresHeading: elementId(2, 10),
  featuresFooter: elementId(2, 19),
  contactHeading: elementId(4, 10),
  newsletterSuccessHeading: elementId(6, 10),
} as const;

const NAV_05 = `nav_${UUID_PREFIX}000000000005`;
const NAV_06 = `nav_${UUID_PREFIX}000000000006`;

export const GOLDEN_B01_PLAN: SynthesisPlan = {
  planVersion: '0.1',
  application: {
    id: `appsyn_${UUID_PREFIX}0000000000a1`,
    name: 'Nimbus Notes',
    platform: 'web',
    sourceModelId: `app_${UUID_PREFIX}0000000000a1`,
    entrypoints: ['/'],
  },
  routes: GOLDEN_ROUTES,
  pages: [HOME_PAGE, FEATURES_PAGE, PRICING_PAGE, CONTACT_PAGE, CONTACT_SUCCESS_PAGE, NEWSLETTER_SUCCESS_PAGE],
  navigation: [
    {
      id: `nav_${UUID_PREFIX}000000000001`,
      fromRouteId: GOLDEN_ROUTES[0]?.id ?? '',
      toRouteId: GOLDEN_ROUTES[1]?.id ?? '',
      trigger: { kind: 'link', elementId: elementId(1, 6) },
      sourceTransitionIds: [`trans_${UUID_PREFIX}000000000001`],
      provenance: derived(SCREEN_HOME, 'Home → features via the main nav Features link.'),
    },
    {
      id: `nav_${UUID_PREFIX}000000000002`,
      fromRouteId: GOLDEN_ROUTES[0]?.id ?? '',
      toRouteId: GOLDEN_ROUTES[2]?.id ?? '',
      trigger: { kind: 'link', elementId: elementId(1, 7) },
      sourceTransitionIds: [`trans_${UUID_PREFIX}000000000002`],
      provenance: derived(SCREEN_HOME, 'Home → pricing via the main nav Pricing link.'),
    },
    {
      id: `nav_${UUID_PREFIX}000000000003`,
      fromRouteId: GOLDEN_ROUTES[0]?.id ?? '',
      toRouteId: GOLDEN_ROUTES[3]?.id ?? '',
      trigger: { kind: 'link', elementId: elementId(1, 8) },
      sourceTransitionIds: [`trans_${UUID_PREFIX}000000000003`],
      provenance: derived(SCREEN_HOME, 'Home → contact via the main nav Contact link.'),
    },
    {
      id: `nav_${UUID_PREFIX}000000000004`,
      fromRouteId: GOLDEN_ROUTES[0]?.id ?? '',
      toRouteId: GOLDEN_ROUTES[3]?.id ?? '',
      trigger: { kind: 'link', elementId: elementId(1, 13) },
      sourceTransitionIds: [`trans_${UUID_PREFIX}000000000004`],
      provenance: derived(SCREEN_HOME, 'Home → contact via the Get started CTA.'),
    },
    {
      id: NAV_05,
      fromRouteId: GOLDEN_ROUTES[0]?.id ?? '',
      toRouteId: GOLDEN_ROUTES[5]?.id ?? '',
      trigger: { kind: 'form-submit', formId: NEWSLETTER_FORM_ID },
      sourceTransitionIds: [`trans_${UUID_PREFIX}000000000005`],
      provenance: derived(SCREEN_HOME, 'Home → newsletter-success via the footer newsletter form (GET submit / Enter).'),
    },
    {
      id: NAV_06,
      fromRouteId: GOLDEN_ROUTES[3]?.id ?? '',
      toRouteId: GOLDEN_ROUTES[4]?.id ?? '',
      trigger: { kind: 'form-submit', formId: CONTACT_FORM_ID },
      sourceTransitionIds: [`trans_${UUID_PREFIX}000000000006`],
      provenance: derived(SCREEN_CONTACT, 'Contact → contact-success via the contact form submit.'),
    },
    {
      id: `nav_${UUID_PREFIX}000000000007`,
      fromRouteId: GOLDEN_ROUTES[4]?.id ?? '',
      toRouteId: GOLDEN_ROUTES[0]?.id ?? '',
      trigger: { kind: 'link', elementId: elementId(5, 12) },
      sourceTransitionIds: [`trans_${UUID_PREFIX}000000000007`],
      provenance: derived(SCREEN_CONTACT_SUCCESS, 'Contact-success → home via the Back to home link.'),
    },
    {
      id: `nav_${UUID_PREFIX}000000000008`,
      fromRouteId: GOLDEN_ROUTES[5]?.id ?? '',
      toRouteId: GOLDEN_ROUTES[0]?.id ?? '',
      trigger: { kind: 'link', elementId: elementId(6, 12) },
      sourceTransitionIds: [`trans_${UUID_PREFIX}000000000008`],
      provenance: derived(SCREEN_NEWSLETTER_SUCCESS, 'Newsletter-success → home via the Back to home link.'),
    },
    {
      id: `nav_${UUID_PREFIX}000000000009`,
      fromRouteId: GOLDEN_ROUTES[1]?.id ?? '',
      toRouteId: GOLDEN_ROUTES[3]?.id ?? '',
      trigger: { kind: 'link', elementId: elementId(2, 18) },
      sourceTransitionIds: [`trans_${UUID_PREFIX}000000000009`],
      provenance: derived(SCREEN_FEATURES, 'Features → contact via the Talk to us CTA.'),
    },
    {
      id: `nav_${UUID_PREFIX}000000000010`,
      fromRouteId: GOLDEN_ROUTES[2]?.id ?? '',
      toRouteId: GOLDEN_ROUTES[3]?.id ?? '',
      trigger: { kind: 'link', elementId: elementId(3, 19) },
      sourceTransitionIds: [`trans_${UUID_PREFIX}000000000010`],
      provenance: derived(SCREEN_PRICING, 'Pricing → contact via the Choose Team CTA.'),
    },
  ],
  storage: [
    {
      id: `store_${UUID_PREFIX}000000000001`,
      key: 'newsletter-email',
      storage: 'cookie',
      entityFieldNames: ['email'],
      writtenOn: [NAV_05],
      sourceEntityIds: [`ent_${UUID_PREFIX}000000000001`],
      provenance: derived(SCREEN_NEWSLETTER_SUCCESS, 'The observed newsletter subscription persistence (cookie flavor).'),
    },
    {
      id: `store_${UUID_PREFIX}000000000002`,
      key: 'contact-last-topic',
      storage: 'localStorage',
      entityFieldNames: ['topic'],
      writtenOn: [NAV_06],
      sourceEntityIds: [`ent_${UUID_PREFIX}000000000002`],
      provenance: derived(SCREEN_CONTACT_SUCCESS, 'The observed last-contact-topic persistence (localStorage flavor).'),
    },
  ],
  api: { endpoints: [], mocks: [] },
  acceptance: [
    {
      id: `acc_${UUID_PREFIX}000000000001`,
      journeyId: 'journey_693afe48-c999-4e31-8328-ec1bd92d9780',
      purpose: 'Fill and submit the b01 contact form, land on the success page, return home.',
      steps: [
        'Navigate to /contact.html',
        'Assert the contact heading is visible',
        'Fill Your name with Ada Lovelace',
        'Fill the email field with ada@example.net',
        'Fill the message field with Hello from the b01 corpus.',
        'Click the Send message submit button',
        'Assert the contact success confirmation is visible',
        'Click the Back to home link',
        'Assert the home hero heading is visible',
      ],
      expectedRoute: '/',
      mustSeeElementIds: [GOLDEN_ELEMENT_IDS.homeHeroHeading],
      sourceJourneyIds: ['journey_693afe48-c999-4e31-8328-ec1bd92d9780'],
      provenance: derived(SCREEN_CONTACT, 'The seeded b01 contact round-trip journey.'),
    },
    {
      id: `acc_${UUID_PREFIX}000000000002`,
      journeyId: 'journey_3a803288-80fa-48d1-8cff-274d36bcc857',
      purpose: 'Tour the b01 media assets and both Features links (main nav and footer nav).',
      steps: [
        'Navigate to the home page',
        'Assert the logo image is visible',
        'Assert the hero illustration is visible',
        'Wait 25ms',
        'Click the first Features link (main navigation)',
        'Assert the features heading is visible',
        'Assert the logo image is visible',
        'Click the second Features link (footer navigation)',
        'Assert the features heading is visible',
        'Assert the footer is visible',
      ],
      expectedRoute: '/features.html',
      mustSeeElementIds: [GOLDEN_ELEMENT_IDS.featuresHeading, GOLDEN_ELEMENT_IDS.featuresFooter],
      sourceJourneyIds: ['journey_3a803288-80fa-48d1-8cff-274d36bcc857'],
      provenance: derived(SCREEN_FEATURES, 'The seeded b01 media and assets tour journey.'),
    },
    {
      id: `acc_${UUID_PREFIX}000000000003`,
      journeyId: 'journey_5bee1e16-86b8-4447-8c9e-26ee583a341a',
      purpose: 'Walk the b01 main navigation across every page.',
      steps: [
        'Navigate to the home page',
        'Assert the main navigation is visible',
        'Click the Features navigation link',
        'Assert the features heading is visible',
        'Click the first Pricing link',
        'Assert the pricing heading is visible',
        'Click the Home navigation link',
        'Assert the home hero heading is visible',
        'Click the first Contact link',
        'Assert the contact heading is visible',
        'Wait 25ms',
      ],
      expectedRoute: '/contact.html',
      mustSeeElementIds: [GOLDEN_ELEMENT_IDS.contactHeading],
      sourceJourneyIds: ['journey_5bee1e16-86b8-4447-8c9e-26ee583a341a'],
      provenance: derived(SCREEN_HOME, 'The seeded b01 navigation walkthrough journey.'),
    },
    {
      id: `acc_${UUID_PREFIX}000000000004`,
      journeyId: 'journey_05441478-5197-4c92-b553-b66ea11b84c3',
      purpose: 'Subscribe to the b01 newsletter by pressing Enter in the email field.',
      steps: [
        'Navigate to the home page',
        'Fill the newsletter email field with subscriber@example.org',
        'Press Enter to submit the newsletter form',
        'Assert the newsletter success confirmation is visible',
        'Wait 10ms',
      ],
      expectedRoute: '/newsletter-success.html',
      mustSeeElementIds: [GOLDEN_ELEMENT_IDS.newsletterSuccessHeading],
      sourceJourneyIds: ['journey_05441478-5197-4c92-b553-b66ea11b84c3'],
      provenance: derived(SCREEN_NEWSLETTER_SUCCESS, 'The seeded b01 newsletter subscribe journey.'),
    },
  ],
  server: {
    startCommand: 'bun server.ts',
    port: 4531,
    healthPath: '/',
  },
  assumptions: [],
  constraints: [
    'Preserve observed data-testid attributes exactly.',
    'Forms submit as plain GET requests to their action route.',
    'No client-side scripting beyond the declared storage writes.',
  ],
};
