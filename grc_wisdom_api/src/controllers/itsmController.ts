import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../db';
import { writeAudit } from '../middlewares/auditMiddleware';
import { resolveTenantScope, auditCrossTenantRead } from '../services/scopeResolver';
import { computePriority, computeSlaTargets, slaStateOf, DEFAULT_SLA, runEscalationScan } from '../services/slaService';
import { startRun } from '../services/workflowEngine';

const SUBJECT_TICKET = 'Ticket';
const CLOSED = ['Resolved', 'Closed', 'Cancelled'];
const TICKET_TYPES = ['Incident', 'ServiceRequest', 'AccessRequest', 'Change', 'SecurityEvent'];

// ─── Tickets ───────────────────────────────────────────────────────────────

export const listTickets = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const scope = await resolveTenantScope(req.user!.tenantId);
    await auditCrossTenantRead(scope, req.user!.id, 'itsm.tickets.list');

    const { status, priority, type, assignedTeam, mine, search, slaState } =
      req.query as Record<string, string | undefined>;

    const where: any = { tenantId: { in: scope.tenantIds } };
    if (status) where.status = status;
    if (priority) where.priority = priority;
    if (type) where.type = type;
    if (assignedTeam) where.assignedTeam = assignedTeam;
    if (mine === 'true') where.assigneeId = req.user!.id;
    if (search) {
      where.OR = [
        { subject: { contains: search } },
        { description: { contains: search } },
        { service: { contains: search } },
      ];
    }

    const tickets = await prisma.ticket.findMany({
      where,
      include: {
        requester: { select: { id: true, name: true, email: true } },
        assignee: { select: { id: true, name: true, email: true } },
        tenant: { select: { id: true, name: true } },
        catalogItem: { select: { id: true, name: true } },
        workflowRun: { select: { id: true, status: true, currentStep: true } },
        _count: { select: { comments: true, workNotes: true } },
      },
      orderBy: [{ slaResolveAt: 'asc' }, { updatedAt: 'desc' }],
      take: 500,
    });

    const enriched = tickets.map((t) => ({ ...t, sla: slaStateOf(t) }));
    const filtered = slaState ? enriched.filter((t) => t.sla.state === slaState) : enriched;

    const open = enriched.filter((t) => !CLOSED.includes(t.status));
    res.json({
      status: 'success',
      scope: scope.kind,
      count: filtered.length,
      totals: {
        total: enriched.length,
        open: open.length,
        breached: open.filter((t) => t.sla.state === 'breached').length,
        atRisk: open.filter((t) => t.sla.state === 'at-risk').length,
        unassigned: open.filter((t) => !t.assigneeId).length,
        awaitingApproval: open.filter((t) => t.workflowRun?.status === 'RUNNING').length,
      },
      tickets: filtered,
    });
  } catch (error: any) {
    console.error('[Ticket List Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to list tickets' });
  }
};

export const getTicket = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const scope = await resolveTenantScope(req.user!.tenantId);

    const ticket = await prisma.ticket.findFirst({
      where: { id, tenantId: { in: scope.tenantIds } },
      include: {
        requester: { select: { id: true, name: true, email: true, role: true } },
        assignee: { select: { id: true, name: true, email: true, role: true } },
        tenant: { select: { id: true, name: true } },
        catalogItem: true,
        comments: {
          include: { author: { select: { id: true, name: true, email: true } } },
          orderBy: { createdAt: 'asc' },
        },
        workflowRun: {
          include: {
            definition: { select: { key: true, name: true } },
            stepRuns: {
              include: { decidedBy: { select: { name: true, email: true } } },
              orderBy: { stepIndex: 'asc' },
            },
          },
        },
      },
    });
    if (!ticket) { res.status(404).json({ status: 'error', message: 'Ticket not found' }); return; }

    // Work notes are a separate table so the visibility rule cannot be lost in
    // a filter — they are only ever attached for non-requesters (TRD §7.3).
    const isRequester = ticket.requesterId === req.user!.id;
    let workNotes: any[] = [];
    if (!isRequester) {
      workNotes = await prisma.ticketWorkNote.findMany({
        where: { ticketId: id },
        include: { author: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: 'asc' },
      });
    }

    res.json({
      status: 'success',
      ticket: { ...ticket, sla: slaStateOf(ticket), workNotes, canSeeWorkNotes: !isRequester },
    });
  } catch (error: any) {
    console.error('[Ticket Get Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to fetch ticket' });
  }
};

export const createTicket = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { subject, description, type, service, impact, urgency, catalogItemId, assignedTeam } = req.body || {};
    if (!subject || !description) {
      res.status(400).json({ status: 'error', message: 'subject and description are required' });
      return;
    }

    const tenantId = req.user!.tenantId;
    const userId = req.user!.id;

    // A catalog item supplies the defaults and — critically — the workflow.
    let item = null;
    if (catalogItemId) {
      item = await prisma.serviceCatalogItem.findUnique({ where: { id: catalogItemId } });
      if (!item || !item.isActive) {
        res.status(400).json({ status: 'error', message: 'Catalog item not found or inactive' });
        return;
      }
    }

    const ticketType = item?.ticketType || type || 'Incident';
    if (!TICKET_TYPES.includes(ticketType)) {
      res.status(400).json({ status: 'error', message: `type must be one of: ${TICKET_TYPES.join(', ')}` });
      return;
    }

    // Priority is computed, never taken from the request body.
    const eImpact = impact || item?.defaultImpact || 'Medium';
    const eUrgency = urgency || item?.defaultUrgency || 'Medium';
    const priority = computePriority(eImpact, eUrgency);
    const { slaResponseAt, slaResolveAt } = await computeSlaTargets(tenantId, priority);

    const result = await prisma.$transaction(async (tx) => {
      const ticket = await tx.ticket.create({
        data: {
          tenantId,
          requesterId: userId,
          type: ticketType,
          service: item?.name || service || 'General',
          subject: String(subject).trim(),
          description: String(description).trim(),
          impact: eImpact,
          urgency: eUrgency,
          priority,
          status: 'New',
          assignedTeam: assignedTeam || item?.assignmentGroup || null,
          slaResponseAt,
          slaResolveAt,
          dueAt: slaResolveAt,
          catalogItemId: item?.id || null,
        },
      });

      await writeAudit(tx, {
        tenantId, actorId: userId, action: 'TICKET_CREATED',
        subjectType: SUBJECT_TICKET, subjectId: ticket.id,
        payload: { subject, type: ticketType, impact: eImpact, urgency: eUrgency, priority, catalogItem: item?.key || null },
      });

      // Workflow-first: if the catalog item declares a workflow, the ticket
      // enters approval automatically rather than going straight to a queue.
      let workflow = null;
      let finalTicket = ticket;
      if (item?.workflowDefinitionId) {
        const started = await startRun(tx, {
          definitionId: item.workflowDefinitionId,
          tenantId,
          subjectType: SUBJECT_TICKET,
          subjectId: ticket.id,
          startedById: userId,
        });
        finalTicket = await tx.ticket.update({
          where: { id: ticket.id },
          data: {
            workflowRunId: started.runId,
            status: started.status === 'COMPLETED' ? 'New' : 'Pending Approval',
          },
        });
        workflow = started;
      }

      return { ticket: finalTicket, workflow };
    });

    res.status(201).json({
      status: 'success',
      message: result.workflow && result.workflow.status === 'RUNNING'
        ? `Ticket raised as ${priority} and routed for approval.`
        : `Ticket raised as ${priority}.`,
      ticket: result.ticket,
      workflow: result.workflow,
    });
  } catch (error: any) {
    console.error('[Ticket Create Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to create ticket' });
  }
};

export const updateTicket = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const scope = await resolveTenantScope(req.user!.tenantId);
    const ticket = await prisma.ticket.findFirst({ where: { id, tenantId: { in: scope.tenantIds } } });
    if (!ticket) { res.status(404).json({ status: 'error', message: 'Ticket not found' }); return; }

    const { status, assigneeId, assignedTeam, impact, urgency } = req.body || {};
    const data: any = {};

    if (assigneeId !== undefined) data.assigneeId = assigneeId || null;
    if (assignedTeam !== undefined) data.assignedTeam = assignedTeam || null;

    // Changing impact/urgency recomputes priority AND the SLA clock.
    if (impact || urgency) {
      const newImpact = impact || ticket.impact;
      const newUrgency = urgency || ticket.urgency;
      const newPriority = computePriority(newImpact, newUrgency);
      const targets = await computeSlaTargets(ticket.tenantId, newPriority, ticket.createdAt);
      Object.assign(data, {
        impact: newImpact, urgency: newUrgency, priority: newPriority,
        slaResponseAt: targets.slaResponseAt, slaResolveAt: targets.slaResolveAt,
        dueAt: targets.slaResolveAt, slaBreached: false,
      });
    }

    if (status) {
      data.status = status;
      if (CLOSED.includes(status) && !ticket.resolvedAt) data.resolvedAt = new Date();
      if (!CLOSED.includes(status)) data.resolvedAt = null;
    }
    // First response stops the response clock.
    if ((status || assigneeId) && !ticket.respondedAt) data.respondedAt = new Date();

    if (Object.keys(data).length === 0) {
      res.status(400).json({ status: 'error', message: 'No updatable fields provided' });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.ticket.update({ where: { id }, data });
      await writeAudit(tx, {
        tenantId: ticket.tenantId, actorId: req.user!.id, action: 'TICKET_UPDATED',
        subjectType: SUBJECT_TICKET, subjectId: id,
        payload: { before: { status: ticket.status, priority: ticket.priority, assigneeId: ticket.assigneeId }, after: data },
      });
      return u;
    });

    res.json({ status: 'success', ticket: { ...updated, sla: slaStateOf(updated) } });
  } catch (error: any) {
    console.error('[Ticket Update Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to update ticket' });
  }
};

export const addComment = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { body, internal } = req.body || {};
    if (!body || !String(body).trim()) {
      res.status(400).json({ status: 'error', message: 'body is required' });
      return;
    }

    const scope = await resolveTenantScope(req.user!.tenantId);
    const ticket = await prisma.ticket.findFirst({ where: { id, tenantId: { in: scope.tenantIds } } });
    if (!ticket) { res.status(404).json({ status: 'error', message: 'Ticket not found' }); return; }

    // The requester can never write an internal note about their own ticket.
    const isInternal = !!internal && ticket.requesterId !== req.user!.id;

    const created = await prisma.$transaction(async (tx) => {
      const row = isInternal
        ? await tx.ticketWorkNote.create({ data: { ticketId: id, authorId: req.user!.id, body: String(body).trim() } })
        : await tx.ticketComment.create({ data: { ticketId: id, authorId: req.user!.id, body: String(body).trim() } });

      if (!ticket.respondedAt && ticket.requesterId !== req.user!.id) {
        await tx.ticket.update({ where: { id }, data: { respondedAt: new Date() } });
      }
      await writeAudit(tx, {
        tenantId: ticket.tenantId, actorId: req.user!.id,
        action: isInternal ? 'TICKET_WORKNOTE_ADDED' : 'TICKET_COMMENT_ADDED',
        subjectType: SUBJECT_TICKET, subjectId: id,
        payload: { length: String(body).length },
      });
      return row;
    });

    res.status(201).json({ status: 'success', internal: isInternal, entry: created });
  } catch (error: any) {
    console.error('[Ticket Comment Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to add note' });
  }
};

// ─── Queues (grouped view) ─────────────────────────────────────────────────

export const listQueues = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const scope = await resolveTenantScope(req.user!.tenantId);
    const tickets = await prisma.ticket.findMany({
      where: { tenantId: { in: scope.tenantIds }, status: { notIn: CLOSED } },
      include: { assignee: { select: { id: true, name: true } } },
      orderBy: { slaResolveAt: 'asc' },
      take: 500,
    });

    const groups = new Map<string, any>();
    for (const t of tickets) {
      const key = t.assignedTeam || 'Unassigned queue';
      if (!groups.has(key)) {
        groups.set(key, { name: key, total: 0, breached: 0, atRisk: 0, unassigned: 0, byPriority: {} as Record<string, number>, tickets: [] });
      }
      const g = groups.get(key);
      const sla = slaStateOf(t);
      g.total++;
      if (sla.state === 'breached') g.breached++;
      if (sla.state === 'at-risk') g.atRisk++;
      if (!t.assigneeId) g.unassigned++;
      g.byPriority[t.priority] = (g.byPriority[t.priority] || 0) + 1;
      g.tickets.push({
        id: t.id, subject: t.subject, priority: t.priority, status: t.status,
        assignee: t.assignee, sla, slaResolveAt: t.slaResolveAt,
      });
    }

    const queues = [...groups.values()].sort((a, b) => b.breached - a.breached || b.total - a.total);
    res.json({ status: 'success', scope: scope.kind, queueCount: queues.length, queues });
  } catch (error: any) {
    console.error('[Queues Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to build queues' });
  }
};

// ─── Service catalog ───────────────────────────────────────────────────────

export const listCatalog = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const scope = await resolveTenantScope(req.user!.tenantId);
    const items = await prisma.serviceCatalogItem.findMany({
      where: { OR: [{ tenantId: null }, { tenantId: { in: scope.tenantIds } }], isActive: true },
      include: {
        workflowDefinition: { select: { id: true, key: true, name: true, steps: true } },
        _count: { select: { tickets: true } },
      },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });

    res.json({
      status: 'success',
      count: items.length,
      items: items.map((i) => {
        let stepCount = 0;
        if (i.workflowDefinition?.steps) {
          try { stepCount = (JSON.parse(i.workflowDefinition.steps) || []).length; } catch { stepCount = 0; }
        }
        return {
          id: i.id, key: i.key, name: i.name, description: i.description,
          category: i.category, ticketType: i.ticketType,
          defaultImpact: i.defaultImpact, defaultUrgency: i.defaultUrgency,
          derivedPriority: computePriority(i.defaultImpact, i.defaultUrgency),
          assignmentGroup: i.assignmentGroup,
          workflowName: i.workflowDefinition?.name || null,
          workflowSteps: stepCount,
          requestCount: i._count.tickets,
          isPlatform: i.tenantId === null,
        };
      }),
    });
  } catch (error: any) {
    console.error('[Catalog Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to list catalog' });
  }
};

// ─── SLA policies + live compliance ────────────────────────────────────────

export const getSlaOverview = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const scope = await resolveTenantScope(req.user!.tenantId);

    const policies = await prisma.slaPolicy.findMany({
      where: { OR: [{ tenantId: null }, { tenantId: { in: scope.tenantIds } }] },
      include: { tenant: { select: { name: true } } },
      orderBy: [{ priority: 'asc' }],
    });

    const tickets = await prisma.ticket.findMany({
      where: { tenantId: { in: scope.tenantIds } },
      select: { id: true, subject: true, priority: true, status: true, slaResolveAt: true, resolvedAt: true, escalationLevel: true, assignedTeam: true },
      take: 1000,
    });

    const byPriority: Record<string, any> = {};
    for (const p of Object.keys(DEFAULT_SLA)) {
      byPriority[p] = { priority: p, total: 0, met: 0, breached: 0, open: 0, atRisk: 0 };
    }
    const breachedList: any[] = [];

    for (const t of tickets) {
      const row = byPriority[t.priority] || (byPriority[t.priority] = { priority: t.priority, total: 0, met: 0, breached: 0, open: 0, atRisk: 0 });
      const sla = slaStateOf(t);
      row.total++;
      if (sla.state === 'met') row.met++;
      else if (sla.state === 'breached') { row.breached++; breachedList.push({ ...t, sla }); }
      else if (sla.state === 'at-risk') { row.atRisk++; row.open++; }
      else if (sla.state === 'on-track') row.open++;
    }

    const rows = Object.values(byPriority).map((r: any) => ({
      ...r,
      compliance: r.total > 0 ? Math.round(((r.total - r.breached) / r.total) * 100) : 100,
      defaultTarget: DEFAULT_SLA[r.priority] || null,
    }));

    res.json({
      status: 'success',
      scope: scope.kind,
      policies: policies.map((p) => ({
        id: p.id, priority: p.priority, responseMins: p.responseMins, resolveMins: p.resolveMins,
        scopeLabel: p.tenantId ? p.tenant?.name || 'Tenant' : 'Platform default',
        isPlatform: p.tenantId === null,
      })),
      summary: rows,
      breached: breachedList.slice(0, 50),
    });
  } catch (error: any) {
    console.error('[SLA Overview Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to build SLA overview' });
  }
};

export const triggerEscalationScan = async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const result = await runEscalationScan();
    res.json({ status: 'success', ...result, message: `${result.breached} breach(es) detected` });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: 'Escalation scan failed' });
  }
};

// ─── Knowledge base ────────────────────────────────────────────────────────

export const listArticles = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const scope = await resolveTenantScope(req.user!.tenantId);
    const { search, category, status } = req.query as Record<string, string | undefined>;

    const where: any = { OR: [{ tenantId: null }, { tenantId: { in: scope.tenantIds } }] };
    if (category) where.category = category;
    where.status = status || 'PUBLISHED';
    if (search) {
      where.AND = [{ OR: [{ title: { contains: search } }, { body: { contains: search } }] }];
    }

    const articles = await prisma.knowledgeArticle.findMany({
      where,
      include: { author: { select: { name: true, email: true } } },
      orderBy: [{ viewCount: 'desc' }, { updatedAt: 'desc' }],
      take: 200,
    });

    res.json({
      status: 'success',
      count: articles.length,
      categories: [...new Set(articles.map((a) => a.category))].sort(),
      articles: articles.map((a) => ({
        ...a,
        tags: (() => { try { return JSON.parse(a.tags); } catch { return []; } })(),
        linkedTicketTypes: (() => { try { return JSON.parse(a.linkedTicketTypes); } catch { return []; } })(),
      })),
    });
  } catch (error: any) {
    console.error('[Knowledge List Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to list articles' });
  }
};

export const createArticle = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { title, body, category, tags, linkedTicketTypes, status, sourceTicketId } = req.body || {};
    if (!title || !body || !category) {
      res.status(400).json({ status: 'error', message: 'title, body and category are required' });
      return;
    }

    const article = await prisma.$transaction(async (tx) => {
      const a = await tx.knowledgeArticle.create({
        data: {
          tenantId: req.user!.tenantId,
          title: String(title).trim(),
          body: String(body).trim(),
          category: String(category).trim(),
          tags: JSON.stringify(Array.isArray(tags) ? tags : []),
          linkedTicketTypes: JSON.stringify(Array.isArray(linkedTicketTypes) ? linkedTicketTypes : []),
          status: status === 'PUBLISHED' ? 'PUBLISHED' : 'DRAFT',
          authorId: req.user!.id,
          sourceTicketId: sourceTicketId || null,
        },
      });
      await writeAudit(tx, {
        tenantId: req.user!.tenantId, actorId: req.user!.id, action: 'KNOWLEDGE_ARTICLE_CREATED',
        subjectType: 'KnowledgeArticle', subjectId: a.id,
        payload: { title, category, fromTicket: sourceTicketId || null },
      });
      return a;
    });

    res.status(201).json({ status: 'success', article });
  } catch (error: any) {
    console.error('[Knowledge Create Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to create article' });
  }
};

export const viewArticle = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const article = await prisma.knowledgeArticle.update({
      where: { id },
      data: { viewCount: { increment: 1 } },
      include: { author: { select: { name: true, email: true } } },
    });
    res.json({ status: 'success', article });
  } catch {
    res.status(404).json({ status: 'error', message: 'Article not found' });
  }
};
