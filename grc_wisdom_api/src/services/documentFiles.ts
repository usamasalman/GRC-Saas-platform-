import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { decodeUpload, putEvidence, resolveEvidencePath } from './evidenceStore';
import {
  checkEvidenceFile, sniffMime, extensionOf, MAX_EVIDENCE_BYTES, EvidenceRefusal,
} from './projectEvidence';

/**
 * A document library file: written, found, hashed and removed.
 *
 * The library had an upload path of its own, weaker than the one delivery
 * evidence goes through. It stored whatever content type the caller declared,
 * took any extension at any size the 50 MB body limit let through, recorded a
 * hash of the base64 text rather than of the bytes — a value that looks like an
 * integrity check and cannot be re-checked against anything — and named files
 * `${Date.now()}_${originalName}`, which is guessable.
 *
 * New files now go through the evidence path itself rather than a copy of it:
 * checkEvidenceFile for the refusals, sniffMime for the type, putEvidence for an
 * opaque key and the SHA-256 of the bytes on disk. A copy would drift; this
 * cannot.
 *
 * Two shapes of `fileUrl` exist, and both are read:
 *
 *   store:<storageKey>        written from now on, in the evidence store
 *   /uploads/<ts>_<name>      written before, and left exactly where it is
 *
 * Old rows are not rewritten and old files are not moved. Their fileHash stays
 * what it was, because rewriting a stored integrity value is precisely the act
 * the column exists to make visible.
 */

const UPLOADS_DIR = path.join(__dirname, '../../uploads');
const LEGACY_PREFIX = '/uploads/';
const STORE_PREFIX = 'store:';

export interface StoredDocumentFile {
  fileUrl: string;
  fileName: string;
  fileSize: number;
  /** From the bytes, never from the caller. */
  fileType: string;
  /** SHA-256 of the bytes as written to disk. */
  fileHash: string;
}

export type DocumentUpload =
  | { ok: true; file: StoredDocumentFile }
  | { ok: false; refusal: EvidenceRefusal };

/**
 * The evidence rules, said in the library's words. The rule is not restated
 * here — only the sentence a person reads, which named "evidence" to somebody
 * attaching a policy.
 */
function inLibraryWords(refusal: EvidenceRefusal, fileName: string): EvidenceRefusal {
  switch (refusal.code) {
    case 'FILE_TOO_LARGE':
      return {
        ...refusal,
        message: `Document files are limited to ${Math.floor(MAX_EVIDENCE_BYTES / 1024 / 1024)} MB.`,
      };
    case 'DANGEROUS_TYPE':
      return {
        ...refusal,
        message: `.${extensionOf(fileName)} files are not accepted in the document library. `
          + 'Attach a document, spreadsheet, image or PDF.',
      };
    default:
      return refusal;
  }
}

/**
 * Check, then store. Nothing is written for a refused file.
 *
 * Whatever type the caller declared — the `fileType` field, or the prefix of a
 * data URI — is not an input here at all. It says what the uploader wanted a
 * browser to believe, and the stored type decides how the file is served.
 */
export function storeDocumentFile(fileData: string, fileName: string): DocumentUpload {
  const bytes = decodeUpload(fileData);
  const refusal = checkEvidenceFile(fileName, bytes.length);
  if (refusal) return { ok: false, refusal: inLibraryWords(refusal, fileName) };

  const stored = putEvidence(bytes);
  return {
    ok: true,
    file: {
      fileUrl: `${STORE_PREFIX}${stored.storageKey}`,
      fileName,
      fileSize: stored.byteLength,
      fileType: sniffMime(stored.head, fileName),
      fileHash: stored.sha256,
    },
  };
}

/** True for a file written through storeDocumentFile. */
export const isStoredDocumentFile = (fileUrl: unknown): boolean =>
  typeof fileUrl === 'string' && fileUrl.startsWith(STORE_PREFIX);

/**
 * Absolute path of a document's file, or null when there is none on disk.
 *
 * Both shapes are confined to their own directory on the resolved path. The
 * legacy branch used to join whatever followed `/uploads/` onto the directory
 * unchecked; the server only ever wrote plain names there, so confining it
 * changes nothing for a real file.
 */
export function resolveDocumentFile(fileUrl: unknown): string | null {
  if (typeof fileUrl !== 'string') return null;
  if (fileUrl.startsWith(STORE_PREFIX)) {
    return resolveEvidencePath(fileUrl.slice(STORE_PREFIX.length));
  }
  if (fileUrl.startsWith(LEGACY_PREFIX)) {
    const root = path.resolve(UPLOADS_DIR);
    const full = path.resolve(root, fileUrl.slice(LEGACY_PREFIX.length));
    if (!full.startsWith(root + path.sep)) return null;
    return fs.existsSync(full) ? full : null;
  }
  return null;
}

/** The first bytes of a file on disk: as many as sniffMime looks at. */
function headOf(full: string): number[] {
  const fd = fs.openSync(full, 'r');
  try {
    const buf = Buffer.alloc(8);
    const read = fs.readSync(fd, buf, 0, buf.length, 0);
    return Array.from(buf.subarray(0, read));
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * The Content-Type a document's file is served as. Never its extension's.
 *
 * A stored file is served as the type read from its bytes when it was written.
 * A file in uploads/ predates that and went out as whatever its extension
 * said, and the old upload path took any extension — so an .html or .svg put
 * there then went out as text/html or image/svg+xml. The reader pane frames
 * what it is sent as a blob in the app's own origin, which made such a file
 * stored XSS against whoever opened it: an approver, typically.
 *
 * An old file is typed from its bytes now, by the same sniffMime a new one
 * goes through, read at download because the row's own type was the caller's.
 * Markup has no signature there, so it goes out as application/octet-stream:
 * downloadable, never displayed. The row and the file stay as they are.
 */
export function servedTypeOf(fileUrl: unknown, fileType: unknown, full: string): string {
  if (isStoredDocumentFile(fileUrl)) {
    return typeof fileType === 'string' && fileType ? fileType : 'application/octet-stream';
  }
  return sniffMime(headOf(full), path.basename(full));
}

/**
 * SHA-256 of a document's file as it is on disk now, or null without one.
 *
 * For a version that carries the previous version's file forward: the hash it
 * records is then of the bytes it points at, which can be checked again later,
 * rather than of the text body sitting next to them.
 */
export function hashDocumentFile(fileUrl: unknown): string | null {
  const full = resolveDocumentFile(fileUrl);
  if (!full) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
}

/**
 * Delete a document's file. False when there was nothing on disk to delete.
 * Throws if the delete itself fails, so a caller can say the bytes remain.
 */
export function removeDocumentFile(fileUrl: unknown): boolean {
  const full = resolveDocumentFile(fileUrl);
  if (!full) return false;
  fs.unlinkSync(full);
  return true;
}
