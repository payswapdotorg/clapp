// Internal module (NOT exported from the package root): low-level filesystem
// primitives for the fs-backed stores — ENOENT-aware reads, pretty JSON
// files, append-only JSONL appends, and write-once content-addressed blobs.

import { appendFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { bytesEqual, StoreIntegrityError, stringifyJsonLine, stringifyJsonPretty } from './shared';

export function isNotFound(error: unknown): boolean {
  return error instanceof Error && (error as { code?: unknown }).code === 'ENOENT';
}

export async function readTextFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

export async function readBinaryFile(path: string): Promise<Uint8Array | null> {
  try {
    return await readFile(path);
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

export async function readJsonFile(path: string): Promise<unknown | null> {
  const text = await readTextFile(path);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new StoreIntegrityError(`${path}: malformed JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, stringifyJsonPretty(value), 'utf8');
}

export async function appendJsonlLine(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${stringifyJsonLine(value)}\n`, 'utf8');
}

/**
 * Write-once blob semantics: if the blob already exists, its content must
 * byte-equal `bytes` (dedupe); divergence is an integrity error and NEVER an
 * overwrite. New blobs are written to a temp sibling and renamed into place,
 * so a crash mid-write can never leave a truncated blob at the final path
 * (a stray `.tmp-*` sibling is inert garbage, never addressed by any key).
 */
export async function writeBlobOnce(path: string, bytes: Uint8Array): Promise<void> {
  if (existsSync(path)) {
    const current = await readFile(path);
    if (!bytesEqual(current, bytes)) {
      throw new StoreIntegrityError(
        `refusing to overwrite blob ${path}: existing content differs from its sha256-addressed bytes`,
      );
    }
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  const tmpPath = `${path}.tmp-${randomUUID()}`;
  try {
    await writeFile(tmpPath, bytes);
    await rename(tmpPath, path);
  } catch (error) {
    await rm(tmpPath, { force: true }).catch(() => undefined);
    throw error;
  }
}
