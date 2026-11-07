import { idParamSchema, paginationQuerySchema } from '@osusume/shared';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
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
import { createRouter, valid } from '../lib/router.ts';
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

export const adminUserRoutes = createRouter()
  // All accounts, oldest first
  .get('/admin/users', requireAdmin, valid('query', paginationQuerySchema), async (c) => {
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
  // Make a user an admin
  .post('/admin/users/:id/promote', requireAdmin, valid('param', idParamSchema), async (c) => {
    const { id } = c.req.valid('param');
    const updated = await changeUser(c.var.deps.db, id, (tx, target) =>
      setFields(tx, target.id, { role: 'admin' }),
    );
    return c.json(updated, 200);
  })
  // Make an admin a member
  .post('/admin/users/:id/demote', requireAdmin, valid('param', idParamSchema), async (c) => {
    const { id } = c.req.valid('param');
    const updated = await changeUser(c.var.deps.db, id, (tx, target) =>
      setFields(tx, target.id, { role: 'member' }),
    );
    return c.json(updated, 200);
  })
  // Disable a user: signed out immediately and unable to log in
  .post('/admin/users/:id/disable', requireAdmin, valid('param', idParamSchema), async (c) => {
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
  })
  // Reverse a disable
  .post('/admin/users/:id/enable', requireAdmin, valid('param', idParamSchema), async (c) => {
    const { id } = c.req.valid('param');
    const updated = await changeUser(c.var.deps.db, id, (tx, target) =>
      setFields(tx, target.id, { disabledAt: null }),
    );
    return c.json(updated, 200);
  })
  // Remove a user permanently. The email can be invited again
  .post('/admin/users/:id/remove', requireAdmin, valid('param', idParamSchema), async (c) => {
    const { id } = c.req.valid('param');
    await removeUser(c.var.deps.db, id);
    if (id === c.var.currentUser.id) await clearSessionCookie(c, c.var.deps.auth);
    return c.body(null, 204);
  })
  // Remove a user and blacklist their current email
  .post('/admin/users/:id/ban', requireAdmin, valid('param', idParamSchema), async (c) => {
    const { id } = c.req.valid('param');
    await removeUser(c.var.deps.db, id, { bannedBy: c.var.currentUser.id });
    if (id === c.var.currentUser.id) await clearSessionCookie(c, c.var.deps.auth);
    return c.body(null, 204);
  });
