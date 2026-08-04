import { Request, Response } from 'express';
import { prisma } from '../db';
import { generateHash } from '../utils/cryptoUtils';
import { exec } from 'child_process';
import path from 'path';

/**
 * Helper to resolve dynamic Prisma model delegates
 */
const getModelDelegate = (modelName: string): any => {
  const modelLower = modelName.toLowerCase();
  if (modelLower === 'tenant') return prisma.tenant;
  if (modelLower === 'user') return prisma.user;
  if (modelLower === 'auditlog') return prisma.auditLog;
  if (modelLower === 'document') return prisma.document;
  if (modelLower === 'ticket') return prisma.ticket;
  if (modelLower === 'opensourcetool') return prisma.openSourceTool;
  if (modelLower === 'asmasset') return prisma.asmAsset;
  if (modelLower === 'phishcampaign') return prisma.phishCampaign;
  if (modelLower === 'invoice') return prisma.invoice;
  if (modelLower === 'plan') return prisma.plan;
  if (modelLower === 'subscription') return prisma.subscription;
  if (modelLower === 'sodrule') return prisma.sodRule;
  if (modelLower === 'passwordresetrequest') return prisma.passwordResetRequest;
  return null;
};

/**
 * Get all records of a model
 */
export const getTableRecords = async (req: Request, res: Response): Promise<void> => {
  try {
    const model = req.params.model as string;
    const delegate = getModelDelegate(model);

    if (!delegate) {
      res.status(400).json({ status: 'error', message: `Invalid model name: ${model}` });
      return;
    }

    const records = await delegate.findMany({
      orderBy: { createdAt: 'desc' }
    }).catch(async () => {
      // Fallback for models without createdAt
      return await delegate.findMany();
    });

    // Strip sensitive fields — even admins should never see hashes/secrets in the raw table view.
    const SENSITIVE = ['passwordHash', 'mfaSecret', 'refreshTokenHash', 'backupCodes', 'resetCodeHash'];
    const safeRecords = records.map((r: any) => {
      const clean: Record<string, any> = {};
      for (const k of Object.keys(r)) {
        clean[k] = SENSITIVE.includes(k) ? (r[k] ? '••• (hidden)' : null) : r[k];
      }
      return clean;
    });

    res.json({ status: 'success', model, count: safeRecords.length, records: safeRecords });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

/**
 * Create a new record in a model
 */
export const createRecord = async (req: Request, res: Response): Promise<void> => {
  try {
    const model = req.params.model as string;
    const data = req.body;
    const delegate = getModelDelegate(model);

    if (!delegate) {
      res.status(400).json({ status: 'error', message: `Invalid model name: ${model}` });
      return;
    }

    const record = await delegate.create({ data });
    res.status(201).json({ status: 'success', record });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

/**
 * Update a record in a model
 */
export const updateRecord = async (req: Request, res: Response): Promise<void> => {
  try {
    const model = req.params.model as string;
    const id = req.params.id as string;
    const data = req.body;
    const delegate = getModelDelegate(model);

    if (!delegate) {
      res.status(400).json({ status: 'error', message: `Invalid model name: ${model}` });
      return;
    }

    const record = await delegate.update({
      where: { id },
      data
    });
    res.json({ status: 'success', record });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

/**
 * Delete a record in a model
 */
export const deleteRecord = async (req: Request, res: Response): Promise<void> => {
  try {
    const model = req.params.model as string;
    const id = req.params.id as string;
    const delegate = getModelDelegate(model);

    if (!delegate) {
      res.status(400).json({ status: 'error', message: `Invalid model name: ${model}` });
      return;
    }

    await delegate.delete({ where: { id } });
    res.json({ status: 'success', message: 'Record deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

/**
 * Reset database using the seed script
 */
export const resetDatabase = async (req: Request, res: Response): Promise<void> => {
  try {
    console.log('[Database Console]: Reset request received, running seed script...');
    const seedPath = path.resolve(__dirname, '../seed.js');

    exec(`node "${seedPath}"`, (error, stdout, stderr) => {
      if (error) {
        console.error('[Reset Error]:', error);
        res.status(500).json({ status: 'error', message: 'Failed to reset database', details: stderr });
        return;
      }
      res.json({ status: 'success', message: 'Database reset and re-seeded successfully', output: stdout });
    });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

/**
 * Verify Audit Trail Hash Chain Integrity
 */
export const verifyAuditTrail = async (req: Request, res: Response): Promise<void> => {
  try {
    const tenants = await prisma.tenant.findMany();
    const verificationResults: any[] = [];
    let overallIntegrity = true;

    for (const t of tenants) {
      const logs = await prisma.auditLog.findMany({
        where: { tenantId: t.id },
        orderBy: { timestamp: 'asc' }
      });

      let chainValid = true;
      let tamperedLogId: string | null = null;
      let expectedHash = 'GENESIS_HASH_0000000000000000000000000000000000000000000000000000000000000000';

      for (const log of logs) {
        // Recalculate hash
        const computed = generateHash(`${expectedHash}:${log.action}:${log.payload}:${new Date(log.timestamp).toISOString()}`);

        if (computed !== log.currentHash) {
          chainValid = false;
          overallIntegrity = false;
          tamperedLogId = log.id;
          break;
        }

        expectedHash = log.currentHash;
      }

      verificationResults.push({
        tenantId: t.id,
        tenantName: t.name,
        logCount: logs.length,
        status: chainValid ? 'VALID' : 'TAMPERED',
        firstTamperedLogId: tamperedLogId
      });
    }

    res.json({
      status: 'success',
      integrityVerified: overallIntegrity,
      results: verificationResults
    });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};
