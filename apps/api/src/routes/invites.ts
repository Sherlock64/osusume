import { createRoute, z } from '@hono/zod-openapi';
import {
  INVITE_LIFETIME_DAYS,
  acceptInviteSchema,
  accountSchema,
  adminInviteRequestListQuerySchema,
  adminInviteRequestSchema,
  createInviteRequestSchema,
  decisionSchema,
  idParamSchema,
  invitePreviewSchema,
  inviteRequestListQuerySchema,
  inviteRequestSchema,
  paginatedSchema,
} from '@osusume/shared';
import { and, eq, or, sql } from 'drizzle-orm';
import {
  assertEmailUnused,
  hashPassword,
  insertAccount,
  isAddressRefusal,
  refusingTakenUsername,
  toAccount,
} from '../auth/accounts.ts';
import { inviteMail } from '../auth/emails.ts';
import type { Transaction } from '../db/client.ts';
import { emailBlacklist, inviteRequest, user } from '../db/schema.ts';
import { ApiError, isUniqueViolation } from '../lib/errors.ts';
import { lockEmails } from '../lib/locks.ts';
import { sendOrFail } from '../lib/mailer.ts';
import { decodeCursor, keyset, toPage } from '../lib/pagination.ts';
import {
  adminOnly,
  conflict,
  createRouter,
  emailFailed,
  invalidRequest,
  notFound,
  sessionSecurity,
  unauthenticated,
} from '../lib/router.ts';
import { generateToken, hashToken } from '../lib/tokens.ts';
import { callerIsAdmin, requireAdmin, requireSession } from '../middleware/auth.ts';

const inviteOpen = () =>
  new ApiError(409, 'invite_already_open', 'This email address already has an open invite.');
/** All a non-admin hears: nobody learns if an address is registered, banned or already invited. */
const inviteRefused = () =>
  new ApiError(409, 'invite_refused', 'This email address cannot be invited.');
const inviteNotFound = () => new ApiError(404, 'invite_not_found', 'No such invite request.');
const inviteInvalid = () =>
  new ApiError(404, 'invite_invalid', 'This invite link is not valid or has expired.');

/** Hold the email's lock. Open: pending, or approved and not yet expired, accepted or revoked. */
async function assertNoOpenInvite(tx: Transaction, email: string): Promise<void> {
  const [open] = await tx
    .select({ id: inviteRequest.id })
    .from(inviteRequest)
    .where(
      and(
        sql`lower(${inviteRequest.inviteeEmail}) = lower(${email})`,
        or(
          eq(inviteRequest.status, 'pending'),
          and(eq(inviteRequest.status, 'approved'), sql`${inviteRequest.expiresAt} > now()`),
        ),
      ),
    )
    .limit(1);
  if (open) throw inviteOpen();
}

function toInviteRequest(row: typeof inviteRequest.$inferSelect) {
  return {
    id: row.id,
    inviteeEmail: row.inviteeEmail,
    status: row.status,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function toAdminInviteRequest(row: typeof inviteRequest.$inferSelect, requesterUsername: string | null) {
  return {
    ...toInviteRequest(row),
    requesterId: row.requesterId,
    requesterUsername,
    decidedBy: row.decidedBy,
  };
}

const inviteRequestContent = { 'application/json': { schema: inviteRequestSchema } };
const adminInviteRequestContent = { 'application/json': { schema: adminInviteRequestSchema } };

const createRequestRoute = createRoute({
  method: 'post',
  path: '/invite-requests',
  summary: 'Request an invite for an email address',
  security: sessionSecurity,
  middleware: requireSession,
  request: {
    body: { required: true, content: { 'application/json': { schema: createInviteRequestSchema } } },
  },
  responses: {
    201: { description: 'The request is waiting for an admin', content: inviteRequestContent },
    ...invalidRequest,
    ...unauthenticated,
    ...conflict,
  },
});

const listMineRoute = createRoute({
  method: 'get',
  path: '/invite-requests',
  summary: 'The invite requests the current user made, newest first',
  security: sessionSecurity,
  middleware: requireSession,
  request: { query: inviteRequestListQuerySchema },
  responses: {
    200: {
      description: 'A page of invite requests',
      content: { 'application/json': { schema: paginatedSchema(inviteRequestSchema) } },
    },
    ...invalidRequest,
    ...unauthenticated,
  },
});

const adminListRoute = createRoute({
  method: 'get',
  path: '/admin/invite-requests',
  summary: 'All invite requests, newest first',
  security: sessionSecurity,
  middleware: requireAdmin,
  request: { query: adminInviteRequestListQuerySchema },
  responses: {
    200: {
      description: 'A page of invite requests',
      content: { 'application/json': { schema: paginatedSchema(adminInviteRequestSchema) } },
    },
    ...invalidRequest,
    ...adminOnly,
  },
});

const decisionRoute = createRoute({
  method: 'post',
  path: '/admin/invite-requests/{id}/decision',
  summary: 'Approve a pending request, which emails the invite link, or reject it',
  security: sessionSecurity,
  middleware: requireAdmin,
  request: {
    params: idParamSchema,
    body: { required: true, content: { 'application/json': { schema: decisionSchema } } },
  },
  responses: {
    200: { description: 'The decided request', content: adminInviteRequestContent },
    ...invalidRequest,
    ...adminOnly,
    ...notFound,
    ...conflict,
    ...emailFailed,
  },
});

const revokeRoute = createRoute({
  method: 'post',
  path: '/admin/invite-requests/{id}/revoke',
  summary: 'Revoke an approved invite so its link stops working',
  security: sessionSecurity,
  middleware: requireAdmin,
  request: { params: idParamSchema },
  responses: {
    200: { description: 'The revoked request', content: adminInviteRequestContent },
    ...invalidRequest,
    ...adminOnly,
    ...notFound,
    ...conflict,
  },
});

const inviteTokenParamSchema = z.object({ token: z.string().min(1).max(512) });

const previewRoute = createRoute({
  method: 'get',
  path: '/invites/{token}',
  summary: 'What an invite link is for: its fixed email, and whether it can still be accepted',
  request: { params: inviteTokenParamSchema },
  responses: {
    200: {
      description: 'The same answer, with no email, for any link that cannot be accepted',
      content: { 'application/json': { schema: invitePreviewSchema } },
    },
    ...invalidRequest,
  },
});

const acceptRoute = createRoute({
  method: 'post',
  path: '/invites/{token}/accept',
  summary: 'Sign up with an invite link. The email is the invited one, verified by the link',
  request: {
    params: inviteTokenParamSchema,
    body: { required: true, content: { 'application/json': { schema: acceptInviteSchema } } },
  },
  responses: {
    201: {
      description: 'The account was created',
      content: { 'application/json': { schema: accountSchema } },
    },
    ...invalidRequest,
    ...notFound,
    ...conflict,
  },
});

async function requesterUsernameOf(tx: Transaction, requesterId: string | null) {
  if (requesterId === null) return null;
  const [row] = await tx
    .select({ username: user.username, displayUsername: user.displayUsername })
    .from(user)
    .where(eq(user.id, requesterId));
  return row ? (row.displayUsername ?? row.username) : null;
}

export const inviteRoutes = createRouter()
  .openapi(createRequestRoute, async (c) => {
    const { db } = c.var.deps;
    const { email } = c.req.valid('json');
    const { id: requesterId, role } = c.var.currentUser;
    try {
      const created = await db.transaction(async (tx) => {
        await lockEmails(tx, email);
        await assertEmailUnused(tx, email);
        await assertNoOpenInvite(tx, email);
        const [row] = await tx
          .insert(inviteRequest)
          .values({ requesterId, inviteeEmail: email })
          .returning();
        if (!row) throw new Error('invite request was not created');
        return row;
      });
      return c.json(toInviteRequest(created), 201);
    } catch (error) {
      const refusal = isUniqueViolation(error, 'invite_request_one_pending_per_email')
        ? inviteOpen()
        : error;
      const aboutAddress =
        isAddressRefusal(refusal) ||
        (refusal instanceof ApiError && refusal.code === 'invite_already_open');
      if (aboutAddress && role !== 'admin') throw inviteRefused();
      throw refusal;
    }
  })
  .openapi(listMineRoute, async (c) => {
    const { db } = c.var.deps;
    const { cursor, limit } = c.req.valid('query');
    const page = keyset({
      sortColumn: inviteRequest.createdAt,
      idColumn: inviteRequest.id,
      direction: 'desc',
      cursor: cursor === undefined ? undefined : decodeCursor(cursor, z.coerce.date()),
    });
    const rows = await db
      .select()
      .from(inviteRequest)
      .where(and(eq(inviteRequest.requesterId, c.var.currentUser.id), page.where))
      .orderBy(...page.orderBy)
      .limit(limit + 1);
    const { items, nextCursor } = toPage(rows, limit, (row) => ({
      sort: row.createdAt,
      id: row.id,
    }));
    return c.json({ items: items.map(toInviteRequest), nextCursor }, 200);
  })
  .openapi(adminListRoute, async (c) => {
    const { db } = c.var.deps;
    const { cursor, limit, status } = c.req.valid('query');
    const page = keyset({
      sortColumn: inviteRequest.createdAt,
      idColumn: inviteRequest.id,
      direction: 'desc',
      cursor: cursor === undefined ? undefined : decodeCursor(cursor, z.coerce.date()),
    });
    const rows = await db
      .select({
        invite: inviteRequest,
        username: user.username,
        displayUsername: user.displayUsername,
      })
      .from(inviteRequest)
      .leftJoin(user, eq(inviteRequest.requesterId, user.id))
      .where(and(status === undefined ? undefined : eq(inviteRequest.status, status), page.where))
      .orderBy(...page.orderBy)
      .limit(limit + 1);
    const { items, nextCursor } = toPage(rows, limit, (row) => ({
      sort: row.invite.createdAt,
      id: row.invite.id,
    }));
    return c.json(
      {
        items: items.map((row) =>
          toAdminInviteRequest(row.invite, row.displayUsername ?? row.username),
        ),
        nextCursor,
      },
      200,
    );
  })
  .openapi(decisionRoute, async (c) => {
    const { db, mailer, publicBaseUrl } = c.var.deps;
    const { id } = c.req.valid('param');
    const { decision } = c.req.valid('json');
    const adminId = c.var.currentUser.id;

    const [found] = await db
      .select({ email: inviteRequest.inviteeEmail })
      .from(inviteRequest)
      .where(eq(inviteRequest.id, id));
    if (!found) throw inviteNotFound();

    const result = await db.transaction(async (tx) => {
      await lockEmails(tx, found.email);
      const [row] = await tx
        .select()
        .from(inviteRequest)
        .where(eq(inviteRequest.id, id))
        .for('update');
      if (!row) throw inviteNotFound();
      if (row.status !== 'pending') {
        throw new ApiError(409, 'invite_not_pending', 'This request has already been decided.');
      }

      let token: string | undefined;
      let values: Partial<typeof inviteRequest.$inferInsert>;
      if (decision === 'approve') {
        // The address may have been banned or registered since it was requested.
        await assertEmailUnused(tx, row.inviteeEmail);
        token = generateToken();
        values = {
          status: 'approved',
          decidedBy: adminId,
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + INVITE_LIFETIME_DAYS * 24 * 60 * 60 * 1000),
        };
      } else {
        values = { status: 'rejected', decidedBy: adminId };
      }
      const [updated] = await tx
        .update(inviteRequest)
        .set(values)
        .where(eq(inviteRequest.id, id))
        .returning();
      if (!updated) throw inviteNotFound();
      if (token !== undefined && updated.expiresAt) {
        await sendOrFail(
          mailer,
          inviteMail(publicBaseUrl, updated.inviteeEmail, token, updated.expiresAt),
        );
      }
      return toAdminInviteRequest(updated, await requesterUsernameOf(tx, updated.requesterId));
    });
    return c.json(result, 200);
  })
  .openapi(revokeRoute, async (c) => {
    const { db } = c.var.deps;
    const { id } = c.req.valid('param');
    const adminId = c.var.currentUser.id;

    const result = await db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(inviteRequest)
        .where(eq(inviteRequest.id, id))
        .for('update');
      if (!row) throw inviteNotFound();
      if (row.status !== 'approved') {
        throw new ApiError(409, 'invite_not_revocable', 'Only an approved invite can be revoked.');
      }
      const [updated] = await tx
        .update(inviteRequest)
        .set({ status: 'revoked', tokenHash: null, decidedBy: adminId })
        .where(eq(inviteRequest.id, id))
        .returning();
      if (!updated) throw inviteNotFound();
      return toAdminInviteRequest(updated, await requesterUsernameOf(tx, updated.requesterId));
    });
    return c.json(result, 200);
  })
  .openapi(previewRoute, async (c) => {
    const { db } = c.var.deps;
    const tokenHash = hashToken(c.req.valid('param').token);
    // Read-only. Same conditions as accepting, so `valid` tells the truth about the outcome.
    const [row] = await db
      .select({ email: inviteRequest.inviteeEmail })
      .from(inviteRequest)
      .where(
        and(
          eq(inviteRequest.tokenHash, tokenHash),
          eq(inviteRequest.status, 'approved'),
          sql`${inviteRequest.expiresAt} > now()`,
          sql`NOT EXISTS (SELECT 1 FROM ${emailBlacklist} WHERE lower(${emailBlacklist.email}) = lower(${inviteRequest.inviteeEmail}))`,
          sql`NOT EXISTS (SELECT 1 FROM ${user} WHERE lower(${user.email}) = lower(${inviteRequest.inviteeEmail}))`,
        ),
      );
    c.header('Cache-Control', 'no-store');
    return c.json({ valid: row !== undefined, email: row?.email ?? null }, 200);
  })
  .openapi(acceptRoute, async (c) => {
    const { db, auth } = c.var.deps;
    const { token } = c.req.valid('param');
    const { username, password } = c.req.valid('json');
    const tokenHash = hashToken(token);

    // Checked before the transaction so a bad link does not cost a password hash.
    const [found] = await db
      .select({ email: inviteRequest.inviteeEmail })
      .from(inviteRequest)
      .where(eq(inviteRequest.tokenHash, tokenHash));
    if (!found) throw inviteInvalid();
    const passwordHash = await hashPassword(auth, password);

    // A registered or banned address looks like any other dead link, except to an admin.
    let created;
    try {
      created = await refusingTakenUsername(() =>
        db.transaction(async (tx) => {
          await lockEmails(tx, found.email);
          const [row] = await tx
            .select({ id: inviteRequest.id })
            .from(inviteRequest)
            .where(
              and(
                eq(inviteRequest.tokenHash, tokenHash),
                eq(inviteRequest.status, 'approved'),
                sql`${inviteRequest.expiresAt} > now()`,
              ),
            )
            .for('update');
          if (!row) throw inviteInvalid();
          await assertEmailUnused(tx, found.email);

          const account = await insertAccount(tx, {
            username,
            email: found.email,
            passwordHash,
            role: 'member',
          });
          await tx
            .update(inviteRequest)
            .set({ status: 'accepted', tokenHash: null })
            .where(eq(inviteRequest.id, row.id));
          return account;
        }),
      );
    } catch (error) {
      if (isAddressRefusal(error) && !(await callerIsAdmin(auth, c.req.raw.headers))) {
        throw inviteInvalid();
      }
      throw error;
    }
    return c.json(toAccount(created), 201);
  });
