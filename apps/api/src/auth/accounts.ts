import { type UserRole, usernameKey } from '@osusume/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { Database, Transaction } from '../db/client.ts';
import { account, emailBlacklist, user, verification } from '../db/schema.ts';
import { ApiError, isUniqueViolation } from '../lib/errors.ts';
import { lockEmails } from '../lib/locks.ts';
import type { AppDependencies } from '../lib/context.ts';

export const firstAdminProtected = () =>
  new ApiError(403, 'first_admin_protected', 'The first admin cannot be changed or removed.');

export function displayName(row: { username: string; displayUsername: string | null }): string {
  return row.displayUsername ?? row.username;
}

export function toAccount(row: typeof user.$inferSelect) {
  return {
    id: row.id,
    username: displayName(row),
    email: row.email,
    role: row.role,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function hashPassword(auth: AppDependencies['auth'], password: string): Promise<string> {
  const context = await auth.$context;
  return context.password.hash(password);
}

/** Refuses an address on the blacklist or held by an account. Hold its email lock first. */
export async function assertEmailUnused(tx: Transaction, email: string): Promise<void> {
  const [blacklisted] = await tx
    .select({ id: emailBlacklist.id })
    .from(emailBlacklist)
    .where(sql`lower(${emailBlacklist.email}) = lower(${email})`);
  if (blacklisted) {
    throw new ApiError(409, 'email_blacklisted', 'This email address cannot be used.');
  }
  const [existing] = await tx
    .select({ id: user.id })
    .from(user)
    .where(sql`lower(${user.email}) = lower(${email})`);
  if (existing) {
    throw new ApiError(409, 'email_in_use', 'An account already uses this email address.');
  }
}

/**
 * Creates an account with a verified email and a password. Better Auth's own sign-up is
 * off, so this is the only way in: first-run setup and accepted invites both prove the
 * address with an emailed link before getting here.
 */
export async function insertAccount(
  tx: Transaction,
  values: {
    username: string;
    email: string;
    passwordHash: string;
    role: UserRole;
    isFirstAdmin?: boolean;
  },
) {
  const [row] = await tx
    .insert(user)
    .values({
      name: values.username,
      username: usernameKey(values.username),
      displayUsername: values.username,
      email: values.email,
      emailVerified: true,
      role: values.role,
      isFirstAdmin: values.isFirstAdmin ?? false,
    })
    .returning();
  if (!row) throw new Error('user was not created');
  await tx.insert(account).values({
    userId: row.id,
    accountId: row.id,
    providerId: 'credential',
    password: values.passwordHash,
  });
  return row;
}

/** Runs a transaction that sets a username, turning a lost race into a clean refusal. */
export async function refusingTakenUsername<Result>(run: () => Promise<Result>): Promise<Result> {
  try {
    return await run();
  } catch (error) {
    if (isUniqueViolation(error, 'user_username_unique')) throw usernameTaken();
    throw error;
  }
}

export const usernameTaken = () =>
  new ApiError(409, 'username_taken', 'This username is taken.');

/** An admin action must be on another account that is not the first admin. */
export function assertAdminActionAllowed(
  target: { id: string; isFirstAdmin: boolean },
  actorId: string,
): void {
  if (target.isFirstAdmin) throw firstAdminProtected();
  if (target.id === actorId) {
    throw new ApiError(403, 'cannot_target_self', 'Admins cannot do this to their own account.');
  }
}

/**
 * Removes an account, the one path behind remove, ban and self-deletion. The foreign keys
 * and user_before_delete do the rest (see src/db/schema.ts). `admin` is who is acting when
 * it is not the user themselves; `ban` also blacklists the current email, in one transaction.
 */
export async function removeUser(
  db: Database,
  userId: string,
  options: { admin?: string; ban?: boolean } = {},
): Promise<void> {
  const { admin, ban = false } = options;
  await db.transaction(async (tx) => {
    const [target] = await tx.select().from(user).where(eq(user.id, userId)).for('update');
    if (!target) throw new ApiError(404, 'user_not_found', 'No such user.');
    if (target.isFirstAdmin) throw firstAdminProtected();
    if (admin !== undefined) assertAdminActionAllowed(target, admin);

    await lockEmails(tx, target.email);
    if (ban) {
      await tx
        .insert(emailBlacklist)
        .values({ email: target.email.toLowerCase(), bannedBy: admin })
        .onConflictDoNothing();
    }
    await tx.delete(user).where(eq(user.id, userId));
  });
}

/** Verifies a user's current password against their credential account. */
export async function verifyCurrentPassword(
  deps: Pick<AppDependencies, 'db' | 'auth'>,
  userId: string,
  password: string,
): Promise<boolean> {
  const [credential] = await deps.db
    .select({ password: account.password })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, 'credential')));
  if (!credential?.password) return false;
  const context = await deps.auth.$context;
  return context.password.verify({ hash: credential.password, password });
}

/** Deletes a user's outstanding password reset tokens, whose rows hold the user id. */
export async function deletePasswordResetTokens(tx: Transaction, userId: string): Promise<void> {
  await tx.delete(verification).where(eq(verification.value, userId));
}
