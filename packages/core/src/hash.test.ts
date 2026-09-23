import { describe, expect, it } from 'bun:test';
import { sha256Hex } from './index';

describe('packages/core sha256Hex (WebCrypto, bun + node portable)', () => {
  it('matches the known SHA-256 vector for "hello"', async () => {
    expect(await sha256Hex('hello')).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    );
  });

  it('matches the well-known empty-input digest', async () => {
    expect(await sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('accepts Uint8Array input and matches the equivalent string input', async () => {
    const text = 'clapp core contract v0 — run/event/artifact';
    const fromBytes = await sha256Hex(new TextEncoder().encode(text));
    const fromString = await sha256Hex(text);
    expect(fromBytes).toBe(fromString);
  });

  it('returns exactly 64 lowercase hex characters', async () => {
    expect(await sha256Hex('provenance')).toMatch(/^[0-9a-f]{64}$/);
  });
});
