// Must be a side-effect import, and must stay first. TypeScript hoists every
// `require` above statement bodies, so calling `dotenv.config()` here as a
// statement would run *after* './app' had already been loaded — and app.ts
// reads JWT_SECRET at module scope.
import 'dotenv/config';

import app from './app';
import { startEscalationScanner } from './services/slaService';
import { startRiskReviewScanner } from './services/riskLifecycle';

const PORT = Number(process.env.PORT) || 3000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Server]: GRC Wisdom API is running at http://0.0.0.0:${PORT}`);
  console.log(`[Server]: Environment: ${process.env.NODE_ENV || 'development'}`);
  // TRD §7.3: scan for at-risk/breached SLAs every 5 minutes.
  startEscalationScanner();
  // ISO 31000 clause 6.6: expire lapsed acceptances and surface overdue reviews.
  startRiskReviewScanner();
});
