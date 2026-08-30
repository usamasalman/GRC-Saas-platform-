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
/**
 * Credentials and secrets never leave this controller, on any path.
 *
 * The read path already did this. create and update did not, so writing to the
 * User model echoed back passwordHash, mfaSecret and refreshTokenHash to the
 * caller — a full credential dump in the response body of an ordinary edit.
 */
const SENSITIVE = ['passwordHash', 'mfaSecret', 'refreshTokenHash', 'backupCodes', 'resetCodeHash'];

function redact(r: any): Record<string, any> {
  const clean: Record<string, any> = {};
  for (const k of Object.keys(r || {})) {
    clean[k] = SENSITIVE.includes(k) ? (r[k] ? '••• (hidden)' : null) : r[k];
  }
  return clean;
}

/**
 * Prisma errors name tables, columns and constraints. That is useful in a log
 * and is a schema map in a response body.
 */
function safeError(error: any): string {
  if (process.env.NODE_ENV === 'production') return 'The operation could not be completed.';
  return error?.message || 'Unknown error';
}

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

    const safeRecords = records.map(redact);

    res.json({ status: 'success', model, count: safeRecords.length, records: safeRecords });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: safeError(error) });
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
    res.status(201).json({ status: 'success', record: redact(record) });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: safeError(error) });
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
    res.json({ status: 'success', record: redact(record) });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: safeError(error) });
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
    res.status(500).json({ status: 'error', message: safeError(error) });
  }
};

/**
 * Reset database using the seed script
 */
export const resetDatabase = async (req: Request, res: Response): Promise<void> => {
  try {
    // This shells out to seed.js, which opens with 58 deleteMany() calls. It is
    // a development convenience and there is no version of it that is safe to
    // expose in production, however well gated the route is — capability checks
    // protect against the wrong person, not against the right person at 2am.
    if (process.env.NODE_ENV === 'production') {
      res.status(403).json({
        status: 'error',
        code: 'DISABLED_IN_PRODUCTION',
        message: 'Database reset is disabled in production. Restore from a backup instead.',
      });
      return;
    }

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
    res.status(500).json({ status: 'error', message: safeError(error) });
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
    res.status(500).json({ status: 'error', message: safeError(error) });
  }
};
