import { Router } from 'express';
import { requireAuth, rejectIfMustChangePassword } from '../middlewares/authMiddleware';
import { requireCapability, requireAnyCapability, CAP } from '../services/capabilityEngine';
import {
  listTickets, getTicket, createTicket, updateTicket, addComment,
  listQueues, listCatalog, getSlaOverview, triggerEscalationScan,
  listArticles, createArticle, viewArticle,
} from '../controllers/itsmController';
import {
  listDefinitions, listRuns, getRun, decideRun, cancel, myInbox,
} from '../controllers/workflowController';

const router = Router();

// Scope is resolved per handler, so no enforceTenantIsolation here.
router.use(requireAuth);
router.use(rejectIfMustChangePassword);

// ── Workflow engine (cross-platform) ──────────────────────────────────────
router.get('/workflows', listDefinitions);
router.get('/workflows/inbox', myInbox);
router.get('/workflows/runs', listRuns);
router.get('/workflows/runs/:id', getRun);
router.post('/workflows/runs/:id/decide', decideRun);
router.post('/workflows/runs/:id/cancel', cancel);

// ── Tickets ───────────────────────────────────────────────────────────────
router.get('/tickets', listTickets);
router.get('/tickets/:id', getTicket);
// Every one of the 42 roles holds create-an-itsm-ticket.
router.post('/tickets', requireCapability(CAP.CREATE_TICKET), createTicket);
router.patch('/tickets/:id', requireAnyCapability(CAP.RESOLVE_TICKETS, CAP.CREATE_TICKET), updateTicket);
router.post('/tickets/:id/comments', requireCapability(CAP.CREATE_TICKET), addComment);

// ── Queues, catalog, SLA ──────────────────────────────────────────────────
router.get('/queues', listQueues);
router.get('/catalog', listCatalog);
router.get('/sla', getSlaOverview);
router.post('/sla/scan', requireCapability(CAP.RESOLVE_TICKETS), triggerEscalationScan);

// ── Knowledge base ────────────────────────────────────────────────────────
router.get('/knowledge', listArticles);
router.get('/knowledge/:id', viewArticle);
router.post('/knowledge', requireCapability(CAP.RESOLVE_TICKETS), createArticle);

export default router;
