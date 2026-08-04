import crypto from 'crypto';

/**
 * Generates a SHA-256 hash from a given string payload.
 * Used for chaining audit logs to ensure WORM compliance.
 */
export const generateHash = (payload: string): string => {
  return crypto.createHash('sha256').update(payload).digest('hex');
};

/**
 * Validates if the current hash matches the expected hash generated from the previous hash and the new payload.
 */
export const verifyHashChain = (previousHash: string, currentPayload: string, expectedHash: string): boolean => {
  const calculatedHash = generateHash(previousHash + currentPayload);
  return calculatedHash === expectedHash;
};
