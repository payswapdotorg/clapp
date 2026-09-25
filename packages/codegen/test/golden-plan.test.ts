/**
 * @clapp/codegen tests — golden b01 plan → golden HTML (CLAPP-031).
 *
 * The golden plan (fixtures/golden-b01-plan.ts) mirrors the bench-b01
 * corpus and every seeded-journey selector. This battery proves the
 * generated tree carries all of it: testids, headings, form fields,
 * actions/methods, submit affordances, titles, assets — plus
 * byte-determinism and the generated README's documentation duties.
 */

import { describe, expect, it } from 'bun:test';
import { GOLDEN_B01_PLAN } from '../fixtures/golden-b01-plan';
import { generateApp } from '../src/index';
import type { GeneratedApp } from '../src/index';

const app: GeneratedApp = generateApp(GOLDEN_B01_PLAN);

function fileContents(path: string): string {
  const file = app.files.find((candidate) => candidate.path === path);
  if (file === undefined) {
    throw new Error(`golden app has no file ${path}`);
  }
  return file.contents;
}

function pageHtml(routeSlug: string): string {
  return fileContents(`pages/${routeSlug}.html.ts`);
}

describe('golden b01 plan → generated tree shape', () => {
  it('emits exactly the expected file set, sorted by path', () => {
    expect(app.files.map((file) => file.path)).toEqual([
      'README.md',
      'package.json',
      'pages/contact-success.html.ts',
      'pages/contact.html.ts',
      'pages/features.html.ts',
      'pages/index.html.ts',
      'pages/newsletter-success.html.ts',
      'pages/pricing.html.ts',
      'server.ts',
    ]);
  });

  it('manifest mirrors the plan', () => {
    expect(app.manifest).toEqual({
      packageName: 'clapp-app-nimbus-notes',
      startCommand: 'bun server.ts',
      port: 4531,
      healthPath: '/',
      routePaths: ['/', '/features.html', '/pricing.html', '/contact.html', '/contact-success.html', '/newsletter-success.html'],
      apiEndpoints: [],
    });
  });

  it('package.json is a zero-dependency module package with a start script', () => {
    const pkg = JSON.parse(fileContents('package.json')) as Record<string, unknown>;
    expect(pkg['name']).toBe('clapp-app-nimbus-notes');
    expect(pkg['type']).toBe('module');
    expect(pkg['private']).toBe(true);
    expect(pkg['scripts']).toEqual({ start: 'bun server.ts' });
    expect(Object.keys(pkg)).not.toContain('dependencies');
    expect(Object.keys(pkg)).not.toContain('devDependencies');
    expect(Object.keys(pkg)).not.toContain('peerDependencies');
  });

  it('server.ts imports every page module and serves all six routes', () => {
    const server = fileContents('server.ts');
    for (const path of ['/', '/features.html', '/pricing.html', '/contact.html', '/contact-success.html', '/newsletter-success.html']) {
      expect(server).toContain(`  ${JSON.stringify(path)}: route`);
    }
    expect(server).toContain("import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';");
    expect((server.match(/from '.\/pages\//g) ?? []).length).toBe(6);
  });

  it('server.ts serves the two synthesized image assets', () => {
    const server = fileContents('server.ts');
    expect(server).toContain('"nimbus-notes-logo.svg"');
    expect(server).toContain('"illustration-of-notes-organized-among-clouds.svg"');
  });
});

describe('golden b01 plan → per-page HTML', () => {
  it('home page carries every golden testid, heading, image and form', () => {
    const html = pageHtml('index');
    expect(html).toContain('<title>Capture every idea, calmly — Nimbus Notes</title>');
    expect(html).toContain('<h1 data-testid="hero-heading">Capture every idea, calmly</h1>');
    expect(html).toContain('data-testid="logo-link"');
    expect(html).toContain('aria-label="Nimbus Notes home"');
    expect(html).toContain('alt="Nimbus Notes logo"');
    expect(html).toContain('alt="Illustration of notes organized among clouds"');
    expect(html).toContain('data-testid="hero-illustration"');
    expect(html).toContain('data-testid="cta-get-started"');
    expect(html).toContain('data-testid="cta-pricing"');
    expect(html).toContain('data-testid="cta-explore-features"');
    expect(html).toContain('aria-label="Learn more about fast capture"');
    expect(html).toContain('aria-label="Learn more about smart linking"');
    // Navigation: main nav with the four golden testids inside <nav aria-label="Main">.
    expect(html).toContain('<nav aria-label="Main">');
    for (const testId of ['nav-home', 'nav-features', 'nav-pricing', 'nav-contact']) {
      expect(html).toContain(`data-testid="${testId}"`);
    }
    // Footer: landmark, footer nav, newsletter form, copyright.
    expect(html).toContain('<footer>');
    expect(html).toContain('<nav aria-label="Footer">');
    expect(html).toContain('© 2026 Nimbus Notes. A CLAPP b01 benchmark fixture.');
    // EXACTLY two links named "Features" (main nav + footer nav — nth 0/1 selectors).
    expect((html.match(/>Features<\/a>/g) ?? []).length).toBe(2);
    // Newsletter form: action, method, field, submit.
    expect(html).toContain('<form action="/newsletter-success.html" method="get">');
    expect(html).toContain('name="email"');
    expect(html).toContain('type="email"');
    expect(html).toContain('placeholder="you@example.com"');
    expect(html).toContain('data-testid="newsletter-email"');
    expect(html).toContain('<label for="');
    expect(html).toContain('data-testid="newsletter-submit"');
    expect(html).toContain('>Subscribe</button>');
    // The label must pair with the input id (accessible name "Email address").
    const forMatch = html.match(/<label for="([^"]+)">Email address<\/label>/);
    expect(forMatch).not.toBeNull();
    const forId = (forMatch as RegExpMatchArray)[1];
    expect(html).toContain(`<input id="${forId}" name="email"`);
    expect(html).toContain('required');
  });

  it('features page carries the features heading, lists and CTA', () => {
    const html = pageHtml('features');
    expect(html).toContain('<title>Features — Nimbus Notes</title>');
    expect(html).toContain('<h1 data-testid="features-heading">Everything you need to stay organized</h1>');
    expect(html).toContain('<h2>Fast capture</h2>');
    expect(html).toContain('<h2>Smart linking</h2>');
    expect(html).toContain('<li>Instant note creation with a single shortcut</li>');
    expect(html).toContain('<li>A graph you can actually read</li>');
    expect(html).toContain('data-testid="features-cta"');
    expect(html).toContain('>Talk to us</a>');
    expect(html).toContain('alt="Nimbus Notes logo"');
    expect(html).toContain('<footer>');
  });

  it('pricing page carries the pricing heading, plan CTAs and FAQ', () => {
    const html = pageHtml('pricing');
    expect(html).toContain('<title>Pricing — Nimbus Notes</title>');
    expect(html).toContain('<h1 data-testid="pricing-heading">Simple, honest pricing</h1>');
    expect(html).toContain('<h2>Starter</h2>');
    expect(html).toContain('<h2>Team</h2>');
    expect(html).toContain('<h2>Studio</h2>');
    expect(html).toContain('data-testid="plan-starter-cta"');
    expect(html).toContain('data-testid="plan-team-cta"');
    expect(html).toContain('data-testid="plan-studio-cta"');
    expect(html).toContain('<h3>Is there really a free plan?</h3>');
    expect(html).toContain('<h3>Can I export my notes?</h3>');
  });

  it('contact page carries the contact form in full (fields, select, textarea, submit)', () => {
    const html = pageHtml('contact');
    expect(html).toContain('<title>Contact — Nimbus Notes</title>');
    expect(html).toContain(`<h1 data-testid="contact-heading">We'd love to hear from you</h1>`);
    expect(html).toContain('<form action="/contact-success.html" method="get" data-testid="contact-form">');
    // Fields: name, email, topic select with the three options, message textarea.
    expect(html).toContain('<label for="');
    expect(html).toContain('>Your name</label>');
    expect(html).toContain('name="name"');
    expect(html).toContain('type="text"');
    expect(html).toContain('data-testid="contact-name"');
    expect(html).toContain('>Email address</label>');
    expect(html).toContain('name="email"');
    expect(html).toContain('data-testid="contact-email"');
    expect(html).toContain('>Topic</label>');
    expect(html).toContain('data-testid="contact-topic"');
    expect(html).toContain('<option value="general" selected>General question</option>');
    expect(html).toContain('<option value="support">Support</option>');
    expect(html).toContain('<option value="sales">Sales</option>');
    expect(html).toContain('>Message</label>');
    expect(html).toContain('name="message"');
    expect(html).toContain('data-testid="contact-message"');
    expect(html).toContain('<textarea ');
    expect(html).toContain('></textarea>');
    // Submit affordance.
    expect(html).toContain('<button type="submit" data-testid="contact-submit">Send message</button>');
    expect(html).toContain('<h2>Other ways to reach us</h2>');
  });

  it('success pages carry their testids and back-home links', () => {
    const contactSuccess = pageHtml('contact-success');
    expect(contactSuccess).toContain('<title>Thanks for reaching out! — Nimbus Notes</title>');
    expect(contactSuccess).toContain('<h1 data-testid="contact-success">Thanks for reaching out!</h1>');
    expect(contactSuccess).toContain('data-testid="back-home"');
    expect(contactSuccess).toContain('>Back to home</a>');
    expect(contactSuccess).toContain('href="/"');

    const newsletterSuccess = pageHtml('newsletter-success');
    expect(newsletterSuccess).toContain(`<title>You're on the list! — Nimbus Notes</title>`);
    expect(newsletterSuccess).toContain(`<h1 data-testid="newsletter-success">You're on the list!</h1>`);
    expect(newsletterSuccess).toContain('data-testid="back-home"');
  });

  it('storage bindings land where the plan declares them', () => {
    // Cookie binding on the newsletter-success route.
    const server = fileContents('server.ts');
    expect(server).toContain(`"/newsletter-success.html": ["newsletter-email=newsletter-email; Path=/"]`);
    // localStorage write embedded on the contact-success page only.
    const contactSuccess = pageHtml('contact-success');
    expect(contactSuccess).toContain('<script>try{localStorage.setItem("contact-last-topic","contact-last-topic")}catch(e){}</script>');
    expect(pageHtml('index')).not.toContain('localStorage.setItem');
    expect(pageHtml('features')).not.toContain('localStorage.setItem');
  });
});

describe('golden b01 plan → generated README documentation', () => {
  it('documents routes, storage (verbatim limitation), journeys and the app name', () => {
    const readme = fileContents('README.md');
    expect(readme).toContain('# Nimbus Notes — synthesized candidate app');
    for (const path of ['/', '/features.html', '/pricing.html', '/contact.html', '/contact-success.html', '/newsletter-success.html']) {
      expect(readme).toContain(`\`${path}\``);
    }
    // The verbatim storage limitation sentence required by the packet.
    expect(readme).toContain("minidom replay never gates on storage; P4's paired runner owns storage verification.");
    // All four seeded journeys are documented as acceptance entries.
    for (const journeyId of [
      'journey_693afe48-c999-4e31-8328-ec1bd92d9780',
      'journey_3a803288-80fa-48d1-8cff-274d36bcc857',
      'journey_5bee1e16-86b8-4447-8c9e-26ee583a341a',
      'journey_05441478-5197-4c92-b553-b66ea11b84c3',
    ]) {
      expect(readme).toContain(journeyId);
    }
    expect(readme).toContain('`clapp-app-nimbus-notes`');
    expect(readme).toContain('PORT');
  });
});

describe('golden b01 plan → determinism', () => {
  it('generating twice yields byte-identical files and manifest', () => {
    const second = generateApp(GOLDEN_B01_PLAN);
    expect(JSON.stringify(second.files)).toBe(JSON.stringify(app.files));
    expect(second.manifest).toEqual(app.manifest);
    for (const [first, other] of app.files.map((file, index) => [file, second.files[index]] as const)) {
      expect(other).toBeDefined();
      expect(other?.contents).toBe(first.contents);
      expect(other?.path).toBe(first.path);
    }
  });
});
