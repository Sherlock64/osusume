import { createRoute } from '@hono/zod-openapi';
import {
  accountSchema,
  changeEmailSchema,
  deleteAccountSchema,
  emailSentResponseSchema,
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
  toAccount,
} from '../auth/accounts.ts';
import { emailChangeMail } from '../auth/emails.ts';
import { emailChangeRequest, inviteRequest, user } from '../db/schema.ts';
import { ApiError, isUniqueViolation } from '../lib/errors.ts';
import { lockEmails } from '../lib/locks.ts';
import { sendOrFail } from '../lib/mailer.ts';
import {
  conflict,
  createRouter,
  emailFailed,
  invalidRequest,
  notFound,
  rateLimited,
  sessionSecurity,
  unauthenticated,
} from '../lib/router.ts';
import { generateToken, hashToken } from '../lib/tokens.ts';
import { callerIsAdmin, requireSessionForPasswordCheck } from '../middleware/auth.ts';

const EMAIL_CHANGE_LINK_LIFETIME_MS = 24 * 60 * 60 * 1000;

const tokenInvalid = () =>
  new ApiError(404, 'token_invalid', 'This link is not valid or has expired.');

/**
 * All a non-admin hears when asking for an email change or using its link, for an address that
 * is registered or banned and, on the link, for a dead link too.
 */
const emailChangeRefused = () =>
  new ApiError(409, 'email_change_refused', 'This email change cannot be completed.');

const deleteAccountRoute = createRoute({
  method: 'delete',
  path: '/me',
  summary: 'Delete your own account, given the current password. Same effect as being removed',
  security: sessionSecurity,
  middleware: requireSessionForPasswordCheck,
  request: {
    body: { required: true, content: { 'application/json': { schema: deleteAccountSchema } } },
  },
  responses: {
    204: { description: 'The account was deleted' },
    ...invalidRequest,
    ...unauthenticated,
    ...rateLimited,
  },
});

const requestEmailChangeRoute = createRoute({
  method: 'post',
  path: '/me/email',
  summary: 'Start changing your email: emails a verification link to the new address',
  security: sessionSecurity,
  middleware: requireSessionForPasswordCheck,
  request: {
    body: { required: true, content: { 'application/json': { schema: changeEmailSchema } } },
  },
  responses: {
    202: {
      description: 'The link was sent; the email has not changed yet',
      content: { 'application/json': { schema: emailSentResponseSchema } },
    },
    ...invalidRequest,
    ...unauthenticated,
    ...conflict,
    ...rateLimited,
    ...emailFailed,
  },
});

// No session needed: the link may be opened in another browser, and holding it proves
// control of the new address.
const verifyEmailChangeRoute = createRoute({
  method: 'post',
  path: '/me/email/verify',
  summary: 'Use the emailed link: applies the email change',
  request: {
    body: { required: true, content: { 'application/json': { schema: tokenBodySchema } } },
  },
  responses: {
    200: {
      description: 'The email was changed',
      content: { 'application/json': { schema: accountSchema } },
    },
    ...invalidRequest,
    403: unauthenticated[403],
    ...notFound,
    ...conflict,
  },
});

export const meRoutes = createRouter()
  .openapi(deleteAccountRoute, async (c) => {
    const { db, auth } = c.var.deps;
    if (c.var.currentUser.isFirstAdmin) throw firstAdminProtected();
    const { currentPassword } = c.req.valid('json');
    await assertCurrentPassword({ db, auth }, c.var.currentUser.id, currentPassword);
    await removeUser(db, c.var.currentUser.id);
    await clearSessionCookie(c, auth);
    return c.body(null, 204);
  })
  .openapi(requestEmailChangeRoute, async (c) => {
    const { db, auth, mailer, publicBaseUrl } = c.var.deps;
    const { currentPassword, newEmail } = c.req.valid('json');
    const userId = c.var.currentUser.id;

    await assertCurrentPassword({ db, auth }, userId, currentPassword);

    const token = generateToken();
    const values = {
      newEmail,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + EMAIL_CHANGE_LINK_LIFETIME_MS),
    };
    try {
      await db.transaction(async (tx) => {
        await lockEmails(tx, newEmail);
        await assertEmailUnused(tx, newEmail);
        await tx
          .insert(emailChangeRequest)
          .values({ userId, ...values })
          .onConflictDoUpdate({ target: emailChangeRequest.userId, set: values });
        await sendOrFail(mailer, emailChangeMail(publicBaseUrl, newEmail, token));
      });
    } catch (error) {
      if (isAddressRefusal(error) && c.var.currentUser.role !== 'admin') throw emailChangeRefused();
      throw error;
    }
    return c.json({ status: 'email_sent' as const }, 202);
  })
  .openapi(verifyEmailChangeRoute, async (c) => {
    const { db, auth } = c.var.deps;
    const tokenHash = hashToken(c.req.valid('json').token);

    try {
      const [found] = await db
        .select({ userId: emailChangeRequest.userId })
        .from(emailChangeRequest)
        .where(eq(emailChangeRequest.tokenHash, tokenHash));
      if (!found) throw tokenInvalid();

      const updated = await db.transaction(async (tx) => {
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
        return row;
      });
      return c.json(toAccount(updated), 200);
    } catch (error) {
      const refusal = isUniqueViolation(error, 'user_email_unique')
        ? new ApiError(409, 'email_in_use', 'An account already uses this email address.')
        : error;
      const hidden =
        isAddressRefusal(refusal) ||
        (refusal instanceof ApiError && refusal.code === 'token_invalid');
      if (hidden && !(await callerIsAdmin(auth, c.req.raw.headers))) throw emailChangeRefused();
      throw refusal;
    }
  });
