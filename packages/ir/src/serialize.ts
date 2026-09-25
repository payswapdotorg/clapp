/**
 * @clapp/ir — deterministic serialization + filesystem persistence for IR
 * models.
 *
 * - `serializeIrModel` produces the CANONICAL JSON text of a model (sorted
 *   keys, stable escapes, compact, array order preserved — see
 *   canonical-json.ts). It VALIDATES first and refuses to serialize an
 *   invalid model: anything it emits is guaranteed to round-trip through
 *   `parseIrModel`, so a serialized model can never be a one-way door.
 * - `parseIrModel` is JSON.parse + `validateIrModelDetailed`; on failure it
 *   throws a SINGLE `IrSerializationError` whose message joins every
 *   path-qualified validation error (so the caller sees the whole picture,
 *   not just the first).
 * - `saveIrModel` / `loadIrModel` are fs persistence with an atomic-ish
 *   write (temp sibling + rename, so a crash mid-write can never leave a
 *   truncated file at the final path). Unlike @clapp/evidence's write-once
 *   bundle exports, saving OVERWRITES: an IR model is a living artifact
 *   that gets rebuilt and re-saved; durability comes from the rename, not
 *   from immutability. UTF-8 throughout.
 */

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { IrModel } from './ir-contract';
import { canonicalJson } from './canonical-json';
import { validateIrModelDetailed } from './validate';

/** Thrown when a model cannot be serialized or parsed. */
export class IrSerializationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IrSerializationError';
  }
}

/** Thrown when a model cannot be saved to / loaded from disk. */
export class IrPersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IrPersistenceError';
  }
}

function joinErrors(errors: readonly string[]): string {
  return errors.length === 1 ? errors[0] ?? '' : errors.map((e) => `- ${e}`).join('\n');
}

/**
 * Canonical JSON text of `model`. Throws {@link IrSerializationError} when
 * the model fails validation (never serialize an invalid model) or when it
 * is not canonical-JSON serializable (the validation pass already probes
 * this, so in practice the validation error surfaces first).
 */
export function serializeIrModel(model: IrModel): string {
  const result = validateIrModelDetailed(model);
  if (!result.valid) {
    throw new IrSerializationError(
      `cannot serialize an invalid IrModel (${result.errors.length} validation error(s)):\n${joinErrors(result.errors)}`,
    );
  }
  try {
    return canonicalJson(model);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new IrSerializationError(`IrModel is not canonical-JSON serializable: ${message}`);
  }
}

/**
 * Parse canonical (or any) JSON text into a validated `IrModel`. Throws a
 * single {@link IrSerializationError} — with every path-qualified violation
 * joined into the message — when the text is not valid JSON or does not
 * validate as an IrModel.
 */
export function parseIrModel(text: string): IrModel {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new IrSerializationError(`text is not valid JSON: ${message}`);
  }
  const result = validateIrModelDetailed(parsed);
  if (!result.valid) {
    throw new IrSerializationError(
      `parsed value is not a valid IrModel v0.1 (${result.errors.length} validation error(s)):\n${joinErrors(result.errors)}`,
    );
  }
  return parsed as IrModel;
}

/**
 * Serialize + atomically write `model` to `path` (UTF-8). The write goes to
 * a temp sibling first and is renamed into place, so a crash mid-write
 * never leaves a truncated model at `path`. Re-saving overwrites (models
 * are living artifacts). Parent directories are created as needed.
 */
export async function saveIrModel(path: string, model: IrModel): Promise<void> {
  if (typeof path !== 'string' || path.trim() === '') {
    throw new IrPersistenceError('saveIrModel requires a non-empty file path');
  }
  const text = serializeIrModel(model); // validate before touching the disk
  const bytes = new TextEncoder().encode(text);
  await mkdir(dirname(path), { recursive: true });
  const tmpPath = `${path}.tmp-${randomUUID()}`;
  try {
    await writeFile(tmpPath, bytes);
    await rename(tmpPath, path);
  } catch (error) {
    await rm(tmpPath, { force: true }).catch(() => undefined);
    const message = error instanceof Error ? error.message : String(error);
    throw new IrPersistenceError(`could not write IR model to ${path}: ${message}`);
  }
}

/**
 * Read UTF-8 text from `path` and parse it into a validated `IrModel`.
 * Throws {@link IrPersistenceError} when the file cannot be read and
 * {@link IrSerializationError} when it does not parse/validate.
 */
export async function loadIrModel(path: string): Promise<IrModel> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new IrPersistenceError(`could not read IR model from ${path}: ${message}`);
  }
  return parseIrModel(text);
}
