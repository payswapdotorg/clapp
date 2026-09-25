/**
 * @clapp/ir — adapter honesty summaries (contract §8, doc §8).
 *
 * Every IR producer/consumer adapter declares its support honestly via
 * `IrAdapterInfo`. `describeIrAdapter` renders that declaration as a
 * human-readable summary and ENFORCES the honesty contract:
 *
 * - every entry of `unsupportedConstructs` is echoed VERBATIM in the
 *   summary (never silently dropped, never paraphrased);
 * - `degradationBehavior` is echoed verbatim;
 * - when the adapter does not declare support for the current
 *   IR_MODEL_VERSION, the summary says so explicitly in a NOTE line.
 *
 * Structurally malformed declarations (missing/empty adapterId, wrong
 * types, empty-string entries) throw {@link IrAdapterError} — an adapter
 * that cannot state its support honestly does not get a summary. Empty
 * ARRAYS are well-formed and render as "(none)".
 */

import type { IrAdapterInfo } from './ir-contract';
import { IR_MODEL_VERSION } from './ir-contract';

/** Thrown when an IrAdapterInfo declaration is structurally malformed. */
export class IrAdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IrAdapterError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireNonEmptyString(container: Record<string, unknown>, field: string): string {
  const value: unknown = container[field];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new IrAdapterError(`IrAdapterInfo.${field} must be a non-empty string, got ${JSON.stringify(value ?? null)}`);
  }
  return value;
}

function requireStringArray(container: Record<string, unknown>, field: string): string[] {
  const value: unknown = container[field];
  if (value === undefined || value === null) {
    throw new IrAdapterError(`IrAdapterInfo.${field} must be an array of strings`);
  }
  if (!Array.isArray(value)) {
    throw new IrAdapterError(`IrAdapterInfo.${field} must be an array of strings, got ${typeof value}`);
  }
  const out: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const entry: unknown = value[index];
    if (typeof entry !== 'string' || entry.trim() === '') {
      throw new IrAdapterError(
        `IrAdapterInfo.${field}[${index}] must be a non-empty string, got ${JSON.stringify(entry ?? null)}`,
      );
    }
    out.push(entry);
  }
  return out;
}

/**
 * Render an honest human summary of `info`. Every unsupported construct is
 * echoed verbatim; a missing declaration of support for the current
 * IR_MODEL_VERSION produces an explicit NOTE line. Throws
 * {@link IrAdapterError} on structurally malformed declarations.
 */
export function describeIrAdapter(info: IrAdapterInfo): string {
  if (!isRecord(info)) {
    throw new IrAdapterError(`IrAdapterInfo must be a non-null object, got ${info === null ? 'null' : typeof info}`);
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
  lines.push(`  emitted/read sections: ${emittedCapabilities.length > 0 ? emittedCapabilities.join(', ') : '(none)'}`);
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
