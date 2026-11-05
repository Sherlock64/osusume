import { createRoute, z } from '@hono/zod-openapi';
import { adminUserSchema, idParamSchema, paginatedSchema, paginationQuerySchema } from '@osusume/shared';
import { eq } from 'drizzle-orm';
import {
  clearSessionCookie,
  deletePasswordResetTokens,
  firstAdminProtected,
  removeUser,
  toAccount,
} from '../auth/accounts.ts';
import type { Database, Transaction } from '../db/client.ts';
import { emailChangeRequest, session, user } from '../db/schema.ts';
import { ApiError } from '../lib/errors.ts';
import { decodeCursor, keyset, toPage } from '../lib/pagination.ts';
import {
  adminOnly,
  createRouter,
  invalidRequest,
  notFound,
  sessionSecurity,
} from '../lib/router.ts';
import { requireAdmin } from '../middleware/auth.ts';

function toAdminUser(row: typeof user.$inferSelect) {
  return {
    ...toAccount(row),
    isFirstAdmin: row.isFirstAdmin,
    disabledAt: row.disabledAt?.toISOString() ?? null,
  };
}

const userNotFound = () => new ApiError(404, 'user_not_found', 'No such user.');

async function changeUser(
  db: Database,
  userId: string,
  apply: (tx: Transaction, target: typeof user.$inferSelect) => Promise<typeof user.$inferSelect>,
) {
  const row = await db.transaction(async (tx) => {
    const [target] = await tx.select().from(user).where(eq(user.id, userId)).for('update');
    if (!target) throw userNotFound();
    if (target.isFirstAdmin) throw firstAdminProtected();
    return apply(tx, target);
  });
  return toAdminUser(row);
}

async function setFields(
  tx: Transaction,
  userId: string,
  values: Partial<typeof user.$inferInsert>,
) {
  const [row] = await tx.update(user).set(values).where(eq(user.id, userId)).returning();
  if (!row) throw userNotFound();
  return row;
}

function actionRoute(action: string, summary: string) {
  return createRoute({
    method: 'post',
    path: `/admin/users/{id}/${action}`,
    summary,
    security: sessionSecurity,
    middleware: requireAdmin,
    request: { params: idParamSchema },
    responses: {
      200: {
        description: 'The updated user',
        content: { 'application/json': { schema: adminUserSchema } },
      },
      ...invalidRequest,
      ...adminOnly,
      ...notFound,
    },
  });
}

function removalRoute(action: string, summary: string) {
  return createRoute({
    method: 'post',
    path: `/admin/users/{id}/${action}`,
    summary,
    security: sessionSecurity,
    middleware: requireAdmin,
    request: { params: idParamSchema },
    responses: {
      204: { description: 'The account was deleted' },
      ...invalidRequest,
      ...adminOnly,
      ...notFound,
    },
  });
}

const listRoute = createRoute({
  method: 'get',
  path: '/admin/users',
  summary: 'All accounts, oldest first',
  security: sessionSecurity,
  middleware: requireAdmin,
  request: { query: paginationQuerySchema },
  responses: {
    200: {
      description: 'A page of users',
      content: { 'application/json': { schema: paginatedSchema(adminUserSchema) } },
    },
    ...invalidRequest,
    ...adminOnly,
  },
});

export const adminUserRoutes = createRouter()
  .openapi(listRoute, async (c) => {
    const { cursor, limit } = c.req.valid('query');
    const page = keyset({
      sortColumn: user.createdAt,
      idColumn: user.id,
      cursor: cursor === undefined ? undefined : decodeCursor(cursor, z.coerce.date()),
    });
    const rows = await c.var.deps.db
      .select()
      .from(user)
      .where(page.where)
      .orderBy(...page.orderBy)
      .limit(limit + 1);
    const { items, nextCursor } = toPage(rows, limit, (row) => ({
      sort: row.createdAt,
      id: row.id,
    }));
    return c.json({ items: items.map(toAdminUser), nextCursor }, 200);
  })
  .openapi(actionRoute('promote', 'Make a user an admin'), async (c) => {
    const { id } = c.req.valid('param');
    const updated = await changeUser(c.var.deps.db, id, (tx, target) =>
      setFields(tx, target.id, { role: 'admin' }),
    );
    return c.json(updated, 200);
  })
  .openapi(actionRoute('demote', 'Make an admin a member'), async (c) => {
    const { id } = c.req.valid('param');
    const updated = await changeUser(c.var.deps.db, id, (tx, target) =>
      setFields(tx, target.id, { role: 'member' }),
    );
    return c.json(updated, 200);
  })
  .openapi(
    actionRoute('disable', 'Disable a user: signed out immediately and unable to log in'),
    async (c) => {
      const { id } = c.req.valid('param');
      const updated = await changeUser(c.var.deps.db, id, async (tx, target) => {
        const row = await setFields(tx, target.id, { disabledAt: target.disabledAt ?? new Date() });
        await tx.delete(session).where(eq(session.userId, target.id));
        // Nothing outstanding may act for the account while it is disabled.
        await deletePasswordResetTokens(tx, target.id);
        await tx.delete(emailChangeRequest).where(eq(emailChangeRequest.userId, target.id));
        return row;
      });
      if (id === c.var.currentUser.id) await clearSessionCookie(c, c.var.deps.auth);
      return c.json(updated, 200);
    },
  )
  .openapi(actionRoute('enable', 'Reverse a disable'), async (c) => {
    const { id } = c.req.valid('param');
    const updated = await changeUser(c.var.deps.db, id, (tx, target) =>
      setFields(tx, target.id, { disabledAt: null }),
    );
    return c.json(updated, 200);
  })
  .openapi(removalRoute('remove', 'Remove a user permanently. The email can be invited again'), async (c) => {
    const { id } = c.req.valid('param');
    await removeUser(c.var.deps.db, id);
    if (id === c.var.currentUser.id) await clearSessionCookie(c, c.var.deps.auth);
    return c.body(null, 204);
  })
  .openapi(removalRoute('ban', 'Remove a user and blacklist their current email'), async (c) => {
    const { id } = c.req.valid('param');
    await removeUser(c.var.deps.db, id, { bannedBy: c.var.currentUser.id });
    if (id === c.var.currentUser.id) await clearSessionCookie(c, c.var.deps.auth);
    return c.body(null, 204);
  });
