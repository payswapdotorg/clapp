/**
 * @clapp/plan — adapter honesty summary (contract §8 discipline, IrAdapterInfo
 * shape re-used from @clapp/ir because the planner is an IR CONSUMER adapter:
 * it reads Behavioral IR models and declares what it emits and skips).
 *
 * `PLAN_ADAPTER_INFO` is the planner's standing declaration; `describePlanAdapter`
 * renders it as a human-readable summary and enforces the same honesty
 * contract as @clapp/ir's describeIrAdapter: every `unsupportedConstructs`
 * entry is echoed VERBATIM (never silently dropped, never paraphrased) and
 * `degradationBehavior` is echoed verbatim. Structurally malformed
 * declarations throw {@link PlanAdapterError} — an adapter that cannot
 * state its support honestly does not get a summary.
 */

import type { IrAdapterInfo } from '@clapp/ir';
import { IR_MODEL_VERSION } from '@clapp/ir';
import { PLAN_VERSION } from './synthesis-contract';

/** Thrown when an adapter declaration is structurally malformed. */
export class PlanAdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlanAdapterError';
  }
}

/**
 * The planner's honest declaration (IrAdapterInfo-shaped): what it reads,
 * what it emits, and what it deliberately does not map — every entry below
 * is also visible as plan assumptions on models that contain the construct.
 */
export const PLAN_ADAPTER_INFO: IrAdapterInfo = {
  adapterId: '@clapp/plan',
  supportedModelVersions: [IR_MODEL_VERSION],
  emittedCapabilities: [
    `SynthesisPlan v${PLAN_VERSION} (application, routes, pages, elements, forms, navigation, storage, api endpoints + mocks, acceptance, server spec)`,
    'routes+pages from IrScreens (one route per observed screen, title from the lowest-level heading with usable text)',
    'elements from IrComponents (role/name/testId/text/href/alt preserved verbatim; every component becomes an element)',
    'forms from textbox+button components, gated by observed submit transitions (method "get" + assumption — IR v0.1 cannot observe form methods)',
    'navigation from IrTransitions (link/form-submit triggers when derivable from the transition input; redirect + assumption otherwise)',
    'storage bindings from IrDataEntity persistence entries (localStorage/sessionStorage/cookie parsed; writtenOn from side-effect mentions)',
    'api endpoints from http-transport IrApiOperations with a method (schemas passed through) + one sketched MockResponse per responseSchema',
    'acceptance from input Journey records (expected route + must-see elements resolved against planned elements by testId first, then role+name)',
  ],
  unsupportedConstructs: [
    'websocket-transport api operations (skipped with one plan assumption per model — never silent; ws planning requires an ADR)',
    'http api operations without a method (skipped with a plan assumption listing them)',
    'form fields beyond textbox-role components (combobox/checkbox/radio/slider/spinbutton/searchbox become plain elements — extending the field-role vocabulary requires an ADR)',
    'element-level triggers for click transitions whose input names no unique link (planned as redirect with an assumption; IR v0.1 records no act-target on transitions)',
    'HTTP form methods other than "get" (never observable in IR v0.1; every form carries a "get" assumption)',
    'images, landmarks, and text not enumerated as components by the producing adapter (e.g. exploration actionables exclude img and contentinfo — their assert targets get assumption entries)',
    'screens behind entrypoints that have no IrScreen (unplannable — planSynthesis throws rather than fabricating routes)',
  ],
  degradationBehavior:
    'unsupported constructs stay ABSENT, never null, and every skip is documented in the plan assumptions list — nothing is silently dropped or fabricated',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireNonEmptyString(container: Record<string, unknown>, field: string): string {
  const value: unknown = container[field];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new PlanAdapterError(`IrAdapterInfo.${field} must be a non-empty string, got ${JSON.stringify(value ?? null)}`);
  }
  return value;
}

function requireStringArray(container: Record<string, unknown>, field: string): string[] {
  const value: unknown = container[field];
  if (value === undefined || value === null) {
    throw new PlanAdapterError(`IrAdapterInfo.${field} must be an array of strings`);
  }
  if (!Array.isArray(value)) {
    throw new PlanAdapterError(`IrAdapterInfo.${field} must be an array of strings, got ${typeof value}`);
  }
  const out: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const entry: unknown = value[index];
    if (typeof entry !== 'string' || entry.trim() === '') {
      throw new PlanAdapterError(
        `IrAdapterInfo.${field}[${index}] must be a non-empty string, got ${JSON.stringify(entry ?? null)}`,
      );
    }
    out.push(entry);
  }
  return out;
}

/**
 * Render an honest human summary of `info`. Every unsupported construct is
 * echoed verbatim. Throws {@link PlanAdapterError} on structurally malformed
 * declarations. (Same contract as @clapp/ir's describeIrAdapter; local
 * implementation so the plan package keeps a single import from @clapp/ir's
 * public surface for this, per the mirror discipline.)
 */
export function describePlanAdapter(info: IrAdapterInfo): string {
  if (!isRecord(info)) {
    throw new PlanAdapterError(`IrAdapterInfo must be a non-null object, got ${info === null ? 'null' : typeof info}`);
  }
  const adapterId = requireNonEmptyString(info, 'adapterId');
  const supportedModelVersions = requireStringArray(info, 'supportedModelVersions');
  const emittedCapabilities = requireStringArray(info, 'emittedCapabilities');
  const unsupportedConstructs = requireStringArray(info, 'unsupportedConstructs');
  const degradationBehavior = requireNonEmptyString(info, 'degradationBehavior');

  const lines: string[] = [];
  lines.push(`IR adapter ${adapterId}`);
  lines.push(
    `  supported model versions: ${supportedModelVersions.length > 0 ? supportedModelVersions.join(', ') : '(none)'}`,
  );
  lines.push(
    `  emitted/read sections: ${emittedCapabilities.length > 0 ? emittedCapabilities.join(', ') : '(none)'}`,
  );
  if (unsupportedConstructs.length === 0) {
    lines.push('  unsupported constructs: none');
  } else {
    lines.push(`  unsupported constructs (${unsupportedConstructs.length}, verbatim):`);
    for (const construct of unsupportedConstructs) {
      lines.push(`    - ${construct}`);
    }
  }
  lines.push(`  degradation behavior: ${degradationBehavior}`);
  if (!supportedModelVersions.includes(IR_MODEL_VERSION)) {
    lines.push(
      `  NOTE: this adapter does not declare support for IR model version ${IR_MODEL_VERSION} (the current contract version).`,
    );
  }
  return lines.join('\n');
}
