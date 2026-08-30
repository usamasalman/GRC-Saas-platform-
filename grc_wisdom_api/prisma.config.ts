import 'dotenv/config';
import { defineConfig } from 'prisma/config';

/**
 * Prisma 7 keeps the connection URL here rather than in schema.prisma, where
 * the `url` property is no longer supported.
 *
 * There is deliberately no fallback. The previous version fell back to
 * 'file:./dev.db', which meant a missing DATABASE_URL silently pointed the CLI
 * at a local SQLite file instead of failing — so `migrate deploy` could report
 * success against a throwaway file while the server talked to Postgres.
 */
const url = process.env.DATABASE_URL || 'postgresql://build:build@localhost:5432/build';

export default defineConfig({
  schema: './prisma/schema.prisma',
  datasource: { url },
});
