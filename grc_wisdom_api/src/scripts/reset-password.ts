/**
 * Reset one user's password.
 *
 * Usage:
 *   ./node_modules/.bin/tsx src/scripts/reset-password.ts <email> [newPassword]
 *
 *   - <email>       required, case-insensitive
 *   - [newPassword] optional; if omitted a strong one is generated and printed
 *
 * The user is forced to change it at next sign-in either way, and any active
 * refresh token is revoked so an existing session cannot outlive the reset.
 */
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { prisma } from '../db';

const BCRYPT_ROUNDS = 12;

/**
 * There is deliberately no default password.
 *
 * This script used to fall back to 'Demo@2026' — a value published in the
 * platform guide — so running it with only an email address handed the account
 * a credential anyone could look up.
 */
function generatePassword(): string {
  // Avoids look-alike characters so it can be read off a terminal correctly.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(20);
  let out = '';
  for (let i = 0; i < 20; i++) out += alphabet[bytes[i] % alphabet.length];
  return `${out.slice(0, 5)}-${out.slice(5, 10)}-${out.slice(10, 15)}-${out.slice(15, 20)}`;
}

async function main() {
  const emailArg = process.argv[2];
  const supplied = process.argv[3];

  if (!emailArg) {
    console.error('Usage: reset-password.ts <email> [newPassword]');
    process.exit(1);
  }

  const password = supplied || generatePassword();

  if (supplied && supplied.length < 12) {
    console.error('Password must be at least 12 characters.');
    process.exit(1);
  }

  const email = emailArg.trim().toLowerCase();
  const user = await prisma.user.findFirst({ where: { email } });

  if (!user) {
    console.error(`No user found with email "${email}"`);
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      mustChangePassword: true,
      // An old session should not survive a credential reset.
      refreshTokenHash: null,
      refreshTokenExpiresAt: null,
    },
  });

  // Echoed only when this script generated it. A password the operator typed is
  // already in their shell history; printing it again just makes another copy.
  if (supplied) {
    console.log(`[reset-password] "${user.email}" — password updated.`);
  } else {
    console.log(`[reset-password] "${user.email}" — temporary password: ${password}`);
  }
  console.log('[reset-password] mustChangePassword=true — they must change it at next sign-in.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
