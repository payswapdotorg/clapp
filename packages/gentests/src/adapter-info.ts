/**
 * @clapp/gentests — adapter honesty summary (CLAPP-032).
 *
 * GENTESTS_ADAPTER_INFO is the IrAdapterInfo-shaped honesty summary this
 * package publishes about what the generated test suite does and does not
 * enforce. The shape mirrors @clapp/ir's IrAdapterInfo (adapterId /
 * supportedModelVersions / emittedCapabilities / unsupportedConstructs /
 * degradationBehavior) WITHOUT importing @clapp/ir — this package's frozen
 * dependency surface is @clapp/core + @clapp/journey only; the shape is
 * structural (all fields, same semantics), and the tech lead verifies the
 * alignment at integration.
 *
 * The "model version" this adapter consumes is the SynthesisPlan contract
 * version (PLAN_VERSION '0.1'), NOT the Behavioral IR model version: the
 * plan is this package's input contract.
 */

/**
 * IrAdapterInfo-shaped declaration (structural mirror of @clapp/ir's
 * contract §8 honesty summary; see module doc).
 */
export interface GentestsAdapterInfo {
  adapterId: string;
  /** plan contract versions this adapter consumes. */
  supportedModelVersions: string[];
  /** what the generated suite asserts. */
  emittedCapabilities: string[];
  /** constructs NOT enforced by the generated suite — never silently dropped. */
  unsupportedConstructs: string[];
  /** what happens when an unsupported construct is encountered. */
  degradationBehavior: string;
}

export const GENTESTS_ADAPTER_INFO: GentestsAdapterInfo = {
  adapterId: '@clapp/gentests/0.1 (CLAPP-032, synthesis-contract v0.1 consumer)',
  supportedModelVersions: ['0.1'],
  emittedCapabilities: [
    'route tests (one per planned route: 200 + text/html + every element testId, heading text, and form field label on the page)',
    'server health test (GET plan.server.healthPath → 200)',
    'api tests (one per planned endpoint: mocked endpoints answer statusCode + exact JSON body per mock in declaration order; unmocked endpoints answer 501 naming the endpoint)',
    'acceptance tests (journey replay through @clapp/journey createDomApplier/replayJourney with one appended assert-visible per must-see element — testId selector first, else role+name — plus final-route verification via a fetch-level echo)',
    'suite manifest (exact test counts + skipped acceptance ids)',
    'minimal conforming reference server (createConformingServer)',
    'suite writer (writeSuite)',
  ],
  unsupportedConstructs: [
    'plan.storage bindings — declared for the P4 paired runner; the journey applier executes no page scripts, so no storage assertions are generated',
    'plan.navigation transitions — exercised only indirectly via acceptance replays; no dedicated transition tests',
    'acceptance entries without a supplied journey record — emitted as it.skip and listed in SuiteManifest.skippedAcceptanceIds (never fabricated)',
    'must-see elements with neither a testId nor a role — no assert-visible can be derived; the generated file carries an explicit comment naming the gap',
    'must-see element ids absent from the plan pages — same honest-gap comment',
    'plan.api endpoint requestSchema/responseSchema/errorSchema descriptors — not asserted (mocks pin statusCode + body only)',
    'per-endpoint custom error statuses — the plan contract v0.1 declares none, so unmocked endpoints always expect 501',
    'multi-mock ordering semantics — pinned to sequential consumption with the last mock repeating (documented; @clapp/codegen must match)',
  ],
  degradationBehavior:
    'Anything the generator cannot verify is skipped or explicitly commented in the generated suite — never silently asserted; the SuiteManifest reports exact test counts and every skipped acceptance id, and generation itself throws on structurally unusable inputs (wrong planVersion, duplicate route paths, invalid or duplicate journey records).',
};
