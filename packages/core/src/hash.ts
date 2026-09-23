/**
 * Content hashing for provenance.
 *
 * Implemented on WebCrypto (`crypto.subtle`) so the exact same code path
 * works in bun and node — no dependency, no divergence between runtimes.
 */

/** Lowercase-hex SHA-256 of `data`. Strings are UTF-8 encoded first. */
export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  // WebCrypto's BufferSource must be an ArrayBuffer-backed view, while a
  // Uint8Array is allowed to be SharedArrayBuffer-backed at the type level.
  // Normalize external bytes through a tight copy so hashing never depends
  // on where the bytes happen to live; strings encode into a fresh buffer.
  const source =
    typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
  const digest = await crypto.subtle.digest('SHA-256', source);
  return toHex(new Uint8Array(digest));
}

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, '0');
  }
  return out;
}
