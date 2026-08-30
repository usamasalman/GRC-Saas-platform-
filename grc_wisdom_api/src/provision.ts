import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import RBAC from './utils/rbacData.json';

/**
 * Provisioning — what a production database needs before anyone can log in.
 *
 * This is deliberately NOT the seed. The seed builds a demonstration: eight
 * fictional tenants, thirty-five people, sample risks and audits, and it opens
 * with 58 deleteMany() calls. Running it against a live database destroys the
 * customer's data.
 *
 * What a real deployment still needs is the reference data the platform cannot
 * function without:
 *
 *   - the 34 capabilities, which every authorisation check resolves against
 *   - the 42 system roles from TRD Appendix A, which carry the capability
 *     grants — a user whose roleId is null gets an empty capability set and
 *     can see nothing, regardless of what their role *string* says
 *   - a control-plane tenant of type SAAS, which is what requirePlatformTenant
 *     actually checks
 *   - one real administrator who can sign in
 *
 * Every step is an upsert. Running this on each deploy is safe and is the
 * intended use: it converges the reference data to match the catalogue without
 * touching tenant data.
 *
 *   npm run provision
 *
 * The bootstrap administrator is created only when BOOTSTRAP_ADMIN_EMAIL is
 * set. The password comes from BOOTSTRAP_ADMIN_PASSWORD, or is generated and
 * printed once if that is unset. An existing user is never silently
 * re-credentialed — pass --reset-admin-password to do that deliberately.
 */

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('[provision] DATABASE_URL is not set.');
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const BCRYPT_ROUNDS = 12;
const CONTROL_PLANE_TENANT = 'GRC Wisdom Control Plane';
const SUPER_ADMIN_ROLE_KEY = 'platform-super-admin';

const args = process.argv.slice(2);
const has = (flag: string) => args.includes(flag);

/** A password a person can retype, with enough entropy to survive being public for one minute. */
function generatePassword(): string {
  // Avoids look-alike characters so it can be read off a terminal correctly.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(20);
  let out = '';
  for (let i = 0; i < 20; i++) out += alphabet[bytes[i] % alphabet.length];
  return `${out.slice(0, 5)}-${out.slice(5, 10)}-${out.slice(10, 15)}-${out.slice(15, 20)}`;
}

async function provisionCapabilities(): Promise<number> {
  const rbac = RBAC as any;
  for (const c of rbac.capabilities) {
    await prisma.capability.upsert({
      where: { key: c.key },
      update: {
        name: c.name,
        module: c.module,
        number: c.number,
        tenancySpecific: c.tenancySpecific,
      },
      create: {
        key: c.key,
        name: c.name,
        module: c.module,
        number: c.number,
        tenancySpecific: c.tenancySpecific,
      },
    });
  }
  return rbac.capabilities.length;
}

async function provisionSystemRoles(): Promise<number> {
  const rbac = RBAC as any;

  for (const r of rbac.roles) {
    // Role.key is not unique on its own — the same key can exist once per
    // tenant plus once at platform level — so this matches on the pair that is
    // actually unique for a system role: key with a null tenantId.
    const existing = await prisma.role.findFirst({
      where: { key: r.key, tenantId: null },
      select: { id: true },
    });

    const data = {
      name: r.name,
      portal: r.portal,
      scopeDescription: r.scopeDescription ?? null,
      capabilityGrants: JSON.stringify(r.capabilities),
      isSystem: true,
    };

    if (existing) {
      // Re-asserting the grants is the point: it is how a capability added to
      // the catalogue reaches roles that already exist in a live database.
      await prisma.role.update({ where: { id: existing.id }, data });
    } else {
      await prisma.role.create({ data: { ...data, tenantId: null, key: r.key } });
    }
  }
  return rbac.roles.length;
}

/**
 * Platform-default segregation-of-duties rules.
 *
 * These were in a separate one-shot script (scripts/seed-sod-rules.ts), which
 * meant a fresh production database had NO SoD rules at all — the engine would
 * find nothing to enforce and every self-approval would pass. They belong with
 * the rest of the reference data.
 */
const SOD_DEFAULTS = [
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
    subjectType: 'Issue',
    conflictingActions: ['ISSUE_RAISED'],
    guardedAction: 'ISSUE_CLOSED',
  },
  {
    key: 'billing-invoice-approver',
    description: 'The user who submits an invoice adjustment cannot approve it.',
    subjectType: 'Invoice',
    conflictingActions: ['INVOICE_SUBMITTED'],
    guardedAction: 'INVOICE_APPROVED',
  },
];

async function provisionSodRules(): Promise<number> {
  for (const r of SOD_DEFAULTS) {
    const existing = await prisma.sodRule.findFirst({
      where: { tenantId: null, key: r.key },
      select: { id: true },
    });
    const data = {
      description: r.description,
      subjectType: r.subjectType,
      conflictingActions: JSON.stringify(r.conflictingActions),
      guardedAction: r.guardedAction,
    };
    if (existing) {
      // isActive is deliberately not re-asserted: an operator who deactivated a
      // platform rule for a documented reason should not have that silently
      // undone by the next deploy.
      await prisma.sodRule.update({ where: { id: existing.id }, data });
    } else {
      await prisma.sodRule.create({ data: { ...data, tenantId: null, key: r.key, isActive: true } });
    }
  }
  return SOD_DEFAULTS.length;
}

async function provisionControlPlaneTenant(): Promise<{ id: string; name: string }> {
  // requirePlatformTenant tests tenant.type, not the name, so an existing
  // control plane under any name is honoured rather than duplicated.
  const existing = await prisma.tenant.findFirst({
    where: { type: { in: ['SAAS', 'SAAS_UNIT'] } },
    select: { id: true, name: true },
  });
  if (existing) return existing;

  return prisma.tenant.create({
    data: { name: CONTROL_PLANE_TENANT, type: 'SAAS', path: '/' },
    select: { id: true, name: true },
  });
}

async function provisionAdmin(tenant: { id: string; name: string }): Promise<void> {
  const email = String(process.env.BOOTSTRAP_ADMIN_EMAIL || '').trim().toLowerCase();
  if (!email) {
    console.log('  admin:          skipped (BOOTSTRAP_ADMIN_EMAIL not set)');
    return;
  }

  const role = await prisma.role.findFirst({
    where: { key: SUPER_ADMIN_ROLE_KEY, tenantId: null },
    select: { id: true, name: true },
  });
  if (!role) {
    throw new Error(`System role "${SUPER_ADMIN_ROLE_KEY}" is missing after provisioning.`);
  }

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true, roleId: true },
  });

  if (existing && !has('--reset-admin-password')) {
    // Do not touch the credential, but do repair the capability link. An admin
    // created by the old CLI has a role *string* and a null roleId, which is an
    // account that can log in and then do nothing at all.
    if (existing.roleId !== role.id) {
      await prisma.user.update({
        where: { id: existing.id },
        data: { roleId: role.id, role: role.name },
      });
      console.log(`  admin:          ${email} — repaired capability link to "${role.name}"`);
    } else {
      console.log(`  admin:          ${email} — already provisioned, password untouched`);
    }
    return;
  }

  const supplied = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  const password = supplied || generatePassword();
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  await prisma.user.upsert({
    where: { email },
    update: {
      passwordHash,
      roleId: role.id,
      role: role.name,
      status: 'Active',
      // A generated password is a delivery mechanism, not a credential.
      mustChangePassword: !supplied,
      refreshTokenHash: null,
      refreshTokenExpiresAt: null,
    },
    create: {
      email,
      name: process.env.BOOTSTRAP_ADMIN_NAME || 'Platform Administrator',
      passwordHash,
      tenantId: tenant.id,
      role: role.name,
      roleId: role.id,
      context: tenant.name,
      profile: 'Platform Owner',
      status: 'Active',
      mustChangePassword: !supplied,
    },
  });

  console.log(`  admin:          ${email} (${role.name})`);

  // Printed only when this process generated it. A password supplied through
  // the environment is already known to the operator and echoing it would just
  // copy it into the deploy log.
  if (!supplied) {
    console.log('');
    console.log('  ┌─────────────────────────────────────────────────────────────┐');
    console.log('  │  Generated password — shown once, not stored anywhere else  │');
    console.log('  └─────────────────────────────────────────────────────────────┘');
    console.log(`     ${password}`);
    console.log('');
    console.log('  You will be required to change it at first sign-in.');
    console.log('');
  }
}

async function main(): Promise<void> {
  console.log('[provision] Converging reference data...');

  const capabilities = await provisionCapabilities();
  console.log(`  capabilities:   ${capabilities}`);

  const roles = await provisionSystemRoles();
  console.log(`  system roles:   ${roles}`);

  const sod = await provisionSodRules();
  console.log(`  SoD rules:      ${sod}`);

  const tenant = await provisionControlPlaneTenant();
  console.log(`  control plane:  ${tenant.name}`);

  await provisionAdmin(tenant);

  console.log('[provision] Done. No tenant data was modified.');
}

main()
  .catch((err) => {
    console.error('[provision] Failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
