/**
 * @clapp/diffext — the golden b01-shaped SynthesisPlan fixture (CLAPP-041).
 *
 * A hand-constructed plan literal that mirrors the bench-b01 corpus
 * (packages/journey/fixtures/b01) — the SAME corpus truth the P3 workers
 * encoded (codegen's and gentests' golden plans): 6 routes, the exact nav
 * testids (nav-home/nav-features/nav-pricing/nav-contact), the exact
 * heading texts, the exact image alts, one footer (contentinfo) per page,
 * TWO links named "Features" per page (main nav + footer nav — the seeded
 * media journey selects them by nth 0/1), the contact form
 * (name/email/topic/message → contact-success) and the footer newsletter
 * form (email → newsletter-success), both GET.
 *
 * PLUS the diffext network fixture: a planned api section with TWO
 * endpoints — one MOCKED (GET /api/notes → 200 + sentinel body) and one
 * UNMOCKED (GET /api/items/:id → 501 naming the endpoint id), the pair
 * that pins every network-dimension verdict rule (matched+mocked,
 * matched+unmocked, wrong-method 405, unknown 404).
 *
 * buildGoldenPlan(mutations?) is DETERMINISTIC: the same mutations always
 * produce the byte-same plan (uuid-v4-SHAPED placeholder ids assigned by
 * index — a fixture, not a planner output; @clapp/plan mints real ids).
 * The mutation hooks exist for the visual battery (heading-text change,
 * footer-copyright removal) so tests derive mutated candidates from the
 * same corpus truth instead of hand-editing generated files.
 *
 * HONEST NOTES:
 * - evidenceRefs are structural stand-ins (sha256 of 64 zeros) — same
 *   convention as the P3 golden fixtures.
 * - the api section is a SYNTHESIS CHOICE (b01 carries no APIs — the
 *   corpus-symmetry battery proves that honestly against the real
 *   fixture server); the endpoints exist so the network dimension's
 *   killer acceptance is non-vacuous.
 */

import type { EvidenceRef } from '@clapp/core';
import type {
  MockResponse,
  PlannedAcceptance,
  PlannedApiEndpoint,
  PlannedElement,
  PlannedForm,
  PlannedPage,
  PlannedRoute,
  PlannedStorageBinding,
  PlannedTransition,
  PlanProvenance,
  SynthesisPlan,
} from '@clapp/plan';

const UUID = '00000000-0000-4000-8000-';

const pad = (value: number, width = 12): string => String(value).padStart(width, '0');

let evidenceCounter = 0;

/** Placeholder evidence ref (fixture convention — see module doc). */
function evRef(): EvidenceRef {
  evidenceCounter += 1;
  return {
    evidenceId: `ev_${UUID}${pad(evidenceCounter)}`,
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

// ---- corpus screens (IR screen ids the b01 corpus was modeled as) -----------

const SCREEN_HOME = `screen_${UUID}000000000001`;
const SCREEN_FEATURES = `screen_${UUID}000000000002`;
const SCREEN_PRICING = `screen_${UUID}000000000003`;
const SCREEN_CONTACT = `screen_${UUID}000000000004`;
const SCREEN_CONTACT_SUCCESS = `screen_${UUID}000000000005`;
const SCREEN_NEWSLETTER_SUCCESS = `screen_${UUID}000000000006`;

/** el_…{page:02}{seq:03} — deterministic, rebuild-stable. */
function elementId(page: number, seq: number): string {
  return `el_${UUID}${'0'.repeat(7)}${String(page).padStart(2, '0')}${String(seq).padStart(3, '0')}`;
}

const HOME_PAGE_ID = `page_${UUID}000000000001`;
const FEATURES_PAGE_ID = `page_${UUID}000000000002`;
const PRICING_PAGE_ID = `page_${UUID}000000000003`;
const CONTACT_PAGE_ID = `page_${UUID}000000000004`;
const CONTACT_SUCCESS_PAGE_ID = `page_${UUID}000000000005`;
const NEWSLETTER_SUCCESS_PAGE_ID = `page_${UUID}000000000006`;

const ROUTE_HOME = `route_${UUID}000000000001`;
const ROUTE_FEATURES = `route_${UUID}000000000002`;
const ROUTE_PRICING = `route_${UUID}000000000003`;
const ROUTE_CONTACT = `route_${UUID}000000000004`;
const ROUTE_CONTACT_SUCCESS = `route_${UUID}000000000005`;
const ROUTE_NEWSLETTER_SUCCESS = `route_${UUID}000000000006`;

const CONTACT_FORM_ID = `form_${UUID}0000000000f1`;
const NEWSLETTER_FORM_ID = `form_${UUID}0000000000f2`;

/** The two api endpoints + one mock — the diffext network fixture. */
export const API_NOTES_ID = `api_${UUID}0000000000a1`;
export const API_ITEMS_ID = `api_${UUID}0000000000a2`;
export const MOCK_NOTES_ID = `mock_${UUID}0000000000m1`;

/** Sentinel body value — unique string the mutation tests target safely. */
export const GOLDEN_MOCK_SENTINEL = 'diffext-golden-mock';

// ---- element builders ---------------------------------------------------------

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
  return {
    id: elementId(page, seq),
    ...init,
    provenance: derived(screenId, `Renders the observed b01 ${init.kind} from ${screenId}.`),
  };
}

function elPlanned(page: number, seq: number, init: ElementInit, rationale: string): PlannedElement {
  return { id: elementId(page, seq), ...init, provenance: planned(rationale) };
}

/** Shared page header: banner → logo link, logo image, nav Main + 4 testid links. */
function headerBlock(page: number, screenId: string): PlannedElement[] {
  const navLink = (seq: number, testId: string, text: string, href: string): PlannedElement =>
    el(page, seq, screenId, { kind: 'link', testId, text, href });
  return [
    elPlanned(page, 1, { kind: 'other', role: 'banner' }, 'Page header landmark — synthesis container.'),
    el(page, 2, screenId, { kind: 'link', testId: 'logo-link', name: 'Nimbus Notes home', text: 'Nimbus Notes', href: '/' }),
    el(page, 3, screenId, { kind: 'image', alt: 'Nimbus Notes logo' }),
    el(page, 4, screenId, { kind: 'navigation', name: 'Main' }),
    navLink(5, 'nav-home', 'Home', '/'),
    navLink(6, 'nav-features', 'Features', '/features.html'),
    navLink(7, 'nav-pricing', 'Pricing', '/pricing.html'),
    navLink(8, 'nav-contact', 'Contact', '/contact.html'),
    elPlanned(page, 9, { kind: 'other', role: 'main' }, 'Main content landmark — synthesis container.'),
  ];
}

/** Shared page footer: contentinfo → nav Footer + 4 links, newsletter form, copyright. */
function footerBlock(page: number, screenId: string, startSeq: number, includeCopyright: boolean): PlannedElement[] {
  const seq = { value: startSeq };
  const next = (): number => {
    const current = seq.value;
    seq.value += 1;
    return current;
  };
  const plainLink = (text: string, href: string): PlannedElement => el(page, next(), screenId, { kind: 'link', text, href });
  const elements: PlannedElement[] = [
    elPlanned(page, next(), { kind: 'other', role: 'contentinfo' }, 'Page footer landmark — synthesis container.'),
    el(page, next(), screenId, { kind: 'navigation', name: 'Footer' }),
    plainLink('Home', '/'),
    plainLink('Features', '/features.html'),
    plainLink('Pricing', '/pricing.html'),
    plainLink('Contact', '/contact.html'),
    el(page, next(), screenId, { kind: 'form', formId: NEWSLETTER_FORM_ID }),
  ];
  if (includeCopyright) {
    elements.push(
      el(page, next(), screenId, { kind: 'text', text: '© 2026 Nimbus Notes. A CLAPP b01 benchmark fixture.' }),
    );
  }
  return elements;
}

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

// ---- mutation hooks ------------------------------------------------------------

/** Deterministic mutations the visual battery derives from the golden truth. */
export interface GoldenPlanMutations {
  /** Replaces the hero heading text (text-only visual divergence). */
  heroHeadingText?: string;
  /** Removes the footer copyright paragraph (postcondition-region loss). */
  removeFooterCopyright?: boolean;
}

// ---- the builder ----------------------------------------------------------------

/** Builds the golden plan (deterministic; identical input → identical plan). */
export function buildGoldenPlan(mutations: GoldenPlanMutations = {}): SynthesisPlan {
  // Evidence ids are rebuild-stable: every build starts the placeholder
  // counter from zero, so the same mutations always yield the same plan.
  evidenceCounter = 0;
  const heroHeading = mutations.heroHeadingText ?? 'Capture every idea, calmly';
  const includeCopyright = !mutations.removeFooterCopyright;

  const homePage: PlannedPage = {
    id: HOME_PAGE_ID,
    routeId: ROUTE_HOME,
    title: 'Capture every idea, calmly — Nimbus Notes',
    elements: [
      ...headerBlock(1, SCREEN_HOME),
      el(1, 10, SCREEN_HOME, { kind: 'heading', level: 1, testId: 'hero-heading', text: heroHeading }),
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
      ...footerBlock(1, SCREEN_HOME, 23, includeCopyright),
    ],
    forms: [NEWSLETTER_FORM],
    provenance: derived(SCREEN_HOME, 'The b01 home page (index.html) as observed.'),
  };

  const featuresPage: PlannedPage = {
    id: FEATURES_PAGE_ID,
    routeId: ROUTE_FEATURES,
    title: 'Features — Nimbus Notes',
    elements: [
      ...headerBlock(2, SCREEN_FEATURES),
      el(2, 10, SCREEN_FEATURES, { kind: 'heading', level: 1, testId: 'features-heading', text: 'Everything you need to stay organized' }),
      el(2, 11, SCREEN_FEATURES, { kind: 'text', text: 'Four capabilities, no sprawling admin console. Each one earns its place.' }),
      el(2, 12, SCREEN_FEATURES, { kind: 'heading', level: 2, text: 'Fast capture' }),
      el(2, 13, SCREEN_FEATURES, { kind: 'text', text: 'A new note is one keystroke away, from anywhere in the app. Titles are optional; everything is searchable the moment it exists.' }),
      el(2, 14, SCREEN_FEATURES, { kind: 'heading', level: 2, text: 'Smart linking' }),
      el(2, 15, SCREEN_FEATURES, { kind: 'text', text: 'Notes mention each other with plain links. Backlinks assemble themselves, and the graph view stays readable even at a thousand notes.' }),
      el(2, 16, SCREEN_FEATURES, { kind: 'heading', level: 2, text: 'Calm collaboration' }),
      el(2, 17, SCREEN_FEATURES, { kind: 'text', text: 'Share a space, mention a teammate, move on. No activity flood, ever.' }),
      el(2, 18, SCREEN_FEATURES, { kind: 'heading', level: 2, text: 'Offline first' }),
      el(2, 19, SCREEN_FEATURES, { kind: 'text', text: 'Everything syncs when you are back online — no spinners while you think.' }),
      el(2, 20, SCREEN_FEATURES, { kind: 'link', testId: 'features-cta', text: 'Talk to us', href: '/contact.html' }),
      ...footerBlock(2, SCREEN_FEATURES, 21, includeCopyright),
    ],
    forms: [NEWSLETTER_FORM],
    provenance: derived(SCREEN_FEATURES, 'The b01 features page (features.html) as observed.'),
  };

  const pricingPage: PlannedPage = {
    id: PRICING_PAGE_ID,
    routeId: ROUTE_PRICING,
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
      ...footerBlock(3, SCREEN_PRICING, 29, includeCopyright),
    ],
    forms: [NEWSLETTER_FORM],
    provenance: derived(SCREEN_PRICING, 'The b01 pricing page (pricing.html) as observed.'),
  };

  const contactPage: PlannedPage = {
    id: CONTACT_PAGE_ID,
    routeId: ROUTE_CONTACT,
    title: 'Contact — Nimbus Notes',
    elements: [
      ...headerBlock(4, SCREEN_CONTACT),
      el(4, 10, SCREEN_CONTACT, { kind: 'heading', level: 1, testId: 'contact-heading', text: "We'd love to hear from you" }),
      el(4, 11, SCREEN_CONTACT, { kind: 'text', text: 'Questions, support, or sales — one form, no ticket maze.' }),
      el(4, 12, SCREEN_CONTACT, { kind: 'form', testId: 'contact-form', formId: CONTACT_FORM_ID }),
      el(4, 13, SCREEN_CONTACT, { kind: 'heading', level: 2, text: 'Other ways to reach us' }),
      el(4, 14, SCREEN_CONTACT, { kind: 'text', text: 'Write to hello@nimbusnotes.example any time. We reply within two business days.' }),
      ...footerBlock(4, SCREEN_CONTACT, 15, includeCopyright),
    ],
    forms: [CONTACT_FORM, NEWSLETTER_FORM],
    provenance: derived(SCREEN_CONTACT, 'The b01 contact page (contact.html) as observed.'),
  };

  const contactSuccessPage: PlannedPage = {
    id: CONTACT_SUCCESS_PAGE_ID,
    routeId: ROUTE_CONTACT_SUCCESS,
    title: 'Thanks for reaching out! — Nimbus Notes',
    elements: [
      ...headerBlock(5, SCREEN_CONTACT_SUCCESS),
      el(5, 10, SCREEN_CONTACT_SUCCESS, { kind: 'heading', level: 1, testId: 'contact-success', text: 'Thanks for reaching out!' }),
      el(5, 11, SCREEN_CONTACT_SUCCESS, { kind: 'text', text: "We'll get back to you within two business days." }),
      el(5, 12, SCREEN_CONTACT_SUCCESS, { kind: 'link', testId: 'back-home', text: 'Back to home', href: '/' }),
      ...footerBlock(5, SCREEN_CONTACT_SUCCESS, 13, includeCopyright),
    ],
    forms: [NEWSLETTER_FORM],
    provenance: derived(SCREEN_CONTACT_SUCCESS, 'The b01 contact-success page (contact-success.html) as observed.'),
  };

  const newsletterSuccessPage: PlannedPage = {
    id: NEWSLETTER_SUCCESS_PAGE_ID,
    routeId: ROUTE_NEWSLETTER_SUCCESS,
    title: "You're on the list! — Nimbus Notes",
    elements: [
      ...headerBlock(6, SCREEN_NEWSLETTER_SUCCESS),
      el(6, 10, SCREEN_NEWSLETTER_SUCCESS, { kind: 'heading', level: 1, testId: 'newsletter-success', text: "You're on the list!" }),
      el(6, 11, SCREEN_NEWSLETTER_SUCCESS, { kind: 'text', text: 'Look out for a short hello from us once a month. No spam, and you can unsubscribe any time.' }),
      el(6, 12, SCREEN_NEWSLETTER_SUCCESS, { kind: 'link', testId: 'back-home', text: 'Back to home', href: '/' }),
      ...footerBlock(6, SCREEN_NEWSLETTER_SUCCESS, 13, includeCopyright),
    ],
    forms: [NEWSLETTER_FORM],
    provenance: derived(SCREEN_NEWSLETTER_SUCCESS, 'The b01 newsletter-success page (newsletter-success.html) as observed.'),
  };

  const routes: PlannedRoute[] = [
    { id: ROUTE_HOME, path: '/', pageId: HOME_PAGE_ID, provenance: derived(SCREEN_HOME, 'The observed b01 route /.') },
    { id: ROUTE_FEATURES, path: '/features.html', pageId: FEATURES_PAGE_ID, provenance: derived(SCREEN_FEATURES, 'The observed b01 route /features.html.') },
    { id: ROUTE_PRICING, path: '/pricing.html', pageId: PRICING_PAGE_ID, provenance: derived(SCREEN_PRICING, 'The observed b01 route /pricing.html.') },
    { id: ROUTE_CONTACT, path: '/contact.html', pageId: CONTACT_PAGE_ID, provenance: derived(SCREEN_CONTACT, 'The observed b01 route /contact.html.') },
    { id: ROUTE_CONTACT_SUCCESS, path: '/contact-success.html', pageId: CONTACT_SUCCESS_PAGE_ID, provenance: derived(SCREEN_CONTACT_SUCCESS, 'The observed b01 route /contact-success.html.') },
    { id: ROUTE_NEWSLETTER_SUCCESS, path: '/newsletter-success.html', pageId: NEWSLETTER_SUCCESS_PAGE_ID, provenance: derived(SCREEN_NEWSLETTER_SUCCESS, 'The observed b01 route /newsletter-success.html.') },
  ];

  const navigation: PlannedTransition[] = [
    {
      id: `nav_${UUID}000000000001`,
      fromRouteId: ROUTE_HOME,
      toRouteId: ROUTE_FEATURES,
      trigger: { kind: 'link', elementId: elementId(1, 6) },
      sourceTransitionIds: [`trans_${UUID}000000000001`],
      provenance: derived(SCREEN_HOME, 'Home → features via the main nav Features link.'),
    },
    {
      id: `nav_${UUID}000000000002`,
      fromRouteId: ROUTE_HOME,
      toRouteId: ROUTE_PRICING,
      trigger: { kind: 'link', elementId: elementId(1, 7) },
      sourceTransitionIds: [`trans_${UUID}000000000002`],
      provenance: derived(SCREEN_HOME, 'Home → pricing via the main nav Pricing link.'),
    },
    {
      id: `nav_${UUID}000000000003`,
      fromRouteId: ROUTE_HOME,
      toRouteId: ROUTE_CONTACT,
      trigger: { kind: 'link', elementId: elementId(1, 8) },
      sourceTransitionIds: [`trans_${UUID}000000000003`],
      provenance: derived(SCREEN_HOME, 'Home → contact via the main nav Contact link.'),
    },
    {
      id: `nav_${UUID}000000000004`,
      fromRouteId: ROUTE_HOME,
      toRouteId: ROUTE_NEWSLETTER_SUCCESS,
      trigger: { kind: 'form-submit', formId: NEWSLETTER_FORM_ID },
      sourceTransitionIds: [`trans_${UUID}000000000004`],
      provenance: derived(SCREEN_HOME, 'Home → newsletter-success via the footer newsletter form (GET submit / Enter).'),
    },
    {
      id: `nav_${UUID}000000000005`,
      fromRouteId: ROUTE_CONTACT,
      toRouteId: ROUTE_CONTACT_SUCCESS,
      trigger: { kind: 'form-submit', formId: CONTACT_FORM_ID },
      sourceTransitionIds: [`trans_${UUID}000000000005`],
      provenance: derived(SCREEN_CONTACT, 'Contact → contact-success via the contact form submit.'),
    },
    {
      id: `nav_${UUID}000000000006`,
      fromRouteId: ROUTE_CONTACT_SUCCESS,
      toRouteId: ROUTE_HOME,
      trigger: { kind: 'link', elementId: elementId(5, 12) },
      sourceTransitionIds: [`trans_${UUID}000000000006`],
      provenance: derived(SCREEN_CONTACT_SUCCESS, 'Contact-success → home via the Back to home link.'),
    },
    {
      id: `nav_${UUID}000000000007`,
      fromRouteId: ROUTE_NEWSLETTER_SUCCESS,
      toRouteId: ROUTE_HOME,
      trigger: { kind: 'link', elementId: elementId(6, 12) },
      sourceTransitionIds: [`trans_${UUID}000000000007`],
      provenance: derived(SCREEN_NEWSLETTER_SUCCESS, 'Newsletter-success → home via the Back to home link.'),
    },
  ];

  const storage: PlannedStorageBinding[] = [];

  const endpoints: PlannedApiEndpoint[] = [
    {
      id: API_NOTES_ID,
      method: 'GET',
      urlPattern: '/api/notes',
      sourceOperationIds: [`op_${UUID}0000000000a1`],
      provenance: planned('Synthesis choice: a MOCKED endpoint so the network dimension is non-vacuous (b01 has no APIs).'),
    },
    {
      id: API_ITEMS_ID,
      method: 'GET',
      urlPattern: '/api/items/:id',
      sourceOperationIds: [`op_${UUID}0000000000a2`],
      provenance: planned('Synthesis choice: an UNMOCKED parameterized endpoint pinning the 501 + ":id" segment semantics (b01 has no APIs).'),
    },
  ];

  const mocks: MockResponse[] = [
    {
      id: MOCK_NOTES_ID,
      endpointId: API_NOTES_ID,
      statusCode: 200,
      bodyJson: {
        ok: true,
        source: GOLDEN_MOCK_SENTINEL,
        notes: [
          { id: 'n1', title: 'First note' },
          { id: 'n2', title: 'Second note' },
        ],
      },
    },
  ];

  const acceptance: PlannedAcceptance[] = [
    {
      id: `acc_${UUID}000000000001`,
      journeyId: 'journey_5bee1e16-86b8-4447-8c9e-26ee583a341a',
      purpose: 'Walk the main navigation: home → features → pricing → home → contact',
      steps: ['navigate /', 'assert Main nav', 'click nav-features', 'assert features heading', 'click Pricing', 'assert pricing heading', 'click Home', 'assert hero heading', 'click Contact', 'assert contact heading', 'wait'],
      expectedRoute: '/contact.html',
      mustSeeElementIds: [elementId(4, 10)],
      sourceJourneyIds: ['journey_5bee1e16-86b8-4447-8c9e-26ee583a341a'],
      provenance: planned('Derived from the seeded b01-nav journey record.'),
    },
    {
      id: `acc_${UUID}000000000002`,
      journeyId: 'journey_3a803288-80fa-48d1-8cff-274d36bcc857',
      purpose: 'Verify media assets: logo and hero illustration, then footer navigation',
      steps: ['navigate /', 'assert logo image', 'assert hero illustration', 'wait', 'click Features (nth 0)', 'assert features heading', 'assert logo image', 'click Features (nth 1)', 'assert features heading', 'assert footer'],
      expectedRoute: '/features.html',
      mustSeeElementIds: [elementId(2, 10)],
      sourceJourneyIds: ['journey_3a803288-80fa-48d1-8cff-274d36bcc857'],
      provenance: planned('Derived from the seeded b01-media journey record.'),
    },
    {
      id: `acc_${UUID}000000000003`,
      journeyId: 'journey_05441478-5197-4c92-b553-b66ea11b84c3',
      purpose: 'Subscribe to the newsletter by pressing Enter in the email field',
      steps: ['navigate /', 'fill Email address', 'press Enter', 'assert newsletter success heading', 'wait'],
      expectedRoute: '/newsletter-success.html',
      mustSeeElementIds: [elementId(6, 10)],
      sourceJourneyIds: ['journey_05441478-5197-4c92-b553-b66ea11b84c3'],
      provenance: planned('Derived from the seeded b01-newsletter journey record.'),
    },
    {
      id: `acc_${UUID}000000000004`,
      journeyId: 'journey_693afe48-c999-4e31-8328-ec1bd92d9780',
      purpose: 'Contact form round-trip: fill every field and submit',
      steps: ['navigate /contact.html', 'assert contact heading', 'fill name/email/message', 'submit', 'assert contact success'],
      expectedRoute: '/contact-success.html',
      mustSeeElementIds: [elementId(5, 10)],
      sourceJourneyIds: ['journey_693afe48-c999-4e31-8328-ec1bd92d9780'],
      provenance: planned('Derived from the seeded b01-contact journey record.'),
    },
  ];

  return {
    planVersion: '0.1',
    application: {
      id: `appsyn_${UUID}0000000000d1`,
      name: 'Nimbus Notes',
      platform: 'web',
      sourceModelId: `app_${UUID}0000000000d1`,
      entrypoints: ['/'],
    },
    routes,
    pages: [homePage, featuresPage, pricingPage, contactPage, contactSuccessPage, newsletterSuccessPage],
    navigation,
    storage,
    api: { endpoints, mocks },
    acceptance,
    server: {
      startCommand: 'bun server.ts',
      port: 4533,
      healthPath: '/',
    },
    assumptions: [
      'The api section (GET /api/notes mocked, GET /api/items/:id unmocked) is a synthesis choice: the bench-b01 corpus carries no APIs, and the diffext network dimension requires a non-vacuous api baseline.',
      'The footer copyright line is carried on every page as observed in the corpus.',
    ],
    constraints: [
      'Journey targets must resolve by the exact observed testids and accessible names.',
      'The mock body carries the diffext-golden-mock sentinel so mutation probes can target it deterministically.',
    ],
  };
}

/** The canonical golden plan (no mutations). */
export const GOLDEN_B01_PLAN: SynthesisPlan = buildGoldenPlan();

/** Element ids the tests anchor findings with (plan-id vocabulary). */
export const GOLDEN_ELEMENT_IDS = {
  heroHeading: elementId(1, 10),
  featuresHeading: elementId(2, 10),
  contactHeading: elementId(4, 10),
  contactSuccessHeading: elementId(5, 10),
  newsletterSuccessHeading: elementId(6, 10),
} as const;
