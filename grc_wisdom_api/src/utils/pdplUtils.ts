import crypto from 'crypto';

// In a real app, this MUST be a 32-byte key stored securely in an environment variable or HSM.
// For this mock, we use a static demo key.
const PDPL_ENCRYPTION_KEY = crypto.scryptSync('grc-wisdom-pdpl-secret-2026', 'salt', 32);
const ALGORITHM = 'aes-256-gcm';

export const encryptPii = (text: string): string => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, PDPL_ENCRYPTION_KEY, iv);
  
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
  const decipher = crypto.createDecipheriv(ALGORITHM, PDPL_ENCRYPTION_KEY, iv);
  
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
};
