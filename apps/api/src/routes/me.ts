import {
  changeEmailSchema,
  deleteAccountSchema,
  tokenBodySchema,
} from '@osusume/shared';
import { and, eq, gt, or, sql } from 'drizzle-orm';
import {
  assertCurrentPassword,
  assertEmailUnused,
  clearSessionCookie,
  deletePasswordResetTokens,
  firstAdminProtected,
  isAddressRefusal,
  removeUser,
} from '../auth/accounts.ts';
import { emailChangeMail } from '../auth/emails.ts';
import { emailChangeRequest, inviteRequest, user } from '../db/schema.ts';
import { ApiError, isUniqueViolation } from '../lib/errors.ts';
import { lockEmails } from '../lib/locks.ts';
import { sendOrFail } from '../lib/mailer.ts';
import { createRouter, valid } from '../lib/router.ts';
import { generateToken, hashToken } from '../lib/tokens.ts';
import { callerIsAdmin, requireSessionForPasswordCheck } from '../middleware/auth.ts';

const EMAIL_CHANGE_LINK_LIFETIME_MS = 24 * 60 * 60 * 1000;

const tokenInvalid = () =>
  new ApiError(404, 'token_invalid', 'This link is not valid or has expired.');

const requestCompleted = { message: 'Request completed' } as const;
export const meRoutes = createRouter()
  // Delete your own account, given the current password. Same effect as being removed
  .delete('/me', requireSessionForPasswordCheck, valid('json', deleteAccountSchema), async (c) => {
    const { db, auth } = c.var.deps;
    if (c.var.currentUser.isFirstAdmin) throw firstAdminProtected();
    const { currentPassword } = c.req.valid('json');
    await assertCurrentPassword({ db, auth }, c.var.currentUser.id, currentPassword);
    await removeUser(db, c.var.currentUser.id);
    await clearSessionCookie(c, auth);
    return c.body(null, 204);
  })
  // Start changing your email: emails a verification link to the new address
  .post('/me/email', requireSessionForPasswordCheck, valid('json', changeEmailSchema), async (c) => {
    const { db, auth, mailer, publicBaseUrl } = c.var.deps;
    const { currentPassword, newEmail } = c.req.valid('json');
    const userId = c.var.currentUser.id;

    await assertCurrentPassword({ db, auth }, userId, currentPassword);

    // Outside the transaction, so a refusal cancels it too. Were an earlier link to survive only
    // a refusal, using it would show whether this address was refused.
    await db.delete(emailChangeRequest).where(eq(emailChangeRequest.userId, userId));

    const isAdmin = c.var.currentUser.role === 'admin';
    const token = generateToken();
    const values = {
      newEmail,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + EMAIL_CHANGE_LINK_LIFETIME_MS),
    };
    const mail = emailChangeMail(publicBaseUrl, newEmail, token);
    try {
      await db.transaction(async (tx) => {
        await lockEmails(tx, newEmail);
        await assertEmailUnused(tx, newEmail);
        await tx
          .insert(emailChangeRequest)
          .values({ userId, ...values })
          .onConflictDoUpdate({ target: emailChangeRequest.userId, set: values });
        // A failure rolls this back, so the link that could not be sent is dropped.
        await sendOrFail(mailer, mail);
      });
    } catch (error) {
      const hidden =
        isAddressRefusal(error) || (error instanceof ApiError && error.code === 'email_failed');
      if (!hidden || isAdmin) throw error;
    }
    return c.json(requestCompleted, 200);
  })
  // Use the emailed link: applies the email change
  // No session needed: the link may be opened in another browser, and holding it proves
  // control of the new address.
  .post('/me/email/verify', valid('json', tokenBodySchema), async (c) => {
    const { db, auth } = c.var.deps;
    const tokenHash = hashToken(c.req.valid('json').token);

    try {
      const [found] = await db
        .select({ userId: emailChangeRequest.userId })
        .from(emailChangeRequest)
        .where(eq(emailChangeRequest.tokenHash, tokenHash));
      if (!found) throw tokenInvalid();

      await db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(user)
          .where(eq(user.id, found.userId))
          .for('update');
        if (!current) throw tokenInvalid();
        if (current.disabledAt) {
          throw new ApiError(403, 'account_disabled', 'This account is disabled.');
        }

        const [request] = await tx
          .select()
          .from(emailChangeRequest)
          .where(
            and(
              eq(emailChangeRequest.tokenHash, tokenHash),
              gt(emailChangeRequest.expiresAt, new Date()),
            ),
          )
          .for('update');
        if (!request) throw tokenInvalid();

        await lockEmails(tx, current.email, request.newEmail);
        await assertEmailUnused(tx, request.newEmail);

        const [row] = await tx
          .update(user)
          .set({ email: request.newEmail, emailVerified: true })
          .where(eq(user.id, current.id))
          .returning();
        if (!row) throw tokenInvalid();
        await tx.delete(emailChangeRequest).where(eq(emailChangeRequest.id, request.id));
        // No old-address history is kept, and a reset link sent there must stop working.
        await tx
          .delete(inviteRequest)
          .where(sql`lower(${inviteRequest.inviteeEmail}) = lower(${current.email})`);
        await deletePasswordResetTokens(tx, current.id);
        // The address now has an account, so nothing open for it may be accepted.
        await tx
          .update(inviteRequest)
          .set({ status: 'revoked', tokenHash: null })
          .where(
            and(
              sql`lower(${inviteRequest.inviteeEmail}) = lower(${request.newEmail})`,
              or(
                eq(inviteRequest.status, 'pending'),
                and(eq(inviteRequest.status, 'approved'), sql`${inviteRequest.expiresAt} > now()`),
              ),
            ),
          );
      });
      return c.json(requestCompleted, 200);
    } catch (error) {
      const refusal = isUniqueViolation(error, 'user_email_unique')
        ? new ApiError(409, 'email_in_use', 'An account already uses this email address.')
        : error;
      const hidden =
        isAddressRefusal(refusal) ||
        (refusal instanceof ApiError &&
          (refusal.code === 'token_invalid' || refusal.code === 'account_disabled'));
      if (hidden && !(await callerIsAdmin(auth, c.req.raw.headers))) {
        return c.json(requestCompleted, 200);
      }
      throw refusal;
    }
  });
