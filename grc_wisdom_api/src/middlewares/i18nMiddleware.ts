import { Request, Response, NextFunction } from 'express';

export interface I18nRequest extends Request {
  language?: string;
  isRtl?: boolean;
}

export const i18nMiddleware = (req: I18nRequest, res: Response, next: NextFunction): void => {
  // Read the Accept-Language header
  const langHeader = req.headers['accept-language'];
  
  // Default to English if not provided
  let locale = 'en';

  if (langHeader) {
    // Basic parser for Accept-Language (e.g., "ar-SA,ar;q=0.9,en;q=0.8")
    if (langHeader.toLowerCase().startsWith('ar')) {
      locale = 'ar';
    }
  }

  req.language = locale;
  req.isRtl = locale === 'ar';

  // Attach a translation helper function to the response locals
  // This allows controllers to easily call res.locals.t('key')
  res.locals.locale = locale;
  res.locals.isRtl = req.isRtl;

  next();
};
