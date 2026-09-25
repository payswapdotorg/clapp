/**
 * @clapp/gentests — the b01-shaped GOLDEN PLAN fixture (CLAPP-032).
 *
 * This is the killer-acceptance fixture: a SynthesisPlan literal that
 * mirrors the bench-b01 corpus (@clapp/journey fixtures/b01) closely
 * enough that ALL FOUR seeded b01 journey records replay against a
 * candidate built from it:
 *
 * - 6 routes: /, /features.html, /pricing.html, /contact.html,
 *   /contact-success.html, /newsletter-success.html (the corpus file paths
 *   are the route paths — the seeded journeys navigate to "/contact.html"
 *   and their links resolve to exactly these paths);
 * - the exact b01 nav testids (logo-link, nav-toggle, nav-home,
 *   nav-features, nav-pricing, nav-contact, hero-…, plan-…-cta,
 *   contact-…, newsletter-…, back-home, contact-form …);
 * - the EXACT b01 heading texts, image alt texts (role img), the footer
 *   (role contentinfo), and MULTIPLE links named "Features" so the seeded
 *   nth-based selectors are exercised;
 * - the contact + newsletter forms exactly as the corpus declares them
 *   (both GET, submitting to the success pages).
 *
 * Honesty notes:
 * - Fixture ids use readable suffixes instead of uuid v4 (the contract
 *   types are plain strings; the uuid convention is the planner's runtime
 *   concern, not a test fixture's).
 * - 'derived' provenance cites the corpus page bytes by their REAL
 *   sha256 (computed here, from the frozen corpus files) so the evidence
 *   refs are genuine, not fabricated hashes; api endpoints and the server
 *   spec are honest 'planned' synthesis choices (b01 has no APIs).
 * - The element model is FLAT document order (the plan contract has no
 *   containment), matching the conforming server's rendering contract.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sha256Hex, type EvidenceRef } from '@clapp/core';
import { resolveFixtureRoot, resolveSeededJourneysDir, validateJourney, type Journey } from '@clapp/journey';
import type {
  PlannedElement,
  PlannedForm,
  PlannedPage,
  SynthesisPlan,
} from './synthesis-contract';

/** Loads a seeded b01 journey record and validates it structurally. */
async function loadJourney(name: string): Promise<Journey> {
  const path = join(resolveSeededJourneysDir(), name);
  const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
  if (!validateJourney(parsed)) {
    throw new Error(`golden-plan: seeded journey ${name} failed structural validation`);
  }
  return parsed;
}

/** The four SEEDED b01 journey records (the acceptance test supply). */
export async function loadSeededB01Journeys(): Promise<Journey[]> {
  return [
    await loadJourney('b01-nav.json'),
    await loadJourney('b01-media.json'),
    await loadJourney('b01-newsletter.json'),
    await loadJourney('b01-contact.json'),
  ];
}

// ---------------------------------------------------------------------------
// Provenance helpers
// ---------------------------------------------------------------------------

/** Real sha256 of a frozen corpus page (genuine evidence, not fabricated). */
async function corpusRef(file: string, evidenceId: string): Promise<EvidenceRef> {
  const bytes = await readFile(join(resolveFixtureRoot(), file), 'utf8');
  return { evidenceId, kind: 'static', sha256: await sha256Hex(bytes) };
}

/** The golden plan's port (overridable via createConformingServer opts). */
export const GOLDEN_PLAN_PORT = 46230;

// ---------------------------------------------------------------------------
// Element builders (ids are el_<pageKey>_<suffix>)
// ---------------------------------------------------------------------------

const el = (pageKey: string, suffix: string): string => `el_${pageKey}_${suffix}`;

function headerElements(pageKey: string, ref: EvidenceRef): PlannedElement[] {
  const provenance = {
    level: 'derived' as const,
    rationale: 'Mirrors the b01 site header: logo link, nav toggle, and the main navigation.',
    sourceIds: [`screen_${pageKey}`],
    evidenceRefs: [ref],
  };
  return [
    {
      id: el(pageKey, 'logo_link'),
      kind: 'link',
      role: 'link',
      name: 'Nimbus Notes home',
      text: 'Nimbus Notes',
      href: '/',
      testId: 'logo-link',
      provenance,
    },
    {
      id: el(pageKey, 'logo_img'),
      kind: 'image',
      role: 'img',
      name: 'Nimbus Notes logo',
      alt: 'Nimbus Notes logo',
      provenance,
    },
    {
      id: el(pageKey, 'nav_toggle'),
      kind: 'button',
      role: 'button',
      name: 'Toggle navigation menu',
      testId: 'nav-toggle',
      provenance,
    },
    {
      id: el(pageKey, 'nav'),
      kind: 'navigation',
      role: 'navigation',
      name: 'Main',
      provenance,
    },
    {
      id: el(pageKey, 'nav_home'),
      kind: 'link',
      role: 'link',
      name: 'Home',
      text: 'Home',
      href: '/',
      testId: 'nav-home',
      provenance,
    },
    {
      id: el(pageKey, 'nav_features'),
      kind: 'link',
      role: 'link',
      name: 'Features',
      text: 'Features',
      href: '/features.html',
      testId: 'nav-features',
      provenance,
    },
    {
      id: el(pageKey, 'nav_pricing'),
      kind: 'link',
      role: 'link',
      name: 'Pricing',
      text: 'Pricing',
      href: '/pricing.html',
      testId: 'nav-pricing',
      provenance,
    },
    {
      id: el(pageKey, 'nav_contact'),
      kind: 'link',
      role: 'link',
      name: 'Contact',
      text: 'Contact',
      href: '/contact.html',
      testId: 'nav-contact',
      provenance,
    },
    {
      id: el(pageKey, 'header'),
      kind: 'other',
      role: 'banner',
      provenance,
    },
  ];
}

function footerElements(pageKey: string, ref: EvidenceRef): PlannedElement[] {
  const provenance = {
    level: 'derived' as const,
    rationale: 'Mirrors the b01 footer: navigation, the newsletter form (GET), and its heading.',
    sourceIds: [`screen_${pageKey}`],
    evidenceRefs: [ref],
  };
  return [
    {
      id: el(pageKey, 'footer'),
      kind: 'other',
      role: 'contentinfo',
      provenance,
    },
    {
      id: el(pageKey, 'foot_nav'),
      kind: 'navigation',
      role: 'navigation',
      name: 'Footer',
      provenance,
    },
    {
      id: el(pageKey, 'foot_home'),
      kind: 'link',
      role: 'link',
      name: 'Home',
      text: 'Home',
      href: '/',
      provenance,
    },
    {
      id: el(pageKey, 'foot_features'),
      kind: 'link',
      role: 'link',
      name: 'Features',
      text: 'Features',
      href: '/features.html',
      provenance,
    },
    {
      id: el(pageKey, 'foot_pricing'),
      kind: 'link',
      role: 'link',
      name: 'Pricing',
      text: 'Pricing',
      href: '/pricing.html',
      provenance,
    },
    {
      id: el(pageKey, 'foot_contact'),
      kind: 'link',
      role: 'link',
      name: 'Contact',
      text: 'Contact',
      href: '/contact.html',
      provenance,
    },
    {
      id: el(pageKey, 'newsletter_h2'),
      kind: 'heading',
      role: 'heading',
      name: 'Stay in the loop',
      text: 'Stay in the loop',
      level: 2,
      provenance,
    },
    {
      id: el(pageKey, 'newsletter_form'),
      kind: 'form',
      role: 'form',
      formId: 'form_newsletter',
      provenance,
    },
  ];
}

function mainElement(pageKey: string, ref: EvidenceRef): PlannedElement {
  return {
    id: el(pageKey, 'main'),
    kind: 'other',
    role: 'main',
    provenance: {
      level: 'derived',
      rationale: 'Mirrors the b01 main content landmark.',
      sourceIds: [`screen_${pageKey}`],
      evidenceRefs: [ref],
    },
  };
}

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

export const GOLDEN_NEWSLETTER_FORM: PlannedForm = {
  id: 'form_newsletter',
  action: '/newsletter-success.html',
  method: 'get',
  fields: [
    {
      name: 'email',
      type: 'email',
      label: 'Email address',
      testId: 'newsletter-email',
      required: true,
      placeholder: 'you@example.com',
    },
  ],
  submitLabel: 'Subscribe',
  submitTestId: 'newsletter-submit',
  provenance: {
    level: 'derived',
    rationale: 'The b01 newsletter form: a GET form in the footer submitting to the newsletter success page.',
    sourceIds: ['screen_home'],
    evidenceRefs: [],
  },
};

export const GOLDEN_CONTACT_FORM: PlannedForm = {
  id: 'form_contact',
  action: '/contact-success.html',
  method: 'get',
  fields: [
    { name: 'name', type: 'text', label: 'Your name', testId: 'contact-name', required: true },
    {
      name: 'email',
      type: 'email',
      label: 'Email address',
      testId: 'contact-email',
      required: true,
      placeholder: 'you@example.com',
    },
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
  provenance: {
    level: 'derived',
    rationale: 'The b01 contact form: name, email, topic select, message, GET submit to the contact success page.',
    sourceIds: ['screen_contact'],
    evidenceRefs: [],
  },
};

// ---------------------------------------------------------------------------
// The golden plan
// ---------------------------------------------------------------------------

/**
 * Builds the b01-shaped golden plan. Deterministic: a pure function of the
 * frozen corpus bytes (evidence hashes) and the literals below.
 */
export async function buildGoldenPlan(): Promise<SynthesisPlan> {
  const homeRef = await corpusRef('index.html', 'ev_b01_static_index');
  const featuresRef = await corpusRef('features.html', 'ev_b01_static_features');
  const pricingRef = await corpusRef('pricing.html', 'ev_b01_static_pricing');
  const contactRef = await corpusRef('contact.html', 'ev_b01_static_contact');
  const contactSuccessRef = await corpusRef('contact-success.html', 'ev_b01_static_contact_success');
  const newsletterSuccessRef = await corpusRef('newsletter-success.html', 'ev_b01_static_newsletter_success');

  const pageProvenance = (key: string, rationale: string) => ({
    level: 'derived' as const,
    rationale,
    sourceIds: [`screen_${key}`],
    evidenceRefs: [] as EvidenceRef[],
  });

  const homePage: PlannedPage = {
    id: 'page_home',
    routeId: 'route_home',
    title: 'Capture every idea, calmly — Nimbus Notes',
    provenance: pageProvenance('home', 'Mirrors the b01 corpus home page (fixtures/b01/index.html).'),
    elements: [
      ...headerElements('home', homeRef),
      mainElement('home', homeRef),
      {
        id: el('home', 'h1'),
        kind: 'heading',
        role: 'heading',
        name: 'Capture every idea, calmly',
        text: 'Capture every idea, calmly',
        level: 1,
        testId: 'hero-heading',
        provenance: pageProvenance('home', 'The b01 hero heading, testid and text exactly as observed.'),
      },
      {
        id: el('home', 'lead'),
        kind: 'text',
        text: 'Nimbus Notes is a calm, fast notebook for small teams: quick capture, smart links, and no shouting interfaces.',
        provenance: pageProvenance('home', 'The b01 hero lead paragraph.'),
      },
      {
        id: el('home', 'hero_img'),
        kind: 'image',
        role: 'img',
        name: 'Illustration of notes organized among clouds',
        alt: 'Illustration of notes organized among clouds',
        testId: 'hero-illustration',
        provenance: pageProvenance('home', 'The b01 hero illustration, alt text exactly as observed.'),
      },
      {
        id: el('home', 'cta_get_started'),
        kind: 'link',
        role: 'link',
        name: 'Get started',
        text: 'Get started',
        href: '/contact.html',
        testId: 'cta-get-started',
        provenance: pageProvenance('home', 'The b01 primary call-to-action link.'),
      },
      {
        id: el('home', 'cta_pricing'),
        kind: 'link',
        role: 'link',
        name: 'See pricing',
        text: 'See pricing',
        href: '/pricing.html',
        testId: 'cta-pricing',
        provenance: pageProvenance('home', 'The b01 secondary call-to-action link.'),
      },
      {
        id: el('home', 'teaser_h2'),
        kind: 'heading',
        role: 'heading',
        name: 'Why teams choose Nimbus',
        text: 'Why teams choose Nimbus',
        level: 2,
        provenance: pageProvenance('home', 'The b01 teaser section heading (no testid, as observed).'),
      },
      {
        id: el('home', 'card_h3_fastcapture'),
        kind: 'heading',
        role: 'heading',
        name: 'Fast capture',
        text: 'Fast capture',
        level: 3,
        provenance: pageProvenance('home', 'The b01 teaser card heading.'),
      },
      {
        id: el('home', 'card_text_fastcapture'),
        kind: 'text',
        text: 'A new note is one keystroke away. No modals, no required fields, no ceremony.',
        provenance: pageProvenance('home', 'The b01 teaser card paragraph.'),
      },
      {
        id: el('home', 'card_link_fastcapture'),
        kind: 'link',
        role: 'link',
        name: 'Learn more about fast capture',
        text: 'Learn more',
        href: '/features.html',
        provenance: pageProvenance('home', 'The b01 teaser card link (aria-label named, as observed).'),
      },
      {
        id: el('home', 'card_h3_smartlinking'),
        kind: 'heading',
        role: 'heading',
        name: 'Smart linking',
        text: 'Smart linking',
        level: 3,
        provenance: pageProvenance('home', 'The b01 teaser card heading.'),
      },
      {
        id: el('home', 'card_text_smartlinking'),
        kind: 'text',
        text: 'Notes mention each other with plain links, and the graph keeps itself tidy.',
        provenance: pageProvenance('home', 'The b01 teaser card paragraph.'),
      },
      {
        id: el('home', 'card_link_smartlinking'),
        kind: 'link',
        role: 'link',
        name: 'Learn more about smart linking',
        text: 'Learn more',
        href: '/features.html',
        provenance: pageProvenance('home', 'The b01 teaser card link (aria-label named, as observed).'),
      },
      {
        id: el('home', 'card_h3_calmcollaboration'),
        kind: 'heading',
        role: 'heading',
        name: 'Calm collaboration',
        text: 'Calm collaboration',
        level: 3,
        provenance: pageProvenance('home', 'The b01 teaser card heading.'),
      },
      {
        id: el('home', 'card_text_calmcollaboration'),
        kind: 'text',
        text: 'Share a space, mention a teammate, move on. No activity flood, ever.',
        provenance: pageProvenance('home', 'The b01 teaser card paragraph.'),
      },
      {
        id: el('home', 'card_link_calmcollaboration'),
        kind: 'link',
        role: 'link',
        name: 'Learn more about calm collaboration',
        text: 'Learn more',
        href: '/features.html',
        provenance: pageProvenance('home', 'The b01 teaser card link (aria-label named, as observed).'),
      },
      {
        id: el('home', 'cta_explore'),
        kind: 'link',
        role: 'link',
        name: 'Explore all features',
        text: 'Explore all features',
        href: '/features.html',
        testId: 'cta-explore-features',
        provenance: pageProvenance('home', 'The b01 teaser bottom call-to-action.'),
      },
      ...footerElements('home', homeRef),
    ],
    forms: [GOLDEN_NEWSLETTER_FORM],
  };

  const featuresPage: PlannedPage = {
    id: 'page_features',
    routeId: 'route_features',
    title: 'Features — Nimbus Notes',
    provenance: pageProvenance('features', 'Mirrors the b01 corpus features page (fixtures/b01/features.html).'),
    elements: [
      ...headerElements('features', featuresRef),
      mainElement('features', featuresRef),
      {
        id: el('features', 'h1'),
        kind: 'heading',
        role: 'heading',
        name: 'Everything you need to stay organized',
        text: 'Everything you need to stay organized',
        level: 1,
        testId: 'features-heading',
        provenance: pageProvenance('features', 'The b01 features heading, exact text and testid.'),
      },
      {
        id: el('features', 'lead'),
        kind: 'text',
        text: 'Four capabilities, no sprawling admin console. Each one earns its place.',
        provenance: pageProvenance('features', 'The b01 features lead paragraph.'),
      },
      {
        id: el('features', 'h2_fastcapture'),
        kind: 'heading',
        role: 'heading',
        name: 'Fast capture',
        text: 'Fast capture',
        level: 2,
        provenance: pageProvenance('features', 'The b01 fast-capture section heading.'),
      },
      {
        id: el('features', 'text_fastcapture'),
        kind: 'text',
        text: 'A new note is one keystroke away, from anywhere in the app. Titles are optional; everything is searchable the moment it exists.',
        provenance: pageProvenance('features', 'The b01 fast-capture paragraph.'),
      },
      {
        id: el('features', 'list_fastcapture'),
        kind: 'list',
        role: 'list',
        provenance: pageProvenance('features', 'The b01 fast-capture bullet list (items flattened to text elements).'),
      },
      {
        id: el('features', 'li_shortcut'),
        kind: 'text',
        text: 'Instant note creation with a single shortcut',
        provenance: pageProvenance('features', 'The b01 fast-capture bullet item.'),
      },
      {
        id: el('features', 'li_titles'),
        kind: 'text',
        text: 'Optional titles — first line becomes the title when you want one',
        provenance: pageProvenance('features', 'The b01 fast-capture bullet item.'),
      },
      {
        id: el('features', 'li_indexed'),
        kind: 'text',
        text: 'Everything indexed as you type',
        provenance: pageProvenance('features', 'The b01 fast-capture bullet item.'),
      },
      {
        id: el('features', 'h2_smartlinking'),
        kind: 'heading',
        role: 'heading',
        name: 'Smart linking',
        text: 'Smart linking',
        level: 2,
        provenance: pageProvenance('features', 'The b01 smart-linking section heading.'),
      },
      {
        id: el('features', 'text_smartlinking'),
        kind: 'text',
        text: 'Notes mention each other with plain links. Backlinks assemble themselves, and the graph view stays readable even at a thousand notes.',
        provenance: pageProvenance('features', 'The b01 smart-linking paragraph.'),
      },
      {
        id: el('features', 'h2_calmcollaboration'),
        kind: 'heading',
        role: 'heading',
        name: 'Calm collaboration',
        text: 'Calm collaboration',
        level: 2,
        provenance: pageProvenance('features', 'The b01 calm-collaboration section heading.'),
      },
      {
        id: el('features', 'text_calmcollaboration'),
        kind: 'text',
        text: 'Share a space, mention a teammate, move on. Nimbus shows you what changed since you last looked — not an infinite activity feed.',
        provenance: pageProvenance('features', 'The b01 calm-collaboration paragraph.'),
      },
      {
        id: el('features', 'h2_offlinefirst'),
        kind: 'heading',
        role: 'heading',
        name: 'Offline first',
        text: 'Offline first',
        level: 2,
        provenance: pageProvenance('features', 'The b01 offline-first section heading.'),
      },
      {
        id: el('features', 'text_offlinefirst'),
        kind: 'text',
        text: 'The local copy is the source of truth. Sync happens in the background and reconciles quietly when you reconnect.',
        provenance: pageProvenance('features', 'The b01 offline-first paragraph.'),
      },
      {
        id: el('features', 'cta'),
        kind: 'link',
        role: 'link',
        name: 'Talk to us',
        text: 'Talk to us',
        href: '/contact.html',
        testId: 'features-cta',
        provenance: pageProvenance('features', 'The b01 features bottom call-to-action.'),
      },
      ...footerElements('features', featuresRef),
    ],
    forms: [GOLDEN_NEWSLETTER_FORM],
  };

  const pricingPage: PlannedPage = {
    id: 'page_pricing',
    routeId: 'route_pricing',
    title: 'Pricing — Nimbus Notes',
    provenance: pageProvenance('pricing', 'Mirrors the b01 corpus pricing page (fixtures/b01/pricing.html).'),
    elements: [
      ...headerElements('pricing', pricingRef),
      mainElement('pricing', pricingRef),
      {
        id: el('pricing', 'h1'),
        kind: 'heading',
        role: 'heading',
        name: 'Simple, honest pricing',
        text: 'Simple, honest pricing',
        level: 1,
        testId: 'pricing-heading',
        provenance: pageProvenance('pricing', 'The b01 pricing heading, exact text and testid.'),
      },
      {
        id: el('pricing', 'lead'),
        kind: 'text',
        text: 'Every plan includes the full feature set. You only pay for team size and support depth.',
        provenance: pageProvenance('pricing', 'The b01 pricing lead paragraph.'),
      },
      {
        id: el('pricing', 'h2_starter'),
        kind: 'heading',
        role: 'heading',
        name: 'Starter',
        text: 'Starter',
        level: 2,
        provenance: pageProvenance('pricing', 'The b01 Starter plan heading.'),
      },
      {
        id: el('pricing', 'price_starter'),
        kind: 'text',
        text: '$0 / forever',
        provenance: pageProvenance('pricing', 'The b01 Starter plan price line.'),
      },
      {
        id: el('pricing', 'cta_starter'),
        kind: 'link',
        role: 'link',
        name: 'Choose Starter',
        text: 'Choose Starter',
        href: '/contact.html',
        testId: 'plan-starter-cta',
        provenance: pageProvenance('pricing', 'The b01 Starter plan call-to-action.'),
      },
      {
        id: el('pricing', 'h2_team'),
        kind: 'heading',
        role: 'heading',
        name: 'Team',
        text: 'Team',
        level: 2,
        provenance: pageProvenance('pricing', 'The b01 Team plan heading.'),
      },
      {
        id: el('pricing', 'price_team'),
        kind: 'text',
        text: '$8 / user / month',
        provenance: pageProvenance('pricing', 'The b01 Team plan price line.'),
      },
      {
        id: el('pricing', 'cta_team'),
        kind: 'link',
        role: 'link',
        name: 'Choose Team',
        text: 'Choose Team',
        href: '/contact.html',
        testId: 'plan-team-cta',
        provenance: pageProvenance('pricing', 'The b01 Team plan call-to-action.'),
      },
      {
        id: el('pricing', 'h2_studio'),
        kind: 'heading',
        role: 'heading',
        name: 'Studio',
        text: 'Studio',
        level: 2,
        provenance: pageProvenance('pricing', 'The b01 Studio plan heading.'),
      },
      {
        id: el('pricing', 'price_studio'),
        kind: 'text',
        text: '$15 / user / month',
        provenance: pageProvenance('pricing', 'The b01 Studio plan price line.'),
      },
      {
        id: el('pricing', 'cta_studio'),
        kind: 'link',
        role: 'link',
        name: 'Choose Studio',
        text: 'Choose Studio',
        href: '/contact.html',
        testId: 'plan-studio-cta',
        provenance: pageProvenance('pricing', 'The b01 Studio plan call-to-action.'),
      },
      {
        id: el('pricing', 'h2_faq'),
        kind: 'heading',
        role: 'heading',
        name: 'Frequently asked questions',
        text: 'Frequently asked questions',
        level: 2,
        provenance: pageProvenance('pricing', 'The b01 FAQ section heading.'),
      },
      {
        id: el('pricing', 'h3_freeplan'),
        kind: 'heading',
        role: 'heading',
        name: 'Is there really a free plan?',
        text: 'Is there really a free plan?',
        level: 3,
        provenance: pageProvenance('pricing', 'The b01 FAQ question heading.'),
      },
      {
        id: el('pricing', 'text_freeplan'),
        kind: 'text',
        text: 'Yes — Starter is free forever, with no note limits and no expiring trial.',
        provenance: pageProvenance('pricing', 'The b01 FAQ answer.'),
      },
      {
        id: el('pricing', 'h3_export'),
        kind: 'heading',
        role: 'heading',
        name: 'Can I export my notes?',
        text: 'Can I export my notes?',
        level: 3,
        provenance: pageProvenance('pricing', 'The b01 FAQ question heading.'),
      },
      {
        id: el('pricing', 'text_export'),
        kind: 'text',
        text: 'Always. Every note exports as plain text, and whole workspaces export as a single archive.',
        provenance: pageProvenance('pricing', 'The b01 FAQ answer.'),
      },
      {
        id: el('pricing', 'h3_offline'),
        kind: 'heading',
        role: 'heading',
        name: 'What happens offline?',
        text: 'What happens offline?',
        level: 3,
        provenance: pageProvenance('pricing', 'The b01 FAQ question heading.'),
      },
      {
        id: el('pricing', 'text_offline'),
        kind: 'text',
        text: 'Everything keeps working. Sync resumes when you reconnect, and plain notes merge without conflicts.',
        provenance: pageProvenance('pricing', 'The b01 FAQ answer.'),
      },
      ...footerElements('pricing', pricingRef),
    ],
    forms: [GOLDEN_NEWSLETTER_FORM],
  };

  const contactPage: PlannedPage = {
    id: 'page_contact',
    routeId: 'route_contact',
    title: 'Contact — Nimbus Notes',
    provenance: pageProvenance('contact', 'Mirrors the b01 corpus contact page (fixtures/b01/contact.html).'),
    elements: [
      ...headerElements('contact', contactRef),
      mainElement('contact', contactRef),
      {
        id: el('contact', 'h1'),
        kind: 'heading',
        role: 'heading',
        name: "We'd love to hear from you",
        text: "We'd love to hear from you",
        level: 1,
        testId: 'contact-heading',
        provenance: pageProvenance('contact', 'The b01 contact heading, exact text and testid.'),
      },
      {
        id: el('contact', 'lead'),
        kind: 'text',
        text: 'Questions, support, or sales — one form, no ticket maze.',
        provenance: pageProvenance('contact', 'The b01 contact lead paragraph.'),
      },
      {
        id: el('contact', 'form'),
        kind: 'form',
        role: 'form',
        formId: 'form_contact',
        testId: 'contact-form',
        provenance: pageProvenance('contact', 'The b01 contact form placement (fields declared in the form).'),
      },
      {
        id: el('contact', 'aside_h2'),
        kind: 'heading',
        role: 'heading',
        name: 'Other ways to reach us',
        text: 'Other ways to reach us',
        level: 2,
        provenance: pageProvenance('contact', 'The b01 contact aside heading.'),
      },
      {
        id: el('contact', 'aside_text'),
        kind: 'text',
        text: 'Write to hello@nimbusnotes.example any time.',
        provenance: pageProvenance('contact', 'The b01 contact aside paragraph.'),
      },
      ...footerElements('contact', contactRef),
    ],
    forms: [GOLDEN_CONTACT_FORM, GOLDEN_NEWSLETTER_FORM],
  };

  const contactSuccessPage: PlannedPage = {
    id: 'page_contactsuccess',
    routeId: 'route_contactsuccess',
    title: 'Thanks for reaching out! — Nimbus Notes',
    provenance: pageProvenance(
      'contactsuccess',
      'Mirrors the b01 corpus contact success page (fixtures/b01/contact-success.html).',
    ),
    elements: [
      ...headerElements('contactsuccess', contactSuccessRef),
      mainElement('contactsuccess', contactSuccessRef),
      {
        id: el('contactsuccess', 'h1'),
        kind: 'heading',
        role: 'heading',
        name: 'Thanks for reaching out!',
        text: 'Thanks for reaching out!',
        level: 1,
        testId: 'contact-success',
        provenance: pageProvenance('contactsuccess', 'The b01 contact success heading, exact text and testid.'),
      },
      {
        id: el('contactsuccess', 'text'),
        kind: 'text',
        text: "We'll get back to you within two business days.",
        provenance: pageProvenance('contactsuccess', 'The b01 contact success paragraph.'),
      },
      {
        id: el('contactsuccess', 'back_home'),
        kind: 'link',
        role: 'link',
        name: 'Back to home',
        text: 'Back to home',
        href: '/',
        testId: 'back-home',
        provenance: pageProvenance('contactsuccess', 'The b01 back-to-home link the contact journey clicks.'),
      },
      ...footerElements('contactsuccess', contactSuccessRef),
    ],
    forms: [GOLDEN_NEWSLETTER_FORM],
  };

  const newsletterSuccessPage: PlannedPage = {
    id: 'page_newslettersuccess',
    routeId: 'route_newslettersuccess',
    title: "You're on the list! — Nimbus Notes",
    provenance: pageProvenance(
      'newslettersuccess',
      'Mirrors the b01 corpus newsletter success page (fixtures/b01/newsletter-success.html).',
    ),
    elements: [
      ...headerElements('newslettersuccess', newsletterSuccessRef),
      mainElement('newslettersuccess', newsletterSuccessRef),
      {
        id: el('newslettersuccess', 'h1'),
        kind: 'heading',
        role: 'heading',
        name: "You're on the list!",
        text: "You're on the list!",
        level: 1,
        testId: 'newsletter-success',
        provenance: pageProvenance('newslettersuccess', 'The b01 newsletter success heading, exact text and testid.'),
      },
      {
        id: el('newslettersuccess', 'text'),
        kind: 'text',
        text: 'Look out for a short hello from us once a month. No spam, and you can unsubscribe any time.',
        provenance: pageProvenance('newslettersuccess', 'The b01 newsletter success paragraph.'),
      },
      {
        id: el('newslettersuccess', 'back_home'),
        kind: 'link',
        role: 'link',
        name: 'Back to home',
        text: 'Back to home',
        href: '/',
        testId: 'back-home',
        provenance: pageProvenance('newslettersuccess', 'The b01 back-to-home link.'),
      },
      ...footerElements('newslettersuccess', newsletterSuccessRef),
    ],
    forms: [GOLDEN_NEWSLETTER_FORM],
  };

  const plannedProvenance = (rationale: string) => ({
    level: 'planned' as const,
    rationale,
    sourceIds: [] as string[],
    evidenceRefs: [] as EvidenceRef[],
  });

  return {
    planVersion: '0.1',
    application: {
      id: 'appsyn_b01_golden_fixture',
      name: 'Nimbus Notes (b01 golden fixture)',
      platform: 'web',
      sourceModelId: 'app_b01_golden_fixture',
      entrypoints: ['/'],
    },
    routes: [
      { id: 'route_home', path: '/', pageId: 'page_home', provenance: plannedProvenance('The b01 corpus home route.') },
      {
        id: 'route_features',
        path: '/features.html',
        pageId: 'page_features',
        provenance: plannedProvenance('The b01 corpus features route (file path as path).'),
      },
      {
        id: 'route_pricing',
        path: '/pricing.html',
        pageId: 'page_pricing',
        provenance: plannedProvenance('The b01 corpus pricing route (file path as path).'),
      },
      {
        id: 'route_contact',
        path: '/contact.html',
        pageId: 'page_contact',
        provenance: plannedProvenance('The b01 corpus contact route (file path as path).'),
      },
      {
        id: 'route_contactsuccess',
        path: '/contact-success.html',
        pageId: 'page_contactsuccess',
        provenance: plannedProvenance('The b01 corpus contact success route.'),
      },
      {
        id: 'route_newslettersuccess',
        path: '/newsletter-success.html',
        pageId: 'page_newslettersuccess',
        provenance: plannedProvenance('The b01 corpus newsletter success route.'),
      },
    ],
    pages: [
      homePage,
      featuresPage,
      pricingPage,
      contactPage,
      contactSuccessPage,
      newsletterSuccessPage,
    ],
    navigation: [
      {
        id: 'nav_home_to_features',
        fromRouteId: 'route_home',
        toRouteId: 'route_features',
        trigger: { kind: 'link', elementId: 'el_home_nav_features' },
        sourceTransitionIds: [],
        provenance: plannedProvenance('The seeded b01-nav journey exercises this link click.'),
      },
      {
        id: 'nav_features_to_pricing',
        fromRouteId: 'route_features',
        toRouteId: 'route_pricing',
        trigger: { kind: 'link', elementId: 'el_features_nav_pricing' },
        sourceTransitionIds: [],
        provenance: plannedProvenance('The seeded b01-nav journey exercises this link click.'),
      },
      {
        id: 'nav_pricing_to_home',
        fromRouteId: 'route_pricing',
        toRouteId: 'route_home',
        trigger: { kind: 'link', elementId: 'el_pricing_nav_home' },
        sourceTransitionIds: [],
        provenance: plannedProvenance('The seeded b01-nav journey exercises this link click.'),
      },
      {
        id: 'nav_home_to_contact',
        fromRouteId: 'route_home',
        toRouteId: 'route_contact',
        trigger: { kind: 'link', elementId: 'el_home_nav_contact' },
        sourceTransitionIds: [],
        provenance: plannedProvenance('The seeded b01-nav journey exercises this link click.'),
      },
      {
        id: 'nav_contact_to_contactsuccess',
        fromRouteId: 'route_contact',
        toRouteId: 'route_contactsuccess',
        trigger: { kind: 'form-submit', formId: 'form_contact' },
        sourceTransitionIds: [],
        provenance: plannedProvenance('The seeded b01-contact journey submits the contact form.'),
      },
      {
        id: 'nav_home_to_newslettersuccess',
        fromRouteId: 'route_home',
        toRouteId: 'route_newslettersuccess',
        trigger: { kind: 'form-submit', formId: 'form_newsletter' },
        sourceTransitionIds: [],
        provenance: plannedProvenance('The seeded b01-newsletter journey submits the newsletter form via Enter.'),
      },
    ],
    storage: [],
    api: {
      endpoints: [
        {
          id: 'api_notes',
          method: 'GET',
          urlPattern: '/api/notes',
          sourceOperationIds: [],
          provenance: plannedProvenance(
            'Synthesis choice: a mocked endpoint so the generated api tests are non-vacuous (b01 has no APIs).',
          ),
        },
        {
          id: 'api_item',
          method: 'GET',
          urlPattern: '/api/items/:id',
          sourceOperationIds: [],
          provenance: plannedProvenance(
            'Synthesis choice: an UNMOCKED parameterized endpoint to pin the 501 semantics (b01 has no APIs).',
          ),
        },
      ],
      mocks: [
        {
          id: 'mock_notes_ok',
          endpointId: 'api_notes',
          statusCode: 200,
          bodyJson: {
            ok: true,
            notes: [{ id: 'n1', title: 'First note' }, { id: 'n2', title: 'Second note' }],
          },
        },
      ],
    },
    acceptance: [
      {
        id: 'acc_nav',
        journeyId: 'journey_5bee1e16-86b8-4447-8c9e-26ee583a341a',
        purpose: 'Walk the main navigation: home → features → pricing → home → contact',
        steps: [
          'navigate to /',
          'assert the main navigation is visible',
          'click the Features nav link',
          'assert the features heading is visible',
          'click the first link named Pricing',
          'assert the pricing heading is visible',
          'click the Home nav link',
          'assert the hero heading is visible',
          'click the first link named Contact',
          'assert the contact heading is visible',
          'wait briefly',
        ],
        expectedRoute: '/contact.html',
        mustSeeElementIds: ['el_contact_h1', 'el_contact_form'],
        sourceJourneyIds: ['journey_5bee1e16-86b8-4447-8c9e-26ee583a341a'],
        provenance: plannedProvenance('Derived from the seeded b01-nav journey record.'),
      },
      {
        id: 'acc_media',
        journeyId: 'journey_3a803288-80fa-48d1-8cff-274d36bcc857',
        purpose: 'Verify media assets: logo and hero illustration, then footer navigation',
        steps: [
          'navigate to /',
          'assert the logo image is visible',
          'assert the hero illustration is visible',
          'wait briefly',
          'click the first link named Features',
          'assert the features heading is visible',
          'assert the logo image is visible',
          'click the second link named Features',
          'assert the features heading is visible',
          'assert the footer (contentinfo) is visible',
        ],
        expectedRoute: '/features.html',
        mustSeeElementIds: ['el_features_h1', 'el_features_logo_img', 'el_features_footer'],
        sourceJourneyIds: ['journey_3a803288-80fa-48d1-8cff-274d36bcc857'],
        provenance: plannedProvenance('Derived from the seeded b01-media journey record.'),
      },
      {
        id: 'acc_newsletter',
        journeyId: 'journey_05441478-5197-4c92-b553-b66ea11b84c3',
        purpose: 'Subscribe to the newsletter by pressing Enter in the email field',
        steps: [
          'navigate to /',
          'fill the Email address textbox',
          'press Enter',
          'assert the newsletter success heading is visible',
          'wait briefly',
        ],
        expectedRoute: '/newsletter-success.html',
        mustSeeElementIds: ['el_newslettersuccess_h1'],
        sourceJourneyIds: ['journey_05441478-5197-4c92-b553-b66ea11b84c3'],
        provenance: plannedProvenance('Derived from the seeded b01-newsletter journey record.'),
      },
      {
        id: 'acc_contact',
        journeyId: 'journey_693afe48-c999-4e31-8328-ec1bd92d9780',
        purpose: 'Round-trip the contact form and land back home',
        steps: [
          'navigate to /contact.html',
          'assert the contact heading is visible',
          'fill Your name',
          'fill the email field',
          'fill the message field',
          'click Send message',
          'assert the contact success heading is visible',
          'click Back to home',
          'assert the hero heading is visible',
        ],
        expectedRoute: '/',
        mustSeeElementIds: ['el_home_h1', 'el_home_teaser_h2'],
        sourceJourneyIds: ['journey_693afe48-c999-4e31-8328-ec1bd92d9780'],
        provenance: plannedProvenance('Derived from the seeded b01-contact journey record.'),
      },
    ],
    server: {
      startCommand: 'bun run start',
      port: GOLDEN_PLAN_PORT,
      healthPath: '/',
    },
    assumptions: [],
    constraints: [
      'Element testids, heading texts, image alt texts, and form labels must match the b01 corpus exactly.',
      'Journeys replay against a 127.0.0.1 server only.',
    ],
  };
}
