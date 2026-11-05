import { createRoute } from '@hono/zod-openapi';
import {
  changeEmailSchema,
  deleteAccountSchema,
  requestCompletedResponseSchema,
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
import type { Database } from '../db/client.ts';
import { emailChangeRequest, inviteRequest, user } from '../db/schema.ts';
import { ApiError, isUniqueViolation } from '../lib/errors.ts';
import { lockEmails } from '../lib/locks.ts';
import { type MailMessage, type Mailer, sendOrFail } from '../lib/mailer.ts';
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

const requestCompleted = { message: 'Request completed' } as const;
const requestCompletedContent = {
  'application/json': { schema: requestCompletedResponseSchema },
};

/**
 * Not awaited, and failures are not reported: the time an SMTP send takes, or its failing, would
 * tell a non-admin the address was not refused. A link that could not be sent is dropped.
 */
function sendLinkInBackground(
  db: Database,
  mailer: Mailer,
  message: MailMessage,
  tokenHash: string,
): void {
  void mailer.send(message).catch(async (error: unknown) => {
    console.error('Sending the email change link failed:', error);
    try {
      await db.delete(emailChangeRequest).where(eq(emailChangeRequest.tokenHash, tokenHash));
    } catch (deleteError) {
      console.error('Dropping the unsent email change link failed:', deleteError);
    }
  });
}

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
    200: {
      description:
        'The same answer whether a link was sent or the address was refused. The email has not changed yet',
      content: requestCompletedContent,
    },
    ...invalidRequest,
    ...unauthenticated,
    409: { description: 'Admins only: why the address was refused', content: conflict[409].content },
    ...rateLimited,
    503: { description: 'Admins only: the email could not be sent', content: emailFailed[503].content },
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
      description:
        'For a non-admin, the same answer whether the email changed, was refused or the link was dead',
      content: requestCompletedContent,
    },
    ...invalidRequest,
    403: { description: 'Admins only: the account is disabled', content: unauthenticated[403].content },
    404: { description: 'Admins only: the link is dead', content: notFound[404].content },
    409: { description: 'Admins only: why the address was refused', content: conflict[409].content },
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

    // Outside the transaction, so a refusal cancels it too. Were an earlier link to survive only
    // a refusal, using it would show whether this address was refused.
    await db.delete(emailChangeRequest).where(eq(emailChangeRequest.userId, userId));

    const isAdmin = c.var.currentUser.role === 'admin';
    const token = generateToken();
    const tokenHash = hashToken(token);
    const values = {
      newEmail,
      tokenHash,
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
        // An admin hears about a failure, which rolls this back.
        if (isAdmin) await sendOrFail(mailer, mail);
      });
    } catch (error) {
      if (!isAddressRefusal(error) || isAdmin) throw error;
      return c.json(requestCompleted, 200);
    }
    if (!isAdmin) sendLinkInBackground(db, mailer, mail, tokenHash);
    return c.json(requestCompleted, 200);
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
