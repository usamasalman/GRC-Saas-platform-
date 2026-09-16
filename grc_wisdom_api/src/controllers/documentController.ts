import { Response } from 'express';
import bcrypt from 'bcrypt';
import fs from 'fs';
import path from 'path';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../db';
import { generateHash } from '../utils/cryptoUtils';
import { writeAudit } from '../middlewares/auditMiddleware';
import { notify } from '../services/notificationService';
import {
  planPublication, coverage, AUDIENCE_KINDS,
} from '../services/documentPublication';
import { checkSod, SodViolation } from '../services/sodEngine';

const SUBJECT_DOCUMENT = 'Document';

const UPLOADS_DIR = path.join(__dirname, '../../uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function isFrozenByLegalHold(doc: { legalHoldAt?: Date | null }): boolean {
  return !!doc.legalHoldAt;
}

function processFileUpload(fileData?: string, fileName?: string, fileType?: string) {
  if (!fileData || !fileName) return null;
  try {
    const matches = fileData.match(/^data:(.+);base64,(.+)$/);
    let buffer: Buffer;
    let mime = fileType || 'application/octet-stream';
    if (matches && matches.length === 3) {
      mime = matches[1];
      buffer = Buffer.from(matches[2], 'base64');
    } else {
      buffer = Buffer.from(fileData, 'base64');
    }
    const safeName = `${Date.now()}_${fileName.replace(/[^a-zA-Z0-9_.-]/g, '_')}`;
    const filePath = path.join(UPLOADS_DIR, safeName);
    fs.writeFileSync(filePath, buffer);
    return {
      fileUrl: `/uploads/${safeName}`,
      fileName,
      fileSize: buffer.length,
      fileType: mime,
    };
  } catch (err) {
    console.error('[File Processing Error]:', err);
    return null;
  }
}

// ─── List / Get ─────────────────────────────────────────────────────────────

export const listDocuments = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const tenantId = req.user!.tenantId;
    const userId = req.user!.id;
    const { status, category, classification, search, pendingForMe } =
      req.query as Record<string, string | undefined>;

    const where: any = { tenantId };
    if (status) where.status = status;
    if (category) where.category = category;
    if (classification) where.classification = classification;
    // An approval queue is personal: only documents actually awaiting *this*
    // signature. Listing every in-review document offers a signature the
    // server will refuse, because approval requires an assigned queue row.
    if (pendingForMe === 'true') {
      where.approvals = { some: { approverId: userId, status: 'PENDING' } };
    }
    if (search) {
      where.OR = [
        { title: { contains: search } },
        { code: { contains: search } },
        { content: { contains: search } },
        { fileName: { contains: search } },
      ];
    }

    const documents = await prisma.document.findMany({
      where,
      include: {
        owner: { select: { id: true, name: true, email: true, role: true } },
        approvals: {
          include: { approver: { select: { id: true, name: true, email: true } } },
          orderBy: { sequenceOrder: 'asc' },
        },
        _count: { select: { versions: true, acknowledgements: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });

    // Tell the caller where they stand, so the UI can present the right action
    // rather than guessing and being rejected.
    const enriched = documents.map((d) => {
      const mine = d.approvals.find((a) => a.approverId === userId && a.status === 'PENDING');
      const blockedBy = mine
        ? d.approvals.find((a) => a.status === 'PENDING' && a.sequenceOrder < mine.sequenceOrder)
        : undefined;
      return {
        ...d,
        myApproval: mine
          ? {
              id: mine.id,
              sequenceOrder: mine.sequenceOrder,
              canSignNow: !blockedBy,
              waitingOn: blockedBy ? blockedBy.approver.name : null,
            }
          : null,
      };
    });

    res.json({ status: 'success', count: enriched.length, documents: enriched });
  } catch (error: any) {
    console.error('[Document List Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to fetch documents' });
  }
};

export const getDocument = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const document = await prisma.document.findFirst({
      where: { id, tenantId: req.user!.tenantId },
      include: {
        owner: { select: { id: true, name: true, email: true, role: true } },
        versions: { orderBy: { createdAt: 'desc' } },
        approvals: {
          include: { approver: { select: { id: true, name: true, email: true, role: true } } },
          orderBy: { sequenceOrder: 'asc' },
        },
        acknowledgements: {
          include: { user: { select: { id: true, name: true, email: true } } },
          orderBy: { completedAt: 'desc' },
        },
      },
    });
    if (!document) { res.status(404).json({ status: 'error', message: 'Document not found' }); return; }
    res.json({ status: 'success', document });
  } catch (error: any) {
    console.error('[Document Get Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to fetch document' });
  }
};

// ─── Create ─────────────────────────────────────────────────────────────────

export const createDocument = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const tenantId = req.user!.tenantId;
    const userId = req.user!.id;
    const { code, title, category, classification, content, fileData, fileName, fileType } = req.body;

    if (!code || !title || !category || !classification || !content) {
      res.status(400).json({ status: 'error', message: 'code, title, category, classification, and content are required' });
      return;
    }

    const existing = await prisma.document.findFirst({ where: { code, tenantId } });
    if (existing) {
      res.status(409).json({ status: 'error', message: `Document with code "${code}" already exists in this tenant` });
      return;
    }

    const uploaded = processFileUpload(fileData, fileName, fileType);

    const document = await prisma.$transaction(async (tx) => {
      const doc = await tx.document.create({
        data: {
          code, title, category, classification, content,
          status: 'DRAFT', version: '1.0', tenantId, ownerId: userId,
          ...(uploaded && {
            fileUrl: uploaded.fileUrl, fileName: uploaded.fileName,
            fileSize: uploaded.fileSize, fileType: uploaded.fileType,
          }),
        },
        include: { owner: { select: { id: true, name: true, email: true } } },
      });
      await tx.documentVersion.create({
        data: {
          documentId: doc.id,
          versionNumber: '1.0',
          changeType: 'Major',
          summary: uploaded ? `Initial creation with file "${uploaded.fileName}"` : 'Initial document creation',
          content,
          createdById: userId,
          ...(uploaded && {
            fileUrl: uploaded.fileUrl, fileName: uploaded.fileName,
            fileSize: uploaded.fileSize, fileType: uploaded.fileType,
            fileHash: generateHash(fileData || content),
          }),
        },
      });
      await writeAudit(tx, {
        tenantId, actorId: userId, action: 'DOCUMENT_CREATED',
        subjectType: SUBJECT_DOCUMENT, subjectId: doc.id,
        payload: { documentId: doc.id, code, title, classification },
      });
      return doc;
    });

    res.status(201).json({ status: 'success', document });
  } catch (error: any) {
    console.error('[Document Create Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to create document' });
  }
};

// ─── Update ─────────────────────────────────────────────────────────────────

export const updateDocument = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const tenantId = req.user!.tenantId;
    const userId = req.user!.id;
    const id = req.params.id as string;
    const { title, category, classification, content, fileData, fileName, fileType } = req.body;

    const doc = await prisma.document.findFirst({ where: { id, tenantId } });
    if (!doc) { res.status(404).json({ status: 'error', message: 'Document not found' }); return; }
    if (isFrozenByLegalHold(doc)) {
      res.status(423).json({ status: 'error', message: 'Document is under legal hold and cannot be edited' });
      return;
    }
    if (!['DRAFT', 'RETURNED'].includes(doc.status)) {
      res.status(400).json({ status: 'error', message: `Cannot edit a document in "${doc.status}" status` });
      return;
    }
    if (doc.isLockedOut && doc.checkedOutBy !== userId) {
      res.status(409).json({ status: 'error', message: 'Document is checked out by another user' });
      return;
    }

    const uploaded = processFileUpload(fileData, fileName, fileType);

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.document.update({
        where: { id },
        data: {
          ...(title && { title }),
          ...(category && { category }),
          ...(classification && { classification }),
          ...(content && { content }),
          ...(uploaded && {
            fileUrl: uploaded.fileUrl, fileName: uploaded.fileName,
            fileSize: uploaded.fileSize, fileType: uploaded.fileType,
          }),
        },
        include: { owner: { select: { id: true, name: true, email: true } } },
      });
      await writeAudit(tx, {
        tenantId, actorId: userId, action: 'DOCUMENT_UPDATED',
        subjectType: SUBJECT_DOCUMENT, subjectId: id,
        payload: { documentId: id },
      });
      return u;
    });

    res.json({ status: 'success', document: updated });
  } catch (error: any) {
    console.error('[Document Update Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to update document' });
  }
};

// ─── Checkout ───────────────────────────────────────────────────────────────

export const checkoutDocument = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const tenantId = req.user!.tenantId;
    const userId = req.user!.id;
    const id = req.params.id as string;

    const doc = await prisma.document.findFirst({ where: { id, tenantId } });
    if (!doc) { res.status(404).json({ status: 'error', message: 'Document not found' }); return; }
    if (isFrozenByLegalHold(doc)) {
      res.status(423).json({ status: 'error', message: 'Document is under legal hold and cannot be checked out' });
      return;
    }
    if (doc.isLockedOut) {
      res.status(409).json({ status: 'error', message: `Document is already checked out (locked since ${doc.checkedOutAt})` });
      return;
    }
    if (!['DRAFT', 'RETURNED'].includes(doc.status)) {
      res.status(400).json({ status: 'error', message: `Cannot checkout a document in "${doc.status}" status` });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.document.update({
        where: { id },
        data: { isLockedOut: true, checkedOutBy: userId, checkedOutAt: new Date() },
      });
      await writeAudit(tx, {
        tenantId, actorId: userId, action: 'DOCUMENT_CHECKED_OUT',
        subjectType: SUBJECT_DOCUMENT, subjectId: id,
        payload: { documentId: id },
      });
      return u;
    });

    res.json({ status: 'success', message: 'Document checked out and locked for editing', document: updated });
  } catch (error: any) {
    console.error('[Checkout Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to checkout document' });
  }
};

// ─── Checkin ────────────────────────────────────────────────────────────────

export const checkinDocument = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const tenantId = req.user!.tenantId;
    const userId = req.user!.id;
    const id = req.params.id as string;
    const { content, summary, changeType, fileData, fileName, fileType } = req.body;

    const doc: any = await prisma.document.findFirst({ where: { id, tenantId } });
    if (!doc) { res.status(404).json({ status: 'error', message: 'Document not found' }); return; }
    if (isFrozenByLegalHold(doc)) {
      res.status(423).json({ status: 'error', message: 'Document is under legal hold and cannot be modified' });
      return;
    }
    if (!doc.isLockedOut || doc.checkedOutBy !== userId) {
      res.status(403).json({ status: 'error', message: 'You do not have this document checked out' });
      return;
    }

    const [major, minor] = String(doc.version).split('.').map(Number);
    const newVersion = changeType === 'Major' ? `${major + 1}.0` : `${major}.${minor + 1}`;
    const uploaded = processFileUpload(fileData, fileName, fileType);
    const contentHash = generateHash(fileData || content || doc.content);

    const updated = await prisma.$transaction(async (tx) => {
      await tx.documentVersion.create({
        data: {
          documentId: id,
          versionNumber: newVersion,
          changeType: changeType || 'Minor',
          summary: summary || `Version ${newVersion} checkin`,
          content: content || doc.content,
          fileHash: contentHash,
          createdById: userId,
          ...(uploaded ? {
            fileUrl: uploaded.fileUrl, fileName: uploaded.fileName,
            fileSize: uploaded.fileSize, fileType: uploaded.fileType,
          } : {
            fileUrl: doc.fileUrl, fileName: doc.fileName,
            fileSize: doc.fileSize, fileType: doc.fileType,
          }),
        },
      });
      const u = await tx.document.update({
        where: { id },
        data: {
          isLockedOut: false, checkedOutBy: null, checkedOutAt: null,
          version: newVersion,
          ...(content && { content }),
          ...(uploaded && {
            fileUrl: uploaded.fileUrl, fileName: uploaded.fileName,
            fileSize: uploaded.fileSize, fileType: uploaded.fileType,
          }),
        },
      });
      await writeAudit(tx, {
        tenantId, actorId: userId, action: 'DOCUMENT_CHECKED_IN',
        subjectType: SUBJECT_DOCUMENT, subjectId: id,
        payload: { documentId: id, newVersion, contentHash },
      });
      return u;
    });

    res.json({ status: 'success', message: `Checked in as version ${newVersion}`, document: updated });
  } catch (error: any) {
    console.error('[Checkin Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to checkin document' });
  }
};

// ─── Download ───────────────────────────────────────────────────────────────

export const downloadDocument = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const doc: any = await prisma.document.findFirst({
      where: { id, tenantId: req.user!.tenantId },
    });
    if (!doc) { res.status(404).json({ status: 'error', message: 'Document not found' }); return; }

    if (doc.fileUrl && typeof doc.fileUrl === 'string' && doc.fileUrl.startsWith('/uploads/')) {
      const fileNameOnly = doc.fileUrl.replace('/uploads/', '');
      const fullPath = path.join(UPLOADS_DIR, fileNameOnly);
      if (fs.existsSync(fullPath)) {
        res.download(fullPath, doc.fileName || `${doc.code}_v${doc.version}`);
        return;
      }
    }

    const exportContent = `================================================================================
GRC WISDOM GOVERNANCE DOCUMENT
================================================================================
Document Code   : ${doc.code}
Title           : ${doc.title}
Version         : v${doc.version}
Category        : ${doc.category}
Classification  : ${doc.classification}
Status          : ${doc.status}
Export Date     : ${new Date().toUTCString()}
================================================================================

${doc.content}

================================================================================
END OF DOCUMENT — CONFIDENTIAL GRC RECORD
================================================================================`;

    const downloadFileName = `${doc.code.replace(/[^a-zA-Z0-9_-]/g, '_')}_v${doc.version}.txt`;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${downloadFileName}"`);
    res.send(exportContent);
  } catch (error: any) {
    console.error('[Download Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to download document' });
  }
};

// ─── Submit for Approval ────────────────────────────────────────────────────

export const submitForApproval = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const tenantId = req.user!.tenantId;
    const userId = req.user!.id;
    const id = req.params.id as string;
    const { approverIds } = req.body || {};

    const doc = await prisma.document.findFirst({ where: { id, tenantId } });
    if (!doc) { res.status(404).json({ status: 'error', message: 'Document not found' }); return; }
    if (isFrozenByLegalHold(doc)) {
      res.status(423).json({ status: 'error', message: 'Document is under legal hold' });
      return;
    }
    if (!['DRAFT', 'RETURNED'].includes(doc.status)) {
      res.status(400).json({ status: 'error', message: `Cannot submit a document in "${doc.status}" status` });
      return;
    }
    if (doc.isLockedOut) {
      res.status(409).json({ status: 'error', message: 'Document must be checked in before submitting for approval' });
      return;
    }

    let approvers = (approverIds as string[]) || [];
    if (approvers.length === 0) {
      const tenantUsers = await prisma.user.findMany({
        where: { tenantId, id: { not: doc.ownerId }, status: 'Active' },
        select: { id: true },
        take: 3,
      });
      approvers = tenantUsers.map(u => u.id);
    }

    // SoD: author cannot approve their own document
    approvers = Array.from(new Set(approvers.filter(a => a && a !== doc.ownerId)));
    if (approvers.length === 0) {
      res.status(400).json({
        status: 'error',
        message: 'SoD violation: at least one valid approver (not the document author) is required',
      });
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.approvalQueue.deleteMany({ where: { documentId: id, status: 'PENDING' } });
      await tx.approvalQueue.createMany({
        data: approvers.map((approverId, idx) => ({
          documentId: id, approverId, sequenceOrder: idx + 1, status: 'PENDING',
        })),
      });
      await tx.document.update({ where: { id }, data: { status: 'IN_REVIEW' } });
      await writeAudit(tx, {
        tenantId, actorId: userId, action: 'DOCUMENT_SUBMITTED_FOR_APPROVAL',
        subjectType: SUBJECT_DOCUMENT, subjectId: id,
        payload: { documentId: id, approverIds: approvers },
      });
    });

    res.json({ status: 'success', message: `Document submitted for approval to ${approvers.length} reviewer(s)` });
  } catch (error: any) {
    console.error('[Submit Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to submit for approval' });
  }
};

// ─── Approve (step-up auth + SHA-256 signature over content) ────────────────

export const approveDocument = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const userRole = req.user!.role;
    const tenantId = req.user!.tenantId;
    const id = req.params.id as string;
    const { password, decision } = req.body || {};

    if (!password) {
      res.status(400).json({ status: 'error', message: 'Password re-verification is required for digital signature' });
      return;
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      res.status(401).json({ status: 'error', message: 'Re-authentication failed' });
      return;
    }
    const passwordMatches = await bcrypt.compare(String(password), user.passwordHash).catch(() => false);
    if (!passwordMatches) {
      res.status(401).json({ status: 'error', message: 'Re-authentication failed. Invalid password.' });
      return;
    }

    const doc = await prisma.document.findFirst({ where: { id, tenantId } });
    if (!doc) { res.status(404).json({ status: 'error', message: 'Document not found' }); return; }

    const approval = await prisma.approvalQueue.findFirst({
      where: { documentId: id, approverId: userId, status: 'PENDING' },
    });
    if (!approval) {
      res.status(404).json({ status: 'error', message: 'No pending approval found for you on this document' });
      return;
    }

    // Enforce sequenceOrder: earlier approvers must decide first.
    const earlierPending = await prisma.approvalQueue.findFirst({
      where: { documentId: id, status: 'PENDING', sequenceOrder: { lt: approval.sequenceOrder } },
    });
    if (earlierPending) {
      res.status(409).json({ status: 'error', message: 'An earlier approver in the sequence must decide first' });
      return;
    }

    // Sign the actual content (TRD §6.2 — non-repudiation requires content binding).
    const timestamp = new Date().toISOString();
    const contentHash = generateHash(`${doc.content}|${doc.fileUrl || ''}`);
    const signaturePayload = `APPROVE:${id}:${doc.version}:${contentHash}:${userId}:${userRole}:${timestamp}`;
    const signatureHash = generateHash(signaturePayload);

    const { allApproved } = await prisma.$transaction(async (tx) => {
      // SoD: engine-enforced — blocks author, checked-in editors, etc.
      await checkSod(tx, {
        tenantId, actorId: userId,
        guardedAction: 'DOCUMENT_APPROVED',
        subjectType: SUBJECT_DOCUMENT, subjectId: id,
      });

      await tx.approvalQueue.update({
        where: { id: approval.id },
        data: {
          status: 'APPROVED',
          decision: decision || 'Approved',
          signatureHash,
          signerRole: userRole,
          sessionInfo: `IP:${req.ip || 'unknown'}|UA:${(req.headers['user-agent'] || 'unknown').toString().substring(0, 80)}`,
          reviewedAt: new Date(),
        },
      });
      const remainingPending = await tx.approvalQueue.count({
        where: { documentId: id, status: 'PENDING' },
      });
      const done = remainingPending === 0;
      if (done) {
        await tx.document.update({ where: { id }, data: { status: 'APPROVED' } });
      }
      await writeAudit(tx, {
        tenantId, actorId: userId, action: 'DOCUMENT_APPROVED',
        subjectType: SUBJECT_DOCUMENT, subjectId: id,
        payload: { documentId: id, version: doc.version, signatureHash, allApproved: done },
      });
      return { allApproved: done };
    });

    res.json({
      status: 'success',
      message: allApproved
        ? 'Document fully approved and ready for publication'
        : 'Approval recorded. Waiting on further approvers.',
      signatureHash,
      allApproved,
    });
  } catch (error: any) {
    // SoD violations are a first-class 403 handled by the global error middleware.
    if (error instanceof SodViolation) throw error;
    console.error('[Approve Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to approve document' });
  }
};

// ─── Reject ─────────────────────────────────────────────────────────────────

export const rejectDocument = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const tenantId = req.user!.tenantId;
    const userId = req.user!.id;
    const id = req.params.id as string;
    const { reason } = req.body || {};

    const approval = await prisma.approvalQueue.findFirst({
      where: { documentId: id, approverId: userId, status: 'PENDING' },
    });
    if (!approval) {
      res.status(404).json({ status: 'error', message: 'No pending approval found for you on this document' });
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.approvalQueue.update({
        where: { id: approval.id },
        data: { status: 'REJECTED', reason: reason || 'Rejected by reviewer', reviewedAt: new Date() },
      });
      await tx.document.update({ where: { id }, data: { status: 'RETURNED' } });
      await writeAudit(tx, {
        tenantId, actorId: userId, action: 'DOCUMENT_REJECTED',
        subjectType: SUBJECT_DOCUMENT, subjectId: id,
        payload: { documentId: id, reason },
      });
    });

    res.json({ status: 'success', message: 'Document rejected and returned to author' });
  } catch (error: any) {
    console.error('[Reject Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to reject document' });
  }
};

// ─── Publish ────────────────────────────────────────────────────────────────

/**
 * Issue an approved document to the people who have to read it.
 *
 * This used to flip one status column and write an audit row. Nothing was
 * raised, nobody was told, and no audience was recorded — so a published policy
 * reached its readers only if one of them happened to open the acknowledgement
 * screen unprompted, and "who has not read it" had no answer in the data.
 *
 * The rules are in services/documentPublication and run without a database.
 */
export const publishDocument = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const tenantId = req.user!.tenantId;
    const userId = req.user!.id;
    const id = req.params.id as string;

    const doc = await prisma.document.findFirst({ where: { id, tenantId } });
    if (!doc) { res.status(404).json({ status: 'error', message: 'Document not found' }); return; }

    const [users, existing] = await Promise.all([
      prisma.user.findMany({
        where: { tenantId },
        select: { id: true, name: true, status: true, department: true, role: true },
      }),
      prisma.acknowledgementRequest.findMany({
        where: { documentId: id, version: doc.version },
        select: { userId: true },
      }),
    ]);

    const plan = planPublication({
      document: {
        status: doc.status,
        version: doc.version,
        publishedVersion: doc.publishedVersion,
      },
      kind: req.body?.audienceKind,
      value: req.body?.audienceValue,
      users,
      alreadyAsked: existing.map((e) => e.userId),
    });

    if (!plan.ok) {
      res.status(plan.status).json({ status: 'error', code: plan.code, message: plan.message });
      return;
    }

    const published = await prisma.$transaction(async (tx) => {
      const u = await tx.document.update({
        where: { id },
        data: {
          status: 'PUBLISHED',
          publishedAt: new Date(),
          publishedById: userId,
          publishedVersion: doc.version,
          audienceKind: plan.kind,
          audienceValue: plan.value,
        },
      });

      // One row per person asked, per version. The unique key makes a repeated
      // publish idempotent rather than double-asking anybody.
      if (plan.recipientIds.length > 0) {
        await tx.acknowledgementRequest.createMany({
          data: plan.recipientIds.map((uid) => ({
            documentId: id,
            version: doc.version,
            userId: uid,
            requestedById: userId,
          })),
          skipDuplicates: true,
        });
      }

      await writeAudit(tx, {
        tenantId, actorId: userId, action: 'DOCUMENT_PUBLISHED',
        subjectType: SUBJECT_DOCUMENT, subjectId: id,
        // The audience belongs in the trail. An entry that records a policy went
        // live without recording who it went to cannot answer the question an
        // auditor asks of it.
        payload: {
          documentId: id,
          version: doc.version,
          audienceKind: plan.kind,
          audienceValue: plan.value,
          asked: plan.recipientIds.length,
        },
      });

      // And the people themselves. This module called notify() nowhere at all,
      // so publishing a mandatory policy told its readers nothing.
      await notify(tx, plan.recipientIds.map((recipientId) => ({
        tenantId,
        recipientId,
        actorId: userId,
        event: 'DOCUMENT_PUBLISHED',
        subjectType: SUBJECT_DOCUMENT,
        subjectId: id,
        title: `Please read and acknowledge: ${doc.title}`,
        body: `${doc.code} v${doc.version}. You have been asked to confirm you have read it.`,
        link: 'acknowledgements',
      })));

      return u;
    });

    res.json({
      status: 'success',
      message: plan.recipientIds.length > 0
        ? `Published and issued to ${plan.recipientIds.length} ${plan.recipientIds.length === 1 ? 'person' : 'people'}.`
        : 'Published. Everybody in this audience had already been asked to acknowledge this version.',
      document: published,
      asked: plan.recipientIds.length,
      warnings: plan.warnings,
    });
  } catch (error: any) {
    console.error('[Publish Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to publish document' });
  }
};

/** The audience shapes a publisher may choose, and the values each offers. */
export const publishOptions = async (
  req: AuthenticatedRequest, res: Response,
): Promise<void> => {
  try {
    const tenantId = req.user!.tenantId;
    const users = await prisma.user.findMany({
      where: { tenantId, status: 'Active' },
      select: { department: true, role: true },
    });

    const unique = (xs: (string | null)[]) => Array.from(
      new Set(xs.map((x) => String(x ?? '').trim()).filter(Boolean)),
    ).sort();

    res.json({
      status: 'success',
      kinds: AUDIENCE_KINDS,
      // Served rather than hardcoded in the screen: the audience is matched
      // against these exact values, and a fourth copy in the browser is how a
      // form comes to offer one the server matches nothing against.
      departments: unique(users.map((u) => u.department)),
      roles: unique(users.map((u) => u.role)),
      activeUsers: users.length,
    });
  } catch (error: any) {
    console.error('[Publish Options Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load audience options' });
  }
};

// ─── Archive ────────────────────────────────────────────────────────────────

export const archiveDocument = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const tenantId = req.user!.tenantId;
    const userId = req.user!.id;
    const id = req.params.id as string;

    const doc = await prisma.document.findFirst({ where: { id, tenantId } });
    if (!doc) { res.status(404).json({ status: 'error', message: 'Document not found' }); return; }
    if (isFrozenByLegalHold(doc)) {
      res.status(423).json({ status: 'error', message: 'Document is under legal hold and cannot be archived' });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.document.update({ where: { id }, data: { status: 'ARCHIVED' } });
      await writeAudit(tx, {
        tenantId, actorId: userId, action: 'DOCUMENT_ARCHIVED',
        subjectType: SUBJECT_DOCUMENT, subjectId: id,
        payload: { documentId: id },
      });
      return u;
    });

    res.json({ status: 'success', message: 'Document archived', document: updated });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: 'Failed to archive document' });
  }
};

// ─── Delete (DRAFT only, and never when on legal hold) ──────────────────────

export const deleteDocument = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const tenantId = req.user!.tenantId;
    const userId = req.user!.id;
    const id = req.params.id as string;

    const doc = await prisma.document.findFirst({ where: { id, tenantId } });
    if (!doc) { res.status(404).json({ status: 'error', message: 'Document not found' }); return; }
    if (isFrozenByLegalHold(doc)) {
      res.status(423).json({ status: 'error', message: 'Document is under legal hold and cannot be deleted' });
      return;
    }
    if (doc.status !== 'DRAFT') {
      res.status(400).json({ status: 'error', message: 'Only DRAFT documents can be deleted' });
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.document.delete({ where: { id } });
      await writeAudit(tx, {
        tenantId, actorId: userId, action: 'DOCUMENT_DELETED',
        subjectType: SUBJECT_DOCUMENT, subjectId: id,
        payload: { documentId: id, code: doc.code, title: doc.title },
      });
    });

    res.json({ status: 'success', message: 'Document deleted' });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: 'Failed to delete document' });
  }
};

// ─── Acknowledgement ────────────────────────────────────────────────────────

export const acknowledgeDocument = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const tenantId = req.user!.tenantId;
    const userId = req.user!.id;
    const id = req.params.id as string;

    const doc = await prisma.document.findFirst({ where: { id, tenantId, status: 'PUBLISHED' } });
    if (!doc) {
      res.status(404).json({ status: 'error', message: 'Published document not found in your tenant' });
      return;
    }

    const live = doc.publishedVersion || doc.version;
    const existing = await prisma.acknowledgement.findFirst({
      // Per VERSION. Checking the document alone would refuse a signature on a
      // revised policy because the reader had signed the previous one.
      where: { documentId: id, userId, version: live },
    });
    if (existing) {
      res.status(409).json({ status: 'error', message: 'You have already acknowledged this document' });
      return;
    }

    const ack = await prisma.$transaction(async (tx) => {
      const a = await tx.acknowledgement.create({
        // Against the version that was read. Without it a signature on v1.0 is
        // indistinguishable from one on v3.0, so a revised policy would show as
        // already acknowledged by everyone who had read the old one.
        data: {
          documentId: id,
          userId,
          version: doc.publishedVersion || doc.version,
          ipAddress: req.ip || 'unknown',
        },
      });
      await writeAudit(tx, {
        tenantId, actorId: userId, action: 'DOCUMENT_ACKNOWLEDGED',
        subjectType: SUBJECT_DOCUMENT, subjectId: id,
        payload: { documentId: id, version: doc.version },
      });
      return a;
    });

    res.json({ status: 'success', message: 'Document acknowledged', acknowledgement: ack });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: 'Failed to acknowledge document' });
  }
};

/**
 * Who was asked, who has signed, and who has not.
 *
 * The third of those is the only one anybody opens this for, and it was the one
 * the module could not answer. Acknowledgement rows exist only once somebody
 * signs, so the non-signers were never materialised: they were the arithmetic
 * difference against `user.count({ tenantId, status: 'Active' })` — every
 * active person in the organisation, a denominator nobody chose. A policy
 * issued to the finance team reported as a few percent read, and the twenty-odd
 * people who actually owed it could not be named.
 *
 * Now the requests raised at publication ARE the denominator, and the
 * outstanding list is a real set of people with names.
 */
export const getAcknowledgements = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const tenantId = req.user!.tenantId;
    const id = req.params.id as string;

    const doc = await prisma.document.findFirst({ where: { id, tenantId } });
    if (!doc) { res.status(404).json({ status: 'error', message: 'Document not found' }); return; }

    const live = doc.publishedVersion || doc.version;

    const [requests, signatures] = await Promise.all([
      prisma.acknowledgementRequest.findMany({
        where: { documentId: id, version: live },
        include: { user: { select: { id: true, name: true, email: true, role: true, department: true } } },
        orderBy: { requestedAt: 'asc' },
      }),
      prisma.acknowledgement.findMany({
        where: { documentId: id, version: live },
        include: { user: { select: { id: true, name: true, email: true, role: true } } },
        orderBy: { completedAt: 'desc' },
      }),
    ]);

    const signedIds = new Set(signatures.map((a) => a.userId));
    const outstanding = requests.filter((r) => !signedIds.has(r.userId));

    const figures = coverage({
      requested: requests.length,
      signed: requests.filter((r) => signedIds.has(r.userId)).length,
      published: doc.status === 'PUBLISHED' || doc.publishedAt !== null,
    });

    res.json({
      status: 'success',
      documentId: id,
      version: live,
      audience: doc.audienceKind
        ? { kind: doc.audienceKind, value: doc.audienceValue }
        : null,
      publishedAt: doc.publishedAt,
      coverage: figures,
      // Named, not counted. A tracker that can only produce a percentage sends
      // the reader to find the stragglers themselves.
      outstanding: outstanding.map((r) => ({
        userId: r.userId,
        name: r.user.name,
        email: r.user.email,
        role: r.user.role,
        department: r.user.department,
        requestedAt: r.requestedAt,
        dueAt: r.dueAt,
      })),
      acknowledgements: signatures,
    });
  } catch (error: any) {
    console.error('[Acknowledgements Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to fetch acknowledgements' });
  }
};

/**
 * What the caller has been asked to read and has not signed.
 *
 * The acknowledgement screen listed every PUBLISHED document in the tenant and
 * offered a button on each, whether or not the reader owed it and whether or
 * not they had already signed — its own DocumentItem interface declared
 * `acknowledgedByMe` and nothing ever set it, so a second click produced a 409
 * rendered in the success banner.
 */
export const myAcknowledgements = async (
  req: AuthenticatedRequest, res: Response,
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const tenantId = req.user!.tenantId;

    const requests = await prisma.acknowledgementRequest.findMany({
      where: { userId, document: { tenantId } },
      include: {
        document: {
          select: {
            id: true, code: true, title: true, category: true, classification: true,
            status: true, publishedAt: true,
            owner: { select: { name: true } },
          },
        },
      },
      orderBy: { requestedAt: 'desc' },
      take: 200,
    });

    const signed = await prisma.acknowledgement.findMany({
      where: { userId, documentId: { in: requests.map((r) => r.documentId) } },
      select: { documentId: true, version: true, completedAt: true },
    });
    const signedKey = new Set(signed.map((a) => `${a.documentId}@${a.version ?? ''}`));

    const rows = requests.map((r) => ({
      documentId: r.documentId,
      version: r.version,
      requestedAt: r.requestedAt,
      dueAt: r.dueAt,
      // The field the screen declared and nobody ever set.
      acknowledgedByMe: signedKey.has(`${r.documentId}@${r.version}`),
      document: r.document,
    }));

    res.json({
      status: 'success',
      outstanding: rows.filter((r) => !r.acknowledgedByMe).length,
      requests: rows,
    });
  } catch (error: any) {
    console.error('[My Acknowledgements Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load your acknowledgements' });
  }
};

// ─── Legal Hold (apply / release) ───────────────────────────────────────────

export const applyLegalHold = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const tenantId = req.user!.tenantId;
    const userId = req.user!.id;
    const id = req.params.id as string;
    const { matter, reason } = req.body || {};

    if (!matter || !reason) {
      res.status(400).json({ status: 'error', message: 'matter and reason are required' });
      return;
    }

    const doc = await prisma.document.findFirst({ where: { id, tenantId } });
    if (!doc) { res.status(404).json({ status: 'error', message: 'Document not found' }); return; }
    if (isFrozenByLegalHold(doc)) {
      res.status(409).json({ status: 'error', message: 'Document is already under legal hold' });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.document.update({
        where: { id },
        data: {
          legalHoldMatter: matter, legalHoldReason: reason,
          legalHoldBy: userId, legalHoldAt: new Date(),
        },
      });
      await writeAudit(tx, {
        tenantId, actorId: userId, action: 'DOCUMENT_LEGAL_HOLD_APPLIED',
        subjectType: SUBJECT_DOCUMENT, subjectId: id,
        payload: { documentId: id, matter, reason },
      });
      return u;
    });

    res.json({ status: 'success', message: 'Legal hold applied. Document is frozen from edits and deletion.', document: updated });
  } catch (error: any) {
    console.error('[Legal Hold Apply Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to apply legal hold' });
  }
};

export const releaseLegalHold = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const tenantId = req.user!.tenantId;
    const userId = req.user!.id;
    const id = req.params.id as string;
    const { reason } = req.body || {};

    if (!reason) {
      res.status(400).json({ status: 'error', message: 'reason is required to release a legal hold' });
      return;
    }

    const doc = await prisma.document.findFirst({ where: { id, tenantId } });
    if (!doc) { res.status(404).json({ status: 'error', message: 'Document not found' }); return; }
    if (!isFrozenByLegalHold(doc)) {
      res.status(409).json({ status: 'error', message: 'Document is not under legal hold' });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.document.update({
        where: { id },
        data: {
          legalHoldMatter: null, legalHoldReason: null,
          legalHoldBy: null, legalHoldAt: null,
        },
      });
      await writeAudit(tx, {
        tenantId, actorId: userId, action: 'DOCUMENT_LEGAL_HOLD_RELEASED',
        subjectType: SUBJECT_DOCUMENT, subjectId: id,
        payload: { documentId: id, reason, previousMatter: doc.legalHoldMatter },
      });
      return u;
    });

    res.json({ status: 'success', message: 'Legal hold released', document: updated });
  } catch (error: any) {
    console.error('[Legal Hold Release Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to release legal hold' });
  }
};

// ─── Force-release a stuck checkout (admin only, requires justification) ────

export const forceReleaseCheckout = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const tenantId = req.user!.tenantId;
    const userId = req.user!.id;
    const id = req.params.id as string;
    const { reason } = req.body || {};

    if (!reason) {
      res.status(400).json({ status: 'error', message: 'reason is required for a force-release' });
      return;
    }

    const doc = await prisma.document.findFirst({ where: { id, tenantId } });
    if (!doc) { res.status(404).json({ status: 'error', message: 'Document not found' }); return; }
    if (!doc.isLockedOut) {
      res.status(409).json({ status: 'error', message: 'Document is not currently checked out' });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.document.update({
        where: { id },
        data: { isLockedOut: false, checkedOutBy: null, checkedOutAt: null },
      });
      await writeAudit(tx, {
        tenantId, actorId: userId, action: 'DOCUMENT_FORCE_RELEASED',
        subjectType: SUBJECT_DOCUMENT, subjectId: id,
        payload: { documentId: id, previousCheckedOutBy: doc.checkedOutBy, reason },
      });
      return u;
    });

    res.json({ status: 'success', message: 'Checkout force-released', document: updated });
  } catch (error: any) {
    console.error('[Force Release Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to force-release' });
  }
};

// ─── Stats ──────────────────────────────────────────────────────────────────

export const getDocumentStats = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const tenantId = req.user!.tenantId;
    const userId = req.user!.id;

    const [total, draft, inReview, approved, published, archived, returned, onLegalHold] = await Promise.all([
      prisma.document.count({ where: { tenantId } }),
      prisma.document.count({ where: { tenantId, status: 'DRAFT' } }),
      prisma.document.count({ where: { tenantId, status: 'IN_REVIEW' } }),
      prisma.document.count({ where: { tenantId, status: 'APPROVED' } }),
      prisma.document.count({ where: { tenantId, status: 'PUBLISHED' } }),
      prisma.document.count({ where: { tenantId, status: 'ARCHIVED' } }),
      prisma.document.count({ where: { tenantId, status: 'RETURNED' } }),
      prisma.document.count({ where: { tenantId, legalHoldAt: { not: null } } }),
    ]);

    const pendingMyApproval = await prisma.approvalQueue.count({
      where: { approverId: userId, status: 'PENDING' },
    });

    const myUnacknowledged = await prisma.document.count({
      where: {
        tenantId, status: 'PUBLISHED',
        acknowledgements: { none: { userId } },
      },
    });

    res.json({
      status: 'success',
      stats: { total, draft, inReview, approved, published, archived, returned, onLegalHold, pendingMyApproval, myUnacknowledged },
    });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: 'Failed to fetch document stats' });
  }
};
