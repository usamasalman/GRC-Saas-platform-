/**
 * One-shot: create the 4 platform-default SoD rules if they don't already exist.
 * Safe to re-run. Use this in existing environments where a full re-seed would
 * wipe production/dev data.
 *
 * Usage: ./node_modules/.bin/tsx src/scripts/seed-sod-rules.ts
 */
import { prisma } from '../db';

const DEFAULTS = [
  {
    key: 'dms-author-approver',
    description: 'A document author cannot approve their own document.',
    subjectType: 'Document',
    conflictingActions: ['DOCUMENT_CREATED', 'DOCUMENT_CHECKED_IN'],
    guardedAction: 'DOCUMENT_APPROVED',
  },
  {
    key: 'iam-access-request',
    description: 'A user cannot approve their own access request.',
    subjectType: 'AccessRequest',
    conflictingActions: ['ACCESS_REQUESTED'],
    guardedAction: 'ACCESS_APPROVED',
  },
  {
    key: 'audit-finding-closure',
    description: 'The auditor who raised a finding cannot independently close it.',
    subjectType: 'AuditFinding',
    conflictingActions: ['AUDIT_FINDING_RAISED'],
    guardedAction: 'AUDIT_FINDING_CLOSED',
  },
  {
    key: 'billing-invoice-approver',
    description: 'The user who submits an invoice adjustment cannot approve it.',
    subjectType: 'Invoice',
    conflictingActions: ['INVOICE_SUBMITTED'],
    guardedAction: 'INVOICE_APPROVED',
  },
];

async function main() {
  let created = 0;
  let skipped = 0;
  for (const r of DEFAULTS) {
    const existing = await prisma.sodRule.findFirst({
      where: { tenantId: null, key: r.key },
    });
    if (existing) { skipped++; continue; }
    await prisma.sodRule.create({
      data: {
        tenantId: null,
        key: r.key,
        description: r.description,
        subjectType: r.subjectType,
        conflictingActions: JSON.stringify(r.conflictingActions),
        guardedAction: r.guardedAction,
        isActive: true,
      },
    });
    created++;
  }
  console.log(`[seed-sod-rules] created=${created} skipped=${skipped}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
