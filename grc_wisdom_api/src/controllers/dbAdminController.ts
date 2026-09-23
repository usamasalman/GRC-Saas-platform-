import { Request, Response } from 'express';
import { prisma } from '../db';
import { generateHash } from '../utils/cryptoUtils';
// Imported rather than repeated as a literal. The verifier's copy and the
// writer's copy were two separate strings that happened to match.
import { GENESIS_HASH } from '../middlewares/auditMiddleware';
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
 *
 * A row is verified against `hashedAt` — the instant the digest covers —
 * rather than against `timestamp`, the instant the row landed. Those are
 * milliseconds apart, and checking the digest against the wrong one is why
 * this endpoint used to report every tenant's trail as TAMPERED.
 *
 * Rows written before hashedAt existed never stored the value they hashed.
 * They are unverifiable by construction, which is a different statement from
 * tampered, and saying the harsher one about a compliance record nobody
 * touched is its own kind of false reporting. The chain continues through
 * them on their stored hash, so one legacy row at the start of a tenant's
 * history no longer hides everything written since.
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
      let unverifiable = 0;
      let verified = 0;
      let verifiableFrom: Date | null = null;
      let expectedHash = GENESIS_HASH;

      for (const log of logs) {
        // hashedAt when the row has one. `timestamp` otherwise, because a few
        // legacy rows were written by a path that stored the value it hashed
        // and those do verify — reporting them as unverifiable would throw
        // away a real check to keep the code shorter.
        const sealed = log.hashedAt ?? log.timestamp;
        const computed = generateHash(
          `${expectedHash}:${log.action}:${log.payload}:${new Date(sealed).toISOString()}`
        );

        if (computed === log.currentHash) {
          verified += 1;
          if (!verifiableFrom) verifiableFrom = sealed;
          expectedHash = log.currentHash;
          continue;
        }

        if (!log.hashedAt) {
          // A mismatch on a row that never stored what it hashed proves
          // nothing either way. Carry the chain forward on what the row
          // recorded, and count it, rather than accusing it.
          unverifiable += 1;
          expectedHash = log.currentHash;
          continue;
        }

        chainValid = false;
        overallIntegrity = false;
        tamperedLogId = log.id;
        break;
      }

      verificationResults.push({
        tenantId: t.id,
        tenantName: t.name,
        logCount: logs.length,
        verifiedCount: verified,
        // Named rather than folded into the count, because "142 rows, 3 of
        // them unverifiable" is a finding somebody may need to explain to an
        // assessor, and a single VALID would bury it.
        unverifiableCount: unverifiable,
        verifiableFrom,
        status: !chainValid
          ? 'TAMPERED'
          : unverifiable > 0
            ? (verified > 0 ? 'VALID_SINCE' : 'UNVERIFIABLE')
            : 'VALID',
        firstTamperedLogId: tamperedLogId
      });
    }

    res.json({
      status: 'success',
      // Only a genuine mismatch clears this. Rows that predate hashedAt leave
      // it true and are reported per tenant, because "we cannot check the
      // first three entries" is not the same claim as "the trail is intact"
      // and is not the same claim as "somebody changed it" either.
      integrityVerified: overallIntegrity,
      results: verificationResults
    });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: safeError(error) });
  }
};
