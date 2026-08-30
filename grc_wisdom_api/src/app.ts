import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import authRoutes from './routes/authRoutes';
import dbAdminRoutes from './routes/dbAdminRoutes';
import documentRoutes from './routes/documentRoutes';
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
import { requireAuth, enforceTenantIsolation } from './middlewares/authMiddleware';
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
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true, // only failed attempts count toward the budget
  message: {
    status: 'error',
    code: 'RATE_LIMITED',
    message: 'Too many attempts. Try again in a few minutes.',
  },
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
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

// Static uploads directory with cross-origin headers for PDF & document embedding
app.use('/uploads', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('X-Frame-Options', 'ALLOWALL');
  next();
}, express.static(path.join(__dirname, '../uploads')));

// Health Check Endpoint
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'success',
    message: 'GRC Wisdom API is running.',
    timestamp: new Date().toISOString()
  });
});

// Phase 0 Authentication Routes
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/mfa', authLimiter);
app.use('/api/auth/refresh', authLimiter);
app.use('/api/auth', authRoutes);

// Database Console Operations Route (Hidden from normal frontend navigation)
app.use('/api/admin/db', dbAdminRoutes);

// Phase 2 Document Management Routes
app.use('/api/documents', documentRoutes);

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

// Phase 1 WORM Audit Logs Endpoint (scope-aware per TRD §2.1)
app.get('/api/audit-logs', requireAuth, async (req: any, res: Response) => {
  try {
    const scope = await resolveTenantScope(req.user.tenantId);
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
    const scope = await resolveTenantScope(req.user.tenantId);
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
    const scope = await resolveTenantScope(req.user.tenantId);
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
    const scope = await resolveTenantScope(req.user.tenantId);
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
