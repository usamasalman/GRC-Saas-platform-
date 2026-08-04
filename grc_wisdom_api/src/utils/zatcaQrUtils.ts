export const generateZatcaQr = (
  sellerName: string,
  vatNumber: string,
  timestamp: string,
  totalAmount: string,
  vatAmount: string
): string => {
  // ZATCA requires a TLV (Tag-Length-Value) Base64 encoded string for the QR code.
  
  const toTlv = (tag: number, value: string): Buffer => {
    const valueBuffer = Buffer.from(value, 'utf8');
    const tagBuffer = Buffer.from([tag]);
    const lengthBuffer = Buffer.from([valueBuffer.length]);
    return Buffer.concat([tagBuffer, lengthBuffer, valueBuffer]);
  };

  const tlv1 = toTlv(1, sellerName);
  const tlv2 = toTlv(2, vatNumber);
  const tlv3 = toTlv(3, timestamp);
  const tlv4 = toTlv(4, totalAmount);
  const tlv5 = toTlv(5, vatAmount);

  const finalBuffer = Buffer.concat([tlv1, tlv2, tlv3, tlv4, tlv5]);
  return finalBuffer.toString('base64');
};
