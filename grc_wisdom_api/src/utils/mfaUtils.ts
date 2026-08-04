import { generateSecret, generateURI, verifySync } from 'otplib';
import qrcode from 'qrcode';

const ISSUER_DEFAULT = 'GRCWisdom';

/**
 * Generates a new TOTP secret + otpauth URI for enrollment in an authenticator app.
 */
export const generateMfaSecret = (userEmail: string, issuer = ISSUER_DEFAULT) => {
  const secret = generateSecret();
  const otpauthUrl = generateURI({ label: userEmail, issuer, secret });
  return { secret, otpauthUrl };
};

/**
 * Renders the otpauth URI as a QR-code data URL (embeddable directly in an <img src>).
 */
export const generateQrCodeUrl = async (otpauthUrl: string): Promise<string> => {
  return qrcode.toDataURL(otpauthUrl);
};

/**
 * Verifies a 6-digit TOTP code against the user's stored secret.
 */
export const verifyMfaToken = (token: string, secret: string): boolean => {
  const result = verifySync({ token, secret });
  return result.valid === true;
};
