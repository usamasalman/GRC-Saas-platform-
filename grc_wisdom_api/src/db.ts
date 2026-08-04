import { PrismaClient } from '@prisma/client';
import { PrismaNodeSQLite } from 'prisma-adapter-node-sqlite';

const adapter = new PrismaNodeSQLite({ url: 'file:dev.db' });
export const prisma = new PrismaClient({ adapter });
