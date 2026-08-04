import crypto from 'crypto';

/**
 * ZATCA requires an ECDSA signature over the Base64 representation of the SHA-256 hash of the XML invoice.
 */
export const signZatcaInvoice = (xmlContent: string): { hashBase64: string, signatureBase64: string } => {
  // 1. Generate SHA-256 hash of the XML
  const hash = crypto.createHash('sha256').update(xmlContent).digest();
  const hashBase64 = hash.toString('base64');

  // In a real production environment, you would use a Private Key issued by ZATCA (FATOORA portal).
  // We simulate the ECDSA signing here.
  
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'secp256k1' });
  
  const sign = crypto.createSign('SHA256');
  sign.update(hashBase64);
  sign.end();
  
  const signature = sign.sign(privateKey);
  const signatureBase64 = signature.toString('base64');

  return { hashBase64, signatureBase64 };
};
