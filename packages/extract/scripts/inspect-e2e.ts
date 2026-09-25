// One-off debug inspection of the e2e pipeline output (not a test).
import { chromium } from 'playwright';
import { resolveFixtureRoot, startFixtureServer } from '@clapp/journey';
import { MemoryArtifactStore, MemoryRunStore } from '@clapp/store';
import { RecordingSession, buildBundle, loadRunFromStores } from '@clapp/evidence';
import { createPlaywrightDriverFactory, ObservationRunner } from '@clapp/observe';
import { extractIrModel } from '../src/index';

const server = await startFixtureServer({ root: resolveFixtureRoot() });
const browser = await chromium.launch({ headless: true });
const runStore = new MemoryRunStore();
const artifactStore = new MemoryArtifactStore();
const session = await RecordingSession.start({ runStore, artifactStore }, {
  targetId: 'bench/b01-static',
  environment: { browser: 'chromium', os: process.platform, network: 'deny-all' },
});
const steps = ['/', '/pricing.html', '/features.html'].flatMap((route) => [
  { type: 'navigate', url: new URL(route, server.url).href },
  { type: 'settle', ms: 500 },
  { type: 'capture-dom' },
  { type: 'screenshot' },
]);
steps.push({ type: 'flush' });
const runner = new ObservationRunner({
  recorder: session,
  sessionFactory: createPlaywrightDriverFactory({ browser }),
  script: { targetId: 'bench/b01-static', steps },
});
const observation = await runner.run();
console.log('observation steps ok:', observation.steps.every((step) => step.ok), '| records:', observation.recordCount);
await session.complete();
const loaded = await loadRunFromStores({ runStore, artifactStore }, session.runId);
const bundle = await buildBundle(loaded!);
const { model, warnings, stats } = await extractIrModel({ bundle, readArtifact: (id) => artifactStore.readBytes(id) });

console.log('=== stats ===', JSON.stringify(stats, null, 2));
console.log('=== screens ===', model.screens.map((s) => s.route));
console.log('=== components per screen ===', model.screens.map((s) => ({
  route: s.route,
  count: model.components.filter((c) => c.screenId === s.id).length,
})));
console.log('=== component sample (home) ===');
for (const component of model.components.filter((c) => c.screenId === model.screens[0]!.id).slice(0, 6)) {
  console.log('  ', component.role, '|', JSON.stringify(component.properties['name']), '| events:', component.events.join(','));
}
console.log('=== transitions ===');
for (const transition of model.state.transitions) {
  const routeById = new Map(model.screens.map((s) => [s.id, s.route]));
  console.log('  ', routeById.get(transition.fromScreenId), '->', routeById.get(transition.toScreenId), '| input:', JSON.stringify(transition.input), '| outputs:', JSON.stringify(transition.outputs));
}
console.log('=== operations ===');
for (const operation of model.api.operations) {
  console.log('  ', operation.transport, operation.method ?? '', operation.urlPattern, '|', operation.replayability, '|', operation.provenance.level, '| examples:', operation.observedExamples.length);
}
console.log('=== evidence catalog ===', model.evidence.length, 'entries');
console.log('=== warnings ===');
for (const warning of warnings) {
  console.log('  -', warning);
}
console.log('=== assumptions ===', model.assumptions.length);
console.log('=== model JSON size ===', JSON.stringify(model).length, 'bytes');
console.log('=== modelVersion ===', model.modelVersion, '| app:', JSON.stringify(model.application), '| env:', JSON.stringify(model.environment));

await server.close();
await browser.close();
