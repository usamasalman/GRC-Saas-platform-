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
 *
 * The comment above used to sit directly on top of
 * `process.env.DATABASE_URL || 'postgresql://build:build@localhost:5432/build'`,
 * which is a fallback, and the file that is supposed to make a missing URL
 * loud was the file quietly supplying one. Nothing needs it: the Dockerfile
 * passes that build URL inline on both `prisma generate` lines, because
 * generate reads the URL only to learn the provider and never connects.
 */
const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    'DATABASE_URL is not set. Prisma will not guess one — a guessed URL is how '
    + '`migrate deploy` reports success against a database nobody is using. '
    + 'Set it in .env for local work; the container and CI both pass it in.',
  );
}

export default defineConfig({
  schema: './prisma/schema.prisma',
  datasource: { url },
});
