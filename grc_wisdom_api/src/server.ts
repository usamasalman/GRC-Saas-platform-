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

  // The scheduled jobs run in exactly one process. With more than one API
  // process -- the way to use more than one CPU core -- every process would
  // otherwise run every scan, and each SLA escalation and review notice would
  // go out once per process (QA-023). One process keeps the default; set
  // RUN_BACKGROUND_JOBS=false on every other.
  if (process.env.RUN_BACKGROUND_JOBS !== 'false') {
    // TRD §7.3: scan for at-risk/breached SLAs every 5 minutes.
    startEscalationScanner();
    // ISO 31000 clause 6.6: expire lapsed acceptances and surface overdue reviews.
    startRiskReviewScanner();
  } else {
    console.log('[Server]: Background jobs are off in this process (RUN_BACKGROUND_JOBS=false).');
  }
});
