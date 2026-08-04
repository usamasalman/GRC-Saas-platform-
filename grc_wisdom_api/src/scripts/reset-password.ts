/**
 * Reset one user's password to a known value.
 *
 * Usage:
 *   ./node_modules/.bin/tsx src/scripts/reset-password.ts <email> [newPassword]
 *
 *   - <email>       required, case-insensitive
 *   - [newPassword] optional, defaults to "Demo@2026"
 *
 * Examples:
 *   ./node_modules/.bin/tsx src/scripts/reset-password.ts owner@grcwisdom.com
 *   ./node_modules/.bin/tsx src/scripts/reset-password.ts owner@grcwisdom.com MyNewPass123!
 */
import bcrypt from 'bcrypt';
import { prisma } from '../db';

const BCRYPT_ROUNDS = 10;
const DEFAULT_PASSWORD = 'Demo@2026';

async function main() {
  const emailArg = process.argv[2];
  const passwordArg = process.argv[3] || DEFAULT_PASSWORD;

  if (!emailArg) {
    console.error('Usage: reset-password.ts <email> [newPassword]');
    process.exit(1);
  }

  const email = emailArg.trim().toLowerCase();
  const user = await prisma.user.findFirst({ where: { email } });

  if (!user) {
    console.error(`No user found with email "${email}"`);
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(passwordArg, BCRYPT_ROUNDS);
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      // Admin-set temporary — user must change on first login.
      mustChangePassword: true,
      // Also revoke any active refresh tokens — the old session shouldn't outlive a password change.
      refreshTokenHash: null,
      refreshTokenExpiresAt: null,
    },
  });

  console.log(`[reset-password] "${user.email}" (id: ${user.id}) — password set to: ${passwordArg}`);
  console.log(`[reset-password] mustChangePassword=true — user will be forced to change on next login.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
