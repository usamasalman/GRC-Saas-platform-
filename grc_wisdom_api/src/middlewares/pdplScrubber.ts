import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './authMiddleware';

/**
 * PDPL (Personal Data Protection Law) Scrubbing Interceptor.
 * Automatically redacts PII fields from JSON responses if the user lacks the 'PDPL_ADMIN' role.
 */
export const pdplScrubber = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
  const originalSend = res.json;
  
  res.json = function (body: any) {
    if (req.user && req.user.role !== 'PDPL_ADMIN') {
      scrubPii(body);
    }
    return originalSend.call(this, body);
  };
  
  next();
};

const scrubPii = (obj: any): void => {
  if (typeof obj !== 'object' || obj === null) return;
  
  const sensitiveFields = ['nationalId', 'phoneNumber', 'encryptedNationalId', 'encryptedPhone'];
  
  for (const key in obj) {
    if (sensitiveFields.includes(key)) {
      obj[key] = '[REDACTED FOR PDPL COMPLIANCE]';
    } else if (typeof obj[key] === 'object') {
      scrubPii(obj[key]); // Recursively scrub nested objects
    }
  }
};
