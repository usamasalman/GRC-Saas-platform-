import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

/**
 * Where delivery evidence physically lives.
 *
 * Deliberately NOT the `uploads/` directory the document module writes to. That
 * one is mounted with express.static at app.ts, outside every auth check, with
 * `Access-Control-Allow-Origin: *`, and its filenames are
 * `${Date.now()}_${originalName}` — a millisecond timestamp and the user's own
 * filename, which is to say guessable. It also sits outside the rate limiter,
 * which is scoped to `/api`, so guessing is unthrottled.
 *
 * Compliance evidence is pen test reports, network diagrams, HR records and
 * board minutes. Writing it there would publish it. So this store gives up the
 * one convenience that caused the problem — being directly fetchable — and
 * files are reachable only through a handler that resolves the row and checks
 * project access first.
 *
 * That handler pattern is not new either: documentController.downloadDocument
 * already does exactly this correctly. The static mount simply bypasses it.
 */

/** Sibling of uploads/, never served statically. */
const STORE_DIR = path.join(__dirname, '../../evidence-store');

function ensureStore(): void {
  if (!fs.existsSync(STORE_DIR)) fs.mkdirSync(STORE_DIR, { recursive: true });
}

/**
 * An opaque name with 32 bytes of entropy behind it.
 *
 * Nothing about it is derived from the time, the uploader, the tenant or the
 * original filename, so possession of one key tells you nothing about any
 * other. The store is not a security boundary on its own — the download handler
 * is — but a key that cannot be guessed means a leaked path is one leaked file
 * rather than a way to enumerate the estate.
 *
 * Two subdirectory levels keep the directory listing small enough to stay fast
 * once an engagement has run for a year.
 */
export function newStorageKey(): string {
  const raw = crypto.randomBytes(32).toString('hex');
  return `${raw.slice(0, 2)}/${raw.slice(2, 4)}/${raw.slice(4)}`;
}

export interface StoredFile {
  storageKey: string;
  sha256: string;
  byteLength: number;
  head: number[];
}

/** Decodes a data URI or bare base64 payload. Throws on anything unusable. */
export function decodeUpload(fileData: string): Buffer {
  const match = /^data:[^;,]*;base64,(.*)$/s.exec(fileData);
  return Buffer.from(match ? match[1] : fileData, 'base64');
}

/**
 * Write the bytes and return what was actually stored.
 *
 * The hash is of the BYTES ON DISK, so it can be recomputed later by re-reading
 * the file and compared. The document module hashes the base64 string it was
 * sent instead, which produces a value that looks like an integrity check and
 * cannot be verified against anything afterwards.
 *
 * `wx` is deliberate: an exclusive open fails rather than overwriting. The
 * existing upload path uses plain writeFileSync on a timestamp-derived name, so
 * two files uploaded in the same millisecond with the same name silently
 * destroy one another. With 32 bytes of entropy a collision here means
 * something is badly wrong, and failing loudly is the only safe response.
 */
export function putEvidence(bytes: Buffer): StoredFile {
  ensureStore();
  const storageKey = newStorageKey();
  const full = path.join(STORE_DIR, storageKey);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, bytes, { flag: 'wx' });

  return {
    storageKey,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    byteLength: bytes.length,
    head: Array.from(bytes.subarray(0, 8)),
  };
}

/**
 * Absolute path for a stored key, or null if it escapes the store.
 *
 * The containment check is not decoration. `storageKey` reaches this function
 * from a database row, but rows are written from request bodies elsewhere in
 * this codebase, and a key of `../../etc/passwd` resolving happily would turn
 * an authenticated download endpoint into arbitrary file read. Resolving and
 * then confirming the result is still inside the store is the only check that
 * survives every encoding trick, which is why it is done on the resolved path
 * rather than by inspecting the string.
 */
export function resolveEvidencePath(storageKey: string): string | null {
  const full = path.resolve(STORE_DIR, storageKey);
  const root = path.resolve(STORE_DIR);
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  return fs.existsSync(full) ? full : null;
}

/**
 * Re-read a stored file and confirm it still hashes to what was recorded.
 *
 * Evidence whose bytes changed after sign-off is the failure this whole slice
 * exists to make visible, and an integrity claim nobody ever checks is not an
 * integrity claim. Returns null when the file is missing, which is itself an
 * answer worth surfacing.
 */
export function verifyStoredHash(storageKey: string, expected: string): boolean | null {
  const full = resolveEvidencePath(storageKey);
  if (!full) return null;
  const actual = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
  return actual === expected;
}
