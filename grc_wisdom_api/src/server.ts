import dotenv from 'dotenv';
// Load environment variables before importing app
dotenv.config();

import app from './app';
import { startEscalationScanner } from './services/slaService';

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`[Server]: GRC Wisdom API is running at http://localhost:${PORT}`);
  console.log(`[Server]: Environment: ${process.env.NODE_ENV || 'development'}`);
  // TRD §7.3: scan for at-risk/breached SLAs every 5 minutes.
  startEscalationScanner();
});
