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
import {
  authoringOptions,
  createDefinition,
  updateDefinition,
  listSlaPolicies,
  setSlaPolicy,
} from '../controllers/workflowAuthoringController';

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

// Authoring, as opposed to acting. The capability is named after creating a
// workflow and until now guarded no route: it was enforced only as a STEP's
// requiredCapability inside workflowEngine, which decides who may act on a
// step, never who may author the thing the step belongs to.
//
// '/workflows/options' is above '/workflows/:id' -- the wildcard would
// otherwise match it and answer "Workflow not found" for a path that is not
// an id.
router.get('/workflows/options', authoringOptions);
router.post('/workflows', requireCapability(CAP.AUTHOR_WORKFLOW), createDefinition);
router.put('/workflows/:id', requireCapability(CAP.AUTHOR_WORKFLOW), updateDefinition);

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
// The targets every figure on the SLA board is measured against. Reading them
// is open -- knowing the response target for a P1 is the policy, not a secret,
// and somebody whose ticket is breaching should be able to see what it
// breached. Setting them carries the authoring capability.
router.get('/sla-policies', listSlaPolicies);
router.put('/sla-policies', requireCapability(CAP.AUTHOR_WORKFLOW), setSlaPolicy);

// ── Knowledge base ────────────────────────────────────────────────────────
router.get('/knowledge', listArticles);
router.get('/knowledge/:id', viewArticle);
router.post('/knowledge', requireCapability(CAP.RESOLVE_TICKETS), createArticle);

export default router;
