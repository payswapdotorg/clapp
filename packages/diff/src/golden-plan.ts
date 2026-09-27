/**
 * @clapp/diff — the b01-shaped GOLDEN PLAN fixture (CLAPP-040).
 *
 * A SynthesisPlan literal that mirrors the bench-b01 corpus
 * (@clapp/journey fixtures/b01 — the LEFT side's ground truth) faithfully
 * on every dimension this package compares: the exact 6 route paths, the
 * exact page titles, the exact ordered headings, the exact data-testid
 * surface, the exact landmark sequence (banner / nav Main / main / page
 * regions|complementary / contentinfo / nav Footer), the exact
 * journey-targetable surface (links/buttons/images with their accessible
 * names, incl. the duplicate "Features"/"Pricing"/"Contact" links the
 * seeded nth-selectors exercise), and the contact + newsletter GET forms
 * with their fields, labels, select options, and submit affordances.
 *
 * Honesty notes (the golden-plan discipline, same as the sibling P3
 * fixtures):
 * - Ids are deterministic uuid-v4-SHAPED placeholders (version/variant
 *   bits intact). The uuid convention is the planner's runtime concern;
 *   this is a fixture, and it passes validateSynthesisPlanDetailed.
 * - 'derived' provenance cites the corpus page bytes by their REAL
 *   sha256 (computed here from the frozen corpus files) — evidence refs
 *   are genuine, never fabricated hashes.
 * - The newsletter form appears on every corpus page footer; the plan
 *   contract's global form-id uniqueness makes each page carry its OWN
 *   PlannedForm instance (same fields, distinct ids) — the honest v0.1
 *   encoding of a shared footer form.
 * - The plan declares NO storage bindings and NO api endpoints: the b01
 *   corpus observes none (the state-dimension tests derive plan variants
 *   with bindings below).
 * - baselineRootHash is the honest corpus root: sha256 over the canonical
 *   manifest of the six corpus pages' real sha256 hashes.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sha256Hex, type EvidenceRef } from '@clapp/core';
import { canonicalJson } from '@clapp/observe';
import { resolveFixtureRoot, resolveSeededJourneysDir, validateJourney, type Journey } from '@clapp/journey';
import { describeJourneyAction, type PlannedElement, type PlannedForm, type PlannedPage, type PlannedRoute, type PlannedStorageBinding, type PlannedTransition, type SynthesisPlan } from '@clapp/plan';

// ---------------------------------------------------------------------------
// Deterministic uuid-v4-shaped ids (fixture placeholders, validator-clean)
// ---------------------------------------------------------------------------

const UUID_PREFIX = '00000000-0000-4000-8000-';

const pad = (value: number, width: number): string => String(value).padStart(width, '0');

const uuidTail = (tail: string): string => `${UUID_PREFIX}${tail.padStart(12, '0')}`;

/** Element ids: el_<uuid>{page:02}{seq:04} — unique across the plan. */
function elementId(page: number, seq: number): string {
  return `el_${uuidTail(`000000${pad(page, 2)}${pad(seq, 4)}`)}`;
}

const APPLICATION_ID = `appsyn_${uuidTail('0000000000a1')}`;
const SOURCE_MODEL_ID = `app_${uuidTail('0000000000a1')}`;

/** Page numbers (the element-id space + page/route id lookup). */
const PAGE_HOME = 1;
const PAGE_FEATURES = 2;
const PAGE_PRICING = 3;
const PAGE_CONTACT = 4;
const PAGE_CONTACT_SUCCESS = 5;
const PAGE_NEWSLETTER_SUCCESS = 6;

const PAGE_NUMBERS = [PAGE_HOME, PAGE_FEATURES, PAGE_PRICING, PAGE_CONTACT, PAGE_CONTACT_SUCCESS, PAGE_NEWSLETTER_SUCCESS] as const;

const ROUTE_IDS = PAGE_NUMBERS.map((page) => `route_${uuidTail(`0000000001${pad(page, 2)}`)}`);
const PAGE_IDS = PAGE_NUMBERS.map((page) => `page_${uuidTail(`0000000002${pad(page, 2)}`)}`);

/** The navigation transition ids (also the storage-test writtenOn targets). */
export const NAV_IDS = {
  homeToFeatures: `nav_${uuidTail('000000000301')}`,
  homeToPricing: `nav_${uuidTail('000000000302')}`,
  homeToContact: `nav_${uuidTail('000000000303')}`,
  homeToContactCta: `nav_${uuidTail('000000000304')}`,
  homeToNewsletterSuccess: `nav_${uuidTail('000000000305')}`,
  contactToContactSuccess: `nav_${uuidTail('000000000306')}`,
  contactSuccessToHome: `nav_${uuidTail('000000000307')}`,
  newsletterSuccessToHome: `nav_${uuidTail('000000000308')}`,
  featuresToContact: `nav_${uuidTail('000000000309')}`,
  pricingToContact: `nav_${uuidTail('00000000030a')}`,
} as const;

// ---------------------------------------------------------------------------
// Corpus evidence (real sha256 of the frozen corpus bytes)
// ---------------------------------------------------------------------------

const CORPUS_FILES = [
  'index.html',
  'features.html',
  'pricing.html',
  'contact.html',
  'contact-success.html',
  'newsletter-success.html',
] as const;

async function corpusFileHash(file: string): Promise<string> {
  return sha256Hex(await readFile(join(resolveFixtureRoot(), file), 'utf8'));
}

async function corpusRef(file: (typeof CORPUS_FILES)[number], index: number): Promise<EvidenceRef> {
  return { evidenceId: `ev_${uuidTail(`00000000e${pad(index + 1, 3)}`)}`, kind: 'static', sha256: await corpusFileHash(file) };
}

/**
 * The honest b01 corpus root hash: sha256 over the canonical manifest of
 * the six corpus pages' real sha256 hashes (the left side's baseline).
 */
export async function b01CorpusRootHash(): Promise<string> {
  const files: Record<string, string> = {};
  for (const file of CORPUS_FILES) {
    files[file] = await corpusFileHash(file);
  }
  return sha256Hex(canonicalJson({ corpus: 'bench/b01-static', files }));
}

/** Loads a seeded b01 journey record and validates it structurally. */
async function loadJourney(name: string): Promise<Journey> {
  const path = join(resolveSeededJourneysDir(), name);
  const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
  if (!validateJourney(parsed)) {
    throw new Error(`golden-plan: seeded journey ${name} failed structural validation`);
  }
  return parsed;
}

/** The four SEEDED b01 journey records (the acceptance supply — truth, never weakened). */
export async function loadSeededB01Journeys(): Promise<Journey[]> {
  return [
    await loadJourney('b01-nav.json'),
    await loadJourney('b01-media.json'),
    await loadJourney('b01-newsletter.json'),
    await loadJourney('b01-contact.json'),
  ];
}

// ---------------------------------------------------------------------------
// Element builders
// ---------------------------------------------------------------------------

interface ProvenanceSource {
  ref: EvidenceRef;
  screen: string;
}

function derived(source: ProvenanceSource, rationale: string) {
  return { level: 'derived' as const, rationale, sourceIds: [source.screen], evidenceRefs: [source.ref] };
}

function planned(rationale: string) {
  return { level: 'planned' as const, rationale, sourceIds: [] as string[], evidenceRefs: [] as EvidenceRef[] };
}

/** The shared page header elements (inside the banner landmark). */
function headerElements(page: number, source: ProvenanceSource): PlannedElement[] {
  const provenance = derived(source, 'Mirrors the b01 site header: logo link + logo image, the nav toggle, and the Main navigation.');
  return [
    { id: elementId(page, 1), kind: 'link', testId: 'logo-link', name: 'Nimbus Notes home', text: 'Nimbus Notes', href: '/', provenance },
    { id: elementId(page, 2), kind: 'image', alt: 'Nimbus Notes logo', provenance },
    { id: elementId(page, 3), kind: 'button', testId: 'nav-toggle', name: 'Toggle navigation menu', provenance },
    { id: elementId(page, 4), kind: 'navigation', name: 'Main', provenance },
    { id: elementId(page, 5), kind: 'link', testId: 'nav-home', text: 'Home', href: '/', provenance },
    { id: elementId(page, 6), kind: 'link', testId: 'nav-features', text: 'Features', href: '/features.html', provenance },
    { id: elementId(page, 7), kind: 'link', testId: 'nav-pricing', text: 'Pricing', href: '/pricing.html', provenance },
    { id: elementId(page, 8), kind: 'link', testId: 'nav-contact', text: 'Contact', href: '/contact.html', provenance },
  ];
}

/** The shared page footer elements (inside the contentinfo landmark). */
function footerElements(page: number, source: ProvenanceSource, newsletterFormId: string, startSeq: number): PlannedElement[] {
  const provenance = derived(source, 'Mirrors the b01 footer: the Footer navigation, the newsletter form block, and the copyright line.');
  let seq = startSeq;
  const next = (): string => elementId(page, seq++);
  return [
    { id: next(), kind: 'other', role: 'contentinfo', provenance: planned('Page footer landmark — a synthesis container with no single IR source.') },
    { id: next(), kind: 'navigation', name: 'Footer', provenance },
    { id: next(), kind: 'link', text: 'Home', href: '/', provenance },
    { id: next(), kind: 'link', text: 'Features', href: '/features.html', provenance },
    { id: next(), kind: 'link', text: 'Pricing', href: '/pricing.html', provenance },
    { id: next(), kind: 'link', text: 'Contact', href: '/contact.html', provenance },
    { id: next(), kind: 'heading', level: 2, text: 'Stay in the loop', provenance },
    { id: next(), kind: 'form', formId: newsletterFormId, provenance },
    { id: next(), kind: 'text', text: '© 2026 Nimbus Notes. A CLAPP b01 benchmark fixture.', provenance },
  ];
}

/** The skip link (before the header landmark, exactly as the corpus orders it). */
function skipLink(page: number, source: ProvenanceSource): PlannedElement {
  return {
    id: elementId(page, 90),
    kind: 'link',
    text: 'Skip to content',
    href: '#main-content',
    provenance: derived(source, 'The b01 skip link to the main content landmark.'),
  };
}

/** The banner landmark container (opens <header>). */
function bannerContainer(page: number): PlannedElement {
  return {
    id: elementId(page, 91),
    kind: 'other',
    role: 'banner',
    provenance: planned('Page header landmark — a synthesis container with no single IR source.'),
  };
}

/** The main landmark container (opens <main>). */
function mainContainer(page: number): PlannedElement {
  return {
    id: elementId(page, 92),
    kind: 'other',
    role: 'main',
    provenance: planned('Main content landmark — a synthesis container with no single IR source.'),
  };
}

/** A region landmark container (opens <section>; optional accessible name). */
function regionContainer(page: number, seq: number, name?: string): PlannedElement {
  return {
    id: elementId(page, seq),
    kind: 'other',
    role: 'region',
    ...(name !== undefined ? { name } : {}),
    provenance: planned('Content region landmark — a synthesis container with no single IR source.'),
  };
}

/** An article landmark container (opens <article>). */
function articleContainer(page: number, seq: number): PlannedElement {
  return {
    id: elementId(page, seq),
    kind: 'other',
    role: 'article',
    provenance: planned('Card article landmark — a synthesis container with no single IR source.'),
  };
}

// ---------------------------------------------------------------------------
// Forms (the newsletter form is per-page: same fields, distinct ids)
// ---------------------------------------------------------------------------

function contactForm(source: ProvenanceSource): PlannedForm {
  return {
    id: `form_${uuidTail('000000000fa1')}`,
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
    provenance: derived(source, 'The b01 contact form: name, email, topic select, message; GET submit to the contact success page.'),
  };
}

function newsletterForm(page: number): PlannedForm {
  return {
    id: `form_${uuidTail(`000000000fb${pad(page, 1)}`)}`,
    action: '/newsletter-success.html',
    method: 'get',
    fields: [
      { name: 'email', type: 'email', label: 'Email address', testId: 'newsletter-email', required: true, placeholder: 'you@example.com' },
    ],
    submitLabel: 'Subscribe',
    submitTestId: 'newsletter-submit',
    provenance: planned('The b01 footer newsletter form carried by every page (a per-page instance: form ids are plan-global).'),
  };
}

// ---------------------------------------------------------------------------
// The six pages
// ---------------------------------------------------------------------------

function homePage(source: ProvenanceSource): PlannedPage {
  const p = derived(source, 'Mirrors the b01 home page (fixtures/b01/index.html).');
  const elements: PlannedElement[] = [
    skipLink(PAGE_HOME, source),
    bannerContainer(PAGE_HOME),
    ...headerElements(PAGE_HOME, source),
    mainContainer(PAGE_HOME),
    regionContainer(PAGE_HOME, 93),
    { id: elementId(PAGE_HOME, 10), kind: 'heading', level: 1, testId: 'hero-heading', text: 'Capture every idea, calmly', provenance: p },
    { id: elementId(PAGE_HOME, 11), kind: 'text', text: 'Nimbus Notes is a calm, fast notebook for small teams: quick capture, smart links, and no shouting interfaces.', provenance: p },
    { id: elementId(PAGE_HOME, 12), kind: 'image', testId: 'hero-illustration', alt: 'Illustration of notes organized among clouds', provenance: p },
    { id: elementId(PAGE_HOME, 13), kind: 'link', testId: 'cta-get-started', text: 'Get started', href: '/contact.html', provenance: p },
    { id: elementId(PAGE_HOME, 14), kind: 'link', testId: 'cta-pricing', text: 'See pricing', href: '/pricing.html', provenance: p },
    regionContainer(PAGE_HOME, 94),
    { id: elementId(PAGE_HOME, 15), kind: 'heading', level: 2, text: 'Why teams choose Nimbus', provenance: p },
    articleContainer(PAGE_HOME, 95),
    { id: elementId(PAGE_HOME, 16), kind: 'heading', level: 3, text: 'Fast capture', provenance: p },
    { id: elementId(PAGE_HOME, 17), kind: 'text', text: 'A new note is one keystroke away. No modals, no required fields, no ceremony.', provenance: p },
    { id: elementId(PAGE_HOME, 18), kind: 'link', name: 'Learn more about fast capture', text: 'Learn more', href: '/features.html', provenance: p },
    articleContainer(PAGE_HOME, 96),
    { id: elementId(PAGE_HOME, 19), kind: 'heading', level: 3, text: 'Smart linking', provenance: p },
    { id: elementId(PAGE_HOME, 20), kind: 'text', text: 'Notes mention each other with plain links, and the graph keeps itself tidy.', provenance: p },
    { id: elementId(PAGE_HOME, 21), kind: 'link', name: 'Learn more about smart linking', text: 'Learn more', href: '/features.html', provenance: p },
    articleContainer(PAGE_HOME, 97),
    { id: elementId(PAGE_HOME, 22), kind: 'heading', level: 3, text: 'Calm collaboration', provenance: p },
    { id: elementId(PAGE_HOME, 23), kind: 'text', text: 'Share a space, mention a teammate, move on. No activity flood, ever.', provenance: p },
    { id: elementId(PAGE_HOME, 24), kind: 'link', name: 'Learn more about calm collaboration', text: 'Learn more', href: '/features.html', provenance: p },
    { id: elementId(PAGE_HOME, 25), kind: 'link', testId: 'cta-explore-features', text: 'Explore all features', href: '/features.html', provenance: p },
  ];
  const form = newsletterForm(PAGE_HOME);
  elements.push(...footerElements(PAGE_HOME, source, form.id, 30));
  return {
    id: PAGE_IDS[PAGE_HOME - 1]!,
    routeId: ROUTE_IDS[PAGE_HOME - 1]!,
    title: 'Capture every idea, calmly — Nimbus Notes',
    elements,
    forms: [form],
    provenance: p,
  };
}

function featuresPage(source: ProvenanceSource): PlannedPage {
  const p = derived(source, 'Mirrors the b01 features page (fixtures/b01/features.html).');
  const feature = (seq: number, heading: string, text: string, items: string): PlannedElement[] => [
    regionContainer(PAGE_FEATURES, seq),
    { id: elementId(PAGE_FEATURES, seq + 1), kind: 'heading', level: 2, text: heading, provenance: p },
    { id: elementId(PAGE_FEATURES, seq + 2), kind: 'text', text, provenance: p },
    { id: elementId(PAGE_FEATURES, seq + 3), kind: 'list', text: items, provenance: p },
  ];
  const elements: PlannedElement[] = [
    skipLink(PAGE_FEATURES, source),
    bannerContainer(PAGE_FEATURES),
    ...headerElements(PAGE_FEATURES, source),
    mainContainer(PAGE_FEATURES),
    { id: elementId(PAGE_FEATURES, 10), kind: 'heading', level: 1, testId: 'features-heading', text: 'Everything you need to stay organized', provenance: p },
    { id: elementId(PAGE_FEATURES, 11), kind: 'text', text: 'Four capabilities, no sprawling admin console. Each one earns its place.', provenance: p },
    ...feature(93, 'Fast capture', 'A new note is one keystroke away, from anywhere in the app. Titles are optional; everything is searchable the moment it exists.', 'Instant note creation with a single shortcut\nOptional titles — first line becomes the title when you want one\nEverything indexed as you type'),
    ...feature(97, 'Smart linking', 'Notes mention each other with plain links. Backlinks assemble themselves, and the graph view stays readable even at a thousand notes.', 'Plain-text mentions that resolve to notes\nAutomatic backlinks on every note\nA graph you can actually read'),
    ...feature(101, 'Calm collaboration', 'Share a space, mention a teammate, move on. Nimbus shows you what changed since you last looked — not an infinite activity feed.', 'Spaces with simple invite links\nMentions that arrive as a short daily digest\nPer-note read markers'),
    ...feature(105, 'Offline first', 'The local copy is the source of truth. Sync happens in the background and reconciles quietly when you reconnect.', 'Full read and write access offline\nConflict-free merges for plain notes\nSync status you can see at a glance'),
    { id: elementId(PAGE_FEATURES, 30), kind: 'text', text: 'Nimbus replaced three tools on day one, and nobody on the team raised their voice about it.', provenance: p },
    { id: elementId(PAGE_FEATURES, 31), kind: 'text', text: 'Priya S., operations lead at a nine-person studio', provenance: p },
    { id: elementId(PAGE_FEATURES, 32), kind: 'link', testId: 'features-cta', text: 'Talk to us', href: '/contact.html', provenance: p },
  ];
  const form = newsletterForm(PAGE_FEATURES);
  elements.push(...footerElements(PAGE_FEATURES, source, form.id, 35));
  return {
    id: PAGE_IDS[PAGE_FEATURES - 1]!,
    routeId: ROUTE_IDS[PAGE_FEATURES - 1]!,
    title: 'Features — Nimbus Notes',
    elements,
    forms: [form],
    provenance: p,
  };
}

function pricingPage(source: ProvenanceSource): PlannedPage {
  const p = derived(source, 'Mirrors the b01 pricing page (fixtures/b01/pricing.html).');
  const plan = (articleSeq: number, seq: number, heading: string, price: string, items: string, ctaTestId: string, ctaText: string): PlannedElement[] => [
    articleContainer(PAGE_PRICING, articleSeq),
    { id: elementId(PAGE_PRICING, seq), kind: 'heading', level: 2, text: heading, provenance: p },
    { id: elementId(PAGE_PRICING, seq + 1), kind: 'text', text: price, provenance: p },
    { id: elementId(PAGE_PRICING, seq + 2), kind: 'list', text: items, provenance: p },
    { id: elementId(PAGE_PRICING, seq + 3), kind: 'link', testId: ctaTestId, text: ctaText, href: '/contact.html', provenance: p },
  ];
  const elements: PlannedElement[] = [
    skipLink(PAGE_PRICING, source),
    bannerContainer(PAGE_PRICING),
    ...headerElements(PAGE_PRICING, source),
    mainContainer(PAGE_PRICING),
    { id: elementId(PAGE_PRICING, 10), kind: 'heading', level: 1, testId: 'pricing-heading', text: 'Simple, honest pricing', provenance: p },
    { id: elementId(PAGE_PRICING, 11), kind: 'text', text: 'Every plan includes the full feature set. You only pay for team size and support depth.', provenance: p },
    regionContainer(PAGE_PRICING, 93, 'Plans'),
    ...plan(40, 20, 'Starter', '$0 / forever', 'One workspace\nUnlimited notes\nCommunity support', 'plan-starter-cta', 'Choose Starter'),
    ...plan(41, 24, 'Team', '$8 / user / month', 'Shared spaces\nMentions and digests\nEmail support', 'plan-team-cta', 'Choose Team'),
    ...plan(42, 28, 'Studio', '$15 / user / month', 'Everything in Team\nSAML sign-in\nPriority support', 'plan-studio-cta', 'Choose Studio'),
    regionContainer(PAGE_PRICING, 94),
    { id: elementId(PAGE_PRICING, 33), kind: 'heading', level: 2, text: 'Frequently asked questions', provenance: p },
    { id: elementId(PAGE_PRICING, 34), kind: 'heading', level: 3, text: 'Is there really a free plan?', provenance: p },
    { id: elementId(PAGE_PRICING, 35), kind: 'text', text: 'Yes — Starter is free forever, with no note limits and no expiring trial.', provenance: p },
    { id: elementId(PAGE_PRICING, 36), kind: 'heading', level: 3, text: 'Can I export my notes?', provenance: p },
    { id: elementId(PAGE_PRICING, 37), kind: 'text', text: 'Always. Every note exports as plain text, and whole workspaces export as a single archive.', provenance: p },
    { id: elementId(PAGE_PRICING, 38), kind: 'heading', level: 3, text: 'What happens offline?', provenance: p },
    { id: elementId(PAGE_PRICING, 39), kind: 'text', text: 'Everything keeps working. Sync resumes when you reconnect, and plain notes merge without conflicts.', provenance: p },
  ];
  const form = newsletterForm(PAGE_PRICING);
  elements.push(...footerElements(PAGE_PRICING, source, form.id, 45));
  return {
    id: PAGE_IDS[PAGE_PRICING - 1]!,
    routeId: ROUTE_IDS[PAGE_PRICING - 1]!,
    title: 'Pricing — Nimbus Notes',
    elements,
    forms: [form],
    provenance: p,
  };
}

function contactPage(source: ProvenanceSource): PlannedPage {
  const p = derived(source, 'Mirrors the b01 contact page (fixtures/b01/contact.html).');
  const form = contactForm(source);
  const elements: PlannedElement[] = [
    skipLink(PAGE_CONTACT, source),
    bannerContainer(PAGE_CONTACT),
    ...headerElements(PAGE_CONTACT, source),
    mainContainer(PAGE_CONTACT),
    { id: elementId(PAGE_CONTACT, 10), kind: 'heading', level: 1, testId: 'contact-heading', text: "We'd love to hear from you", provenance: p },
    { id: elementId(PAGE_CONTACT, 11), kind: 'text', text: 'Questions, support, or sales — one form, no ticket maze.', provenance: p },
    { id: elementId(PAGE_CONTACT, 12), kind: 'form', testId: 'contact-form', formId: form.id, provenance: p },
    { id: elementId(PAGE_CONTACT, 95), kind: 'other', role: 'complementary', provenance: planned('The contact aside landmark — a synthesis container with no single IR source.') },
    { id: elementId(PAGE_CONTACT, 13), kind: 'heading', level: 2, text: 'Other ways to reach us', provenance: p },
    { id: elementId(PAGE_CONTACT, 14), kind: 'text', text: 'Write to hello@nimbusnotes.example any time.', provenance: p },
    { id: elementId(PAGE_CONTACT, 15), kind: 'text', text: 'We reply within two business days.', provenance: p },
  ];
  const newsletter = newsletterForm(PAGE_CONTACT);
  elements.push(...footerElements(PAGE_CONTACT, source, newsletter.id, 30));
  return {
    id: PAGE_IDS[PAGE_CONTACT - 1]!,
    routeId: ROUTE_IDS[PAGE_CONTACT - 1]!,
    title: 'Contact — Nimbus Notes',
    elements,
    forms: [form, newsletter],
    provenance: p,
  };
}

function successPage(
  page: number,
  source: ProvenanceSource,
  title: string,
  headingTestId: string,
  headingText: string,
  bodyText: string,
): PlannedPage {
  const p = derived(source, 'Mirrors the b01 success page of its form round-trip.');
  const elements: PlannedElement[] = [
    skipLink(page, source),
    bannerContainer(page),
    ...headerElements(page, source),
    mainContainer(page),
    regionContainer(page, 93),
    { id: elementId(page, 10), kind: 'heading', level: 1, testId: headingTestId, text: headingText, provenance: p },
    { id: elementId(page, 11), kind: 'text', text: bodyText, provenance: p },
    { id: elementId(page, 12), kind: 'link', testId: 'back-home', text: 'Back to home', href: '/', provenance: p },
  ];
  const form = newsletterForm(page);
  elements.push(...footerElements(page, source, form.id, 30));
  return {
    id: PAGE_IDS[page - 1]!,
    routeId: ROUTE_IDS[page - 1]!,
    title,
    elements,
    forms: [form],
    provenance: p,
  };
}

// ---------------------------------------------------------------------------
// The golden plan
// ---------------------------------------------------------------------------

let cachedPlan: Promise<SynthesisPlan> | undefined;

type NavTrigger = { kind: 'link'; elementId: string } | { kind: 'form-submit'; formId: string };

/** Builds the b01-shaped golden plan (deterministic; cached). */
export function buildGoldenB01Plan(): Promise<SynthesisPlan> {
  if (cachedPlan === undefined) {
    cachedPlan = (async () => {
      const refs = await Promise.all(CORPUS_FILES.map((file, index) => corpusRef(file, index)));
      const sources: ProvenanceSource[] = refs.map((ref, index) => ({ ref, screen: `screen_b01_${CORPUS_FILES[index]!.replace('.html', '')}` }));

      const [home, features, pricing, contact, contactSuccess, newsletterSuccess] = [
        homePage(sources[0]!),
        featuresPage(sources[1]!),
        pricingPage(sources[2]!),
        contactPage(sources[3]!),
        successPage(
          PAGE_CONTACT_SUCCESS,
          sources[4]!,
          'Thanks for reaching out! — Nimbus Notes',
          'contact-success',
          'Thanks for reaching out!',
          "We'll get back to you within two business days.",
        ),
        successPage(
          PAGE_NEWSLETTER_SUCCESS,
          sources[5]!,
          "You're on the list! — Nimbus Notes",
          'newsletter-success',
          "You're on the list!",
          'Look out for a short hello from us once a month. No spam, and you can unsubscribe any time.',
        ),
      ];

      const routePagePairs: Array<[string, number]> = [
        ['/', PAGE_HOME],
        ['/features.html', PAGE_FEATURES],
        ['/pricing.html', PAGE_PRICING],
        ['/contact.html', PAGE_CONTACT],
        ['/contact-success.html', PAGE_CONTACT_SUCCESS],
        ['/newsletter-success.html', PAGE_NEWSLETTER_SUCCESS],
      ];
      const routes: PlannedRoute[] = routePagePairs.map(([path, pageNumber], index) => ({
        id: ROUTE_IDS[pageNumber - 1]!,
        path,
        pageId: PAGE_IDS[pageNumber - 1]!,
        provenance: derived(sources[index]!, `The observed b01 route ${path} (the corpus file paths are the route paths).`),
      }));

      const transition = (
        id: string,
        from: number,
        to: number,
        trigger: NavTrigger,
        sourceTail: string,
        rationale: string,
      ): PlannedTransition => ({
        id,
        fromRouteId: ROUTE_IDS[from - 1]!,
        toRouteId: ROUTE_IDS[to - 1]!,
        trigger,
        sourceTransitionIds: [`trans_${uuidTail(sourceTail)}`],
        provenance: planned(rationale),
      });

      const navigation: PlannedTransition[] = [
        transition(NAV_IDS.homeToFeatures, PAGE_HOME, PAGE_FEATURES, { kind: 'link', elementId: elementId(PAGE_HOME, 6) }, '000000000301', 'Home → features via the main nav Features link.'),
        transition(NAV_IDS.homeToPricing, PAGE_HOME, PAGE_PRICING, { kind: 'link', elementId: elementId(PAGE_HOME, 7) }, '000000000302', 'Home → pricing via the main nav Pricing link.'),
        transition(NAV_IDS.homeToContact, PAGE_HOME, PAGE_CONTACT, { kind: 'link', elementId: elementId(PAGE_HOME, 8) }, '000000000303', 'Home → contact via the main nav Contact link.'),
        transition(NAV_IDS.homeToContactCta, PAGE_HOME, PAGE_CONTACT, { kind: 'link', elementId: elementId(PAGE_HOME, 13) }, '000000000304', 'Home → contact via the Get started CTA.'),
        transition(NAV_IDS.homeToNewsletterSuccess, PAGE_HOME, PAGE_NEWSLETTER_SUCCESS, { kind: 'form-submit', formId: newsletterForm(PAGE_HOME).id }, '000000000305', 'Home → newsletter-success via the footer newsletter form (GET submit / Enter).'),
        transition(NAV_IDS.contactToContactSuccess, PAGE_CONTACT, PAGE_CONTACT_SUCCESS, { kind: 'form-submit', formId: `form_${uuidTail('000000000fa1')}` }, '000000000306', 'Contact → contact-success via the contact form submit.'),
        transition(NAV_IDS.contactSuccessToHome, PAGE_CONTACT_SUCCESS, PAGE_HOME, { kind: 'link', elementId: elementId(PAGE_CONTACT_SUCCESS, 12) }, '000000000307', 'Contact-success → home via the Back to home link.'),
        transition(NAV_IDS.newsletterSuccessToHome, PAGE_NEWSLETTER_SUCCESS, PAGE_HOME, { kind: 'link', elementId: elementId(PAGE_NEWSLETTER_SUCCESS, 12) }, '000000000308', 'Newsletter-success → home via the Back to home link.'),
        transition(NAV_IDS.featuresToContact, PAGE_FEATURES, PAGE_CONTACT, { kind: 'link', elementId: elementId(PAGE_FEATURES, 32) }, '000000000309', 'Features → contact via the Talk to us CTA.'),
        transition(NAV_IDS.pricingToContact, PAGE_PRICING, PAGE_CONTACT, { kind: 'link', elementId: elementId(PAGE_PRICING, 23) }, '00000000030a', 'Pricing → contact via the Choose Starter CTA.'),
      ];

      const journeys = await loadSeededB01Journeys();
      const acceptanceSpecs: Array<[string, number, number, string]> = [
        ['/contact.html', PAGE_CONTACT, 10, 'The b01 navigation walkthrough: home → features → pricing → home → contact.'],
        ['/features.html', PAGE_FEATURES, 10, 'The b01 media tour: logo + hero images, nth-selected Features links, the features heading, and the footer landmark.'],
        ['/newsletter-success.html', PAGE_NEWSLETTER_SUCCESS, 10, 'The b01 newsletter subscribe: fill email, press Enter, land on the success page.'],
        ['/', PAGE_HOME, 10, 'The b01 contact round-trip: fill the form, submit, land on the success page, return home.'],
      ];
      const acceptance = journeys.map((journey, index): SynthesisPlan['acceptance'][number] => {
        const [expectedRoute, pageNumber, seq, purpose] = acceptanceSpecs[index]!;
        return {
          id: `acc_${uuidTail(`00000000040${index + 1}`)}`,
          journeyId: journey.id,
          purpose,
          steps: journey.actions.map((action) => describeJourneyAction(action)),
          expectedRoute,
          mustSeeElementIds: [elementId(pageNumber, seq)],
          sourceJourneyIds: [journey.id],
          provenance: planned('Acceptance derived from the seeded b01 journey record (the record is truth).'),
        };
      });

      return {
        planVersion: '0.1',
        application: {
          id: APPLICATION_ID,
          name: 'Nimbus Notes',
          platform: 'web',
          sourceModelId: SOURCE_MODEL_ID,
          entrypoints: ['/'],
        },
        routes,
        pages: [home, features, pricing, contact, contactSuccess, newsletterSuccess],
        navigation,
        storage: [],
        api: { endpoints: [], mocks: [] },
        acceptance,
        server: { startCommand: 'bun server.ts', port: 46240, healthPath: '/' },
        assumptions: [
          'The b01 corpus observes no storage writes and no API traffic — the plan declares none (absence is honest, not an omission).',
          'Landmark nesting is not encodable in the v0.1 flat element list: regions render as sibling <section>s; the landmark SEQUENCE is what the corpus and candidate agree on.',
        ],
        constraints: [
          'The corpus file paths are the route paths (the seeded journeys navigate to exactly these).',
          'Every journey-targetable surface (testids, roles, accessible names, form fields) must be preserved from the corpus.',
        ],
      } satisfies SynthesisPlan;
    })();
  }
  return cachedPlan;
}

// ---------------------------------------------------------------------------
// Storage-binding plan variants (the state-dimension test supply)
// ---------------------------------------------------------------------------

/** A plan variant that adds a COOKIE binding written on the home→pricing transition's route. */
export function withCookieBinding(plan: SynthesisPlan, key = 'b01-visit'): SynthesisPlan {
  const binding: PlannedStorageBinding = {
    id: `store_${uuidTail('000000000501')}`,
    key,
    storage: 'cookie',
    entityFieldNames: [],
    writtenOn: [NAV_IDS.homeToPricing],
    sourceEntityIds: [],
    provenance: planned('Fixture-declared cookie write on the pricing route — exercises the state dimension under both drivers (Set-Cookie response headers).'),
  };
  return { ...plan, storage: [...plan.storage, binding] };
}

/** A plan variant that adds a LOCALSTORAGE binding written on the newsletter submit's route. */
export function withLocalStorageBinding(plan: SynthesisPlan, key = 'newsletter-email'): SynthesisPlan {
  const binding: PlannedStorageBinding = {
    id: `store_${uuidTail('000000000502')}`,
    key,
    storage: 'localStorage',
    entityFieldNames: [],
    writtenOn: [NAV_IDS.homeToNewsletterSuccess],
    sourceEntityIds: [],
    provenance: planned('Fixture-declared localStorage write on the newsletter-success route — exercises the state dimension honestly (unverifiable under replayer-dom; real under a browser driver).'),
  };
  return { ...plan, storage: [...plan.storage, binding] };
}

/** The golden plan's candidate application id (the right side's targetId). */
export const GOLDEN_CANDIDATE_APP_ID = APPLICATION_ID;
