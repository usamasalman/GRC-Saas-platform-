import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';

/**
 * The key comes from PDPL_ENCRYPTION_KEY (32 bytes, base64) and nowhere else.
 *
 * It used to be derived from a string written in this file, so anyone with the
 * repository could decrypt whatever it protected (QA-017). It is read when
 * first needed rather than at start-up: nothing encrypts personal data yet, so
 * a deployment that stores none needs no key, and encrypting or decrypting
 * without one refuses instead of falling back to a default.
 *
 *   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 */
function pdplKey(): Buffer {
  const raw = process.env.PDPL_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error('PDPL_ENCRYPTION_KEY is not set; personal data cannot be encrypted or read without it.');
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('PDPL_ENCRYPTION_KEY must be 32 bytes, base64-encoded.');
  }
  return key;
}

export const encryptPii = (text: string): string => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, pdplKey(), iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag().toString('hex');

  // Format: iv:encryptedData:authTag
  return `${iv.toString('hex')}:${encrypted}:${authTag}`;
};

export const decryptPii = (encryptedText: string): string => {
  const parts = encryptedText.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted text format');

  const [ivHex, encryptedHex, authTagHex] = parts;

  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, pdplKey(), iv);

  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
};
