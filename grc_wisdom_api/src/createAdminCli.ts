import { PrismaClient } from '@prisma/client';
import { PrismaNodeSQLite } from 'prisma-adapter-node-sqlite';

const adapter = new PrismaNodeSQLite({ url: 'file:dev.db' });
const prisma = new PrismaClient({ adapter });

async function createAdmin() {
  const args = process.argv.slice(2);
  let email = 'admin@grcwisdom.sa';
  let name = 'Platform Super Admin';
  let password = 'Demo@2026';
  let role = 'Platform Super Admin';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--email' && args[i + 1]) email = args[i + 1];
    if (args[i] === '--name' && args[i + 1]) name = args[i + 1];
    if (args[i] === '--password' && args[i + 1]) password = args[i + 1];
    if (args[i] === '--role' && args[i + 1]) role = args[i + 1];
  }

  console.log(`[Create Admin CLI]: Creating SaaS Admin for ${email}...`);

  let saasTenant = await prisma.tenant.findFirst({
    where: { name: 'GRC Wisdom SaaS Control Plane' }
  });

  if (!saasTenant) {
    saasTenant = await prisma.tenant.create({
      data: {
        name: 'GRC Wisdom SaaS Control Plane',
        type: 'SAAS'
      }
    });
  }

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      name,
      passwordHash: password,
      role,
      context: 'GRC Wisdom SaaS Control Plane',
      status: 'Active'
    },
    create: {
      email,
      name,
      passwordHash: password,
      tenantId: saasTenant.id,
      role,
      context: 'GRC Wisdom SaaS Control Plane',
      profile: 'Platform Owner',
      status: 'Active'
    }
  });

  console.log('----------------------------------------------------');
  console.log('SUCCESS: SaaS Admin Credentials Provisioned!');
  console.log(`Email:    ${user.email}`);
  console.log(`Password: ${password}`);
  console.log(`Role:     ${user.role}`);
  console.log(`Tenant:   ${saasTenant.name} (${user.tenantId})`);
  console.log('----------------------------------------------------');
}

createAdmin()
  .catch(err => {
    console.error('Error creating SaaS Admin:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
