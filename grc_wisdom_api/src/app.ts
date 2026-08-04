import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
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

// CORS Configuration
const allowedOrigins = process.env.FRONTEND_URL
  ? [process.env.FRONTEND_URL, 'https://grcwisdom.com', 'https://app.grcwisdom.com']
  : (process.env.NODE_ENV === 'production' 
      ? ['https://grcwisdom.com', 'https://app.grcwisdom.com'] 
      : '*');

app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));

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
app.use('/api/auth', authRoutes);

// Database Console Operations Route (Hidden from normal frontend navigation)
app.use('/api/admin/db', dbAdminRoutes);

// Phase 2 Document Management Routes
app.use('/api/documents', documentRoutes);

// Phase 1 SoD Engine — admin CRUD for rules
app.use('/api/admin/sod-rules', adminSodRoutes);

// Phase 0 Password Reset — user requests + admin approvals
app.use('/api/password-reset', passwordResetRoutes);

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
  res.status(err.status || 500).json({
    status: 'error',
    message: err.message || 'Internal Server Error'
  });
});

export default app;
