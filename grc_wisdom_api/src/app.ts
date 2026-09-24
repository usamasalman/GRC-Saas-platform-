import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import path from 'path';
import authRoutes from './routes/authRoutes';
import dbAdminRoutes from './routes/dbAdminRoutes';
import documentRoutes from './routes/documentRoutes';
import retentionRoutes from './routes/retentionRoutes';
import legalHoldRoutes from './routes/legalHoldRoutes';
import adminSodRoutes from './routes/adminSodRoutes';
import passwordResetRoutes from './routes/passwordResetRoutes';
import tenantRoutes from './routes/tenantRoutes';
import impersonationRoutes from './routes/impersonationRoutes';
import iamRoutes from './routes/iamRoutes';
import itsmRoutes from './routes/itsmRoutes';
import grcRoutes from './routes/grcRoutes';
import notificationRoutes from './routes/notificationRoutes';
import marketplaceRoutes from './routes/marketplaceRoutes';
import billingRoutes from './routes/billingRoutes';
import usageRoutes from './routes/usageRoutes';
import systemRoutes from './routes/systemRoutes';
import projectRoutes from './routes/projectRoutes';
import { requireAuth, enforceTenantIsolation } from './middlewares/authMiddleware';
import { requireCapability, CAP } from './services/capabilityEngine';
import { SodViolation } from './services/sodEngine';
import { resolveTenantScope, auditCrossTenantRead } from './services/scopeResolver';
import { prisma } from './db';

// JWT_SECRET is mandatory. No hardcoded fallback — a leaked default key would
// let anyone with the repo forge valid tokens for any tenant (TRD §11.1).
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('[FATAL] JWT_SECRET must be set in .env and be at least 32 characters.');
  process.exit(1);
}

// Initialize Express
const app = express();

// Security Middlewares - allow cross-origin resource embedding for PDF/Document viewer
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  frameguard: false,
}));

// One reverse proxy (Caddy) sits in front of this process. Without this the
// rate limiter would see the proxy's IP for every caller and throttle everyone
// as if they were one client.
app.set('trust proxy', 1);

// ─── CORS: an explicit allow-list ───────────────────────────────────────────
// This previously ended in an unconditional `callback(null, true)`, so every
// branch reached the same answer and any website could call this API with a
// signed-in user's credentials. Origins now come from configuration only.
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || process.env.FRONTEND_URL || '')
  .split(',')
  .map((o) => o.trim().replace(/\/+$/, ''))
  .filter(Boolean);

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

if (IS_PRODUCTION && ALLOWED_ORIGINS.length === 0) {
  console.warn(
    '[CORS] No CORS_ORIGINS or FRONTEND_URL set. Only same-origin requests will '
    + 'be accepted. If the UI is served from a different host or port, set CORS_ORIGINS.'
  );
}

app.use(cors({
  origin: (origin, callback) => {
    // No Origin header means the request is not a cross-origin browser request:
    // curl, health checks, server-to-server, and same-origin navigations. CORS
    // does not apply to those, so there is nothing to refuse.
    if (!origin) return callback(null, true);

    const clean = origin.replace(/\/+$/, '');
    if (ALLOWED_ORIGINS.includes(clean)) return callback(null, true);

    // Development convenience only: the Vite dev server changes ports freely.
    if (!IS_PRODUCTION && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(clean)) {
      return callback(null, true);
    }

    // Refuse by withholding the CORS headers rather than throwing. The browser
    // blocks the response either way, and this keeps a probe from generating a
    // 500 and a stack trace in the logs.
    console.warn('[CORS] refused origin:', origin);
    return callback(null, false);
  },
  credentials: true
}));

// ─── Rate limiting ──────────────────────────────────────────────────────────
// A rateLimiter middleware existed in the tree but was imported by nothing, so
// nothing was limited. Credential endpoints get a tight budget; the rest of the
// API gets a ceiling that a real user will never reach but a scraper will.
//
// What a limit is counted against matters as much as its size. Everything was
// counted per network address, and a customer's staff share one: forty people
// working from one office had 29% of their requests refused on an idle server
// (QA-019), and ten mistyped passwords anywhere in an office locked everybody
// there out of signing in for fifteen minutes (QA-020).

/** The caller's address, with IPv6 grouped by /56 as the library recommends. */
const addressKey = (req: Request) => ipKeyGenerator(req.ip ?? '');

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true, // only failed attempts count toward the budget
  // A sign-in attempt counts against the account it names, from that address:
  // one person's typos are theirs alone. MFA codes and token refreshes carry no
  // account name and stay per address -- keying them per user would give an
  // attacker holding a password a fresh budget of guesses at the second factor.
  keyGenerator: (req) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    return email ? `account:${email}|${addressKey(req)}` : `address:${addressKey(req)}`;
  },
  message: {
    status: 'error',
    code: 'RATE_LIMITED',
    message: 'Too many attempts. Try again in a few minutes.',
  },
});

// And a ceiling per address across every account, so one machine cannot try a
// common password against account after account. Thirty failed sign-ins in
// fifteen minutes is far beyond an office's typos and far below spraying.
const authAddressLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `address:${addressKey(req)}`,
  message: {
    status: 'error',
    code: 'RATE_LIMITED',
    message: 'Too many failed sign-ins from this network. Try again in a few minutes.',
  },
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  // Per person when the request carries a valid session, per address when it
  // does not. The token is verified, not just read: an unverified claim would
  // let anyone mint a new budget per request.
  keyGenerator: (req) => {
    const auth = req.headers.authorization;
    const secret = process.env.JWT_SECRET;
    if (auth?.startsWith('Bearer ') && secret) {
      try {
        const claims = jwt.verify(auth.slice(7), secret) as { id?: string };
        if (claims?.id) return `user:${claims.id}`;
      } catch {
        // Expired or forged: counted by address, and requireAuth refuses it anyway.
      }
    }
    return `address:${addressKey(req)}`;
  },
  message: {
    status: 'error',
    code: 'RATE_LIMITED',
    message: 'Too many requests. Please slow down.',
  },
});

app.use('/api', apiLimiter);

// Body Parsing (50mb limit for document file uploads)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// uploads/ is NOT served statically.
//
// It used to be, mounted here with `Access-Control-Allow-Origin: *` and
// `X-Frame-Options: ALLOWALL`, ahead of every authentication check. That
// published every tenant's document library to the open internet: policies,
// pen test reports, board minutes, HR records. Filenames are
// `${Date.now()}_${originalName}`, so a plausible document name plus a guessed
// millisecond was the whole attack, and the rate limiter is scoped to `/api`,
// so guessing it was unthrottled.
//
// documentController.downloadDocument already does this correctly: it resolves
// the document row, checks the caller's tenant scope, and streams the file from
// disk. It reads UPLOADS_DIR directly and never needed the HTTP mount, so
// removing this changes nothing about upload or download.
//
// Nothing else depended on it either. The frontend fetches
// /api/documents/:id/download; delivery evidence deliberately lives in a
// separate private store (services/evidenceStore); and branding logos are
// deliberately kept out of uploads/ for this exact reason
// (controllers/brandingController.uploadLogo). Both of those comments describe
// this mount as the hazard they were written to avoid.
//
// If a file ever needs to be embeddable by URL, give it a handler that checks
// access and issues a short-lived signed link. Do not remount this directory.

// Health Check Endpoint
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'success',
    message: 'GRC Wisdom API is running.',
    timestamp: new Date().toISOString()
  });
});

// Phase 0 Authentication Routes
app.use('/api/auth/login', authLimiter, authAddressLimiter);
app.use('/api/auth/mfa', authLimiter);
app.use('/api/auth/refresh', authLimiter);
app.use('/api/auth', authRoutes);

// Database Console Operations Route (Hidden from normal frontend navigation)
app.use('/api/admin/db', dbAdminRoutes);

// Phase 2 Document Management Routes
app.use('/api/documents', documentRoutes);

// Retention schedules, the disposition queue and disposal. The Governance
// menu has offered "Retention Schedules" from the start and rendered the audit
// log; there was no model, no column and no endpoint behind it.
app.use('/api/retention', retentionRoutes);

// Legal matters, and the documents they hold. A hold was four columns and a
// free-text matter typed per document; the three endpoints that placed one had
// no caller, and the Legal Hold menu entry rendered the audit log.
app.use('/api/legal', legalHoldRoutes);

// Phase 1 SoD Engine — admin CRUD for rules
app.use('/api/admin/sod-rules', adminSodRoutes);

// Phase 0 Password Reset — user requests + admin approvals
app.use('/api/password-reset', authLimiter, passwordResetRoutes);

// Phase 1 Tenant provisioning + scope-aware hierarchy
app.use('/api/tenants', tenantRoutes);

// Phase 1 Read-only impersonation (customer-authorized support access)
app.use('/api/impersonation', impersonationRoutes);

// Phase 1 IAM — roles, capabilities, user directory and lifecycle
app.use('/api/iam', iamRoutes);

// Phase 3 ITSM + the generic workflow engine that backs it (TRD §6.6, §7.3)
app.use('/api/itsm', itsmRoutes);

// Phase 4 GRC Core — standards, controls, implementations, evidence (TRD §7.2)
app.use('/api/grc', grcRoutes);
app.use('/api/notifications', notificationRoutes);

// Modules, Open Source Tools & Feature Flags (Modules & Entitlements)
app.use('/api/marketplace', marketplaceRoutes);

// Subscriptions & Billing (Subscriptions, Plans, Invoices, Payments, Gateway)
app.use('/api/billing', billingRoutes);

// Usage & Automation (Quotas, Rules Engine, Imports & Migration)
app.use('/api/usage', usageRoutes);

// System & Infrastructure (Health & Jobs, Platform Security, OCI Architecture, BRD Traceability)
app.use('/api/system', systemRoutes);

// Delivery projects (slice 1: the engagement itself)
app.use('/api/projects', projectRoutes);

// Phase 1 WORM Audit Logs Endpoint (scope-aware per TRD §2.1)
//
// requireAuth alone was not enough, and it was the only guard here. Tenant
// scoping was correct — a member never saw another organisation's entries —
// but inside their own tenancy every signed-in person could read the 200 most
// recent entries with the raw `payload` on each. Those payloads carry the
// substance: an offboarding entry names the leaver and their successor, a
// document entry names the policy and its approver, an SLA entry carries the
// old and new targets, an invoice entry the figures. A contributor on one
// register could read who was let go last month.
//
// READ_AUDIT_TRAIL is held by assurance, platform security and the roles
// accountable for a tenancy — 16 of 42. It is the one capability in this model
// that gates a read, and capabilityEngine.ts says why that exception is right
// here and nowhere else.
app.get('/api/audit-logs', requireAuth, requireCapability(CAP.READ_AUDIT_TRAIL), async (req: any, res: Response) => {
  try {
    const scope = await resolveTenantScope(req.user);
    await auditCrossTenantRead(scope, req.user.id, 'audit-logs.list');
    const logs = await prisma.auditLog.findMany({
      where: { tenantId: { in: scope.tenantIds } },
      include: {
        actor: { select: { name: true, email: true } },
        tenant: { select: { name: true } }
      },
      orderBy: { timestamp: 'desc' },
      take: 200
    });
    res.json({ status: 'success', scope: scope.kind, count: logs.length, logs });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: 'Failed to fetch audit logs' });
  }
});

// Legacy alias — the full ITSM surface is /api/itsm/tickets.
app.get('/api/tickets', requireAuth, async (req: any, res: Response) => {
  try {
    const scope = await resolveTenantScope(req.user);
    await auditCrossTenantRead(scope, req.user.id, 'tickets.list');
    const tickets = await prisma.ticket.findMany({
      where: { tenantId: { in: scope.tenantIds } },
      include: {
        requester: { select: { name: true, email: true } },
        assignee: { select: { name: true, email: true } },
        tenant: { select: { name: true } }
      },
      orderBy: { updatedAt: 'desc' }
    });
    res.json({ status: 'success', scope: scope.kind, count: tickets.length, tickets });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: 'Failed to fetch tickets' });
  }
});

// Phase 1 ASM Endpoint
app.get('/api/asm/assets', requireAuth, async (req: any, res: Response) => {
  try {
    const scope = await resolveTenantScope(req.user);
    await auditCrossTenantRead(scope, req.user.id, 'asm.assets.list');
    const assets = await prisma.asmAsset.findMany({
      where: { tenantId: { in: scope.tenantIds } },
      include: { tenant: { select: { name: true } } },
      orderBy: { createdAt: 'desc' }
    });
    res.json({ status: 'success', scope: scope.kind, count: assets.length, assets });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: 'Failed to fetch ASM assets' });
  }
});

// Phase 1 Eye Phish Endpoint
app.get('/api/phish/campaigns', requireAuth, async (req: any, res: Response) => {
  try {
    const scope = await resolveTenantScope(req.user);
    await auditCrossTenantRead(scope, req.user.id, 'phish.campaigns.list');
    const campaigns = await prisma.phishCampaign.findMany({
      where: { tenantId: { in: scope.tenantIds } },
      include: { tenant: { select: { name: true } } },
      orderBy: { createdAt: 'desc' }
    });
    res.json({ status: 'success', scope: scope.kind, count: campaigns.length, campaigns });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: 'Failed to fetch phish campaigns' });
  }
});

// Phase 1 Open Source Tool Marketplace Endpoint
app.get('/api/marketplace/tools', async (req: Request, res: Response) => {
  try {
    const tools = await prisma.openSourceTool.findMany({
      orderBy: { name: 'asc' }
    });
    res.json({ status: 'success', tools });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: 'Failed to fetch marketplace tools' });
  }
});

// Global Fallback Error Handler
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  // SoD violations are a first-class 403 — do not leak the stack trace.
  if (err instanceof SodViolation) {
    res.status(403).json({
      status: 'error',
      code: err.code,
      rule: err.ruleKey,
      conflictAction: err.conflictAction,
      message: err.message,
    });
    return;
  }
  console.error('[Global API Error]:', err.stack || err);

  const status = err.status || 500;

  // Below 500 the message is something we wrote deliberately (validation, a
  // business rule) and the caller needs to read it. At 500 the text comes from
  // whatever threw — a Prisma error carries table and column names, a filesystem
  // error carries absolute paths. In production that detail stays in the log.
  const message = status < 500
    ? (err.message || 'Request could not be completed')
    : IS_PRODUCTION
      ? 'Internal Server Error'
      : (err.message || 'Internal Server Error');

  res.status(status).json({ status: 'error', message });
});

export default app;
