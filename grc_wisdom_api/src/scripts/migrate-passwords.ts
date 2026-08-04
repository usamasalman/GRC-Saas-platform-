/**
 * One-shot: rehash any User.passwordHash rows that aren't already bcrypt.
 *
 * Safe to re-run — rows that already look bcrypted are skipped.
 * Emails are also lowercased for consistent lookups.
 *
 * Usage: npx ts-node src/scripts/migrate-passwords.ts
 */
import bcrypt from 'bcrypt';
import { prisma } from '../db';

const BCRYPT_ROUNDS = 10;
const DEFAULT_PASSWORD = 'Demo@2026';

function looksBcrypted(hash: string | null): boolean {
  if (!hash) return false;
  // bcrypt hashes start with $2a$, $2b$, or $2y$ and are 60 chars.
  return /^\$2[aby]\$/.test(hash) && hash.length >= 55;
}

async function main() {
  const users = await prisma.user.findMany({
    select: { id: true, email: true, passwordHash: true },
  });

  let rehashed = 0;
  let lowered = 0;
  let skipped = 0;

  for (const u of users) {
    const updates: { passwordHash?: string; email?: string } = {};

    if (!looksBcrypted(u.passwordHash)) {
      const source = u.passwordHash && u.passwordHash !== 'mock-hash' ? u.passwordHash : DEFAULT_PASSWORD;
      updates.passwordHash = await bcrypt.hash(source, BCRYPT_ROUNDS);
      rehashed++;
    } else {
      skipped++;
    }

    const lower = u.email.trim().toLowerCase();
    if (u.email !== lower) {
      updates.email = lower;
      lowered++;
    }

    if (Object.keys(updates).length > 0) {
      await prisma.user.update({ where: { id: u.id }, data: updates });
    }
  }

  console.log(`[migrate-passwords] rehashed=${rehashed} lowercased=${lowered} skipped=${skipped} total=${users.length}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
