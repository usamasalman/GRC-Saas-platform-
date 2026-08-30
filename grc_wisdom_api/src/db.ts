import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

/**
 * The single database client for the whole API.
 *
 * The connection string comes from DATABASE_URL and nowhere else. An earlier
 * version hardcoded a SQLite file path here, which meant the Prisma CLI (which
 * reads prisma.config.ts, and therefore DATABASE_URL) and the running server
 * could point at two different databases without either one erroring:
 * migrations landed in one place and user data in another. Reading the
 * environment in exactly one place is what prevents that.
 *
 * There is deliberately no fallback. A missing DATABASE_URL is a
 * misconfiguration, and failing to boot is safer than quietly writing customer
 * data to a file inside a container that gets replaced on the next deploy.
 */
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    '[db] DATABASE_URL is not set. Refusing to start rather than fall back to a '
    + 'local file — see .env.example.'
  );
}

const adapter = new PrismaPg({ connectionString });

export const prisma = new PrismaClient({ adapter });
