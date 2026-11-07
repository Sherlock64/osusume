import {
  adminUsernameChangeRequestListQuerySchema,
  createUsernameChangeRequestSchema,
  decisionSchema,
  idParamSchema,
  usernameChangeRequestListQuerySchema,
  usernameKey,
} from '@osusume/shared';
import { and, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import { displayName, refusingTakenUsername, usernameTaken } from '../auth/accounts.ts';
import { user, usernameChangeRequest } from '../db/schema.ts';
import { ApiError, isUniqueViolation } from '../lib/errors.ts';
import { decodeCursor, keyset, toPage } from '../lib/pagination.ts';
import { createRouter, valid } from '../lib/router.ts';
import { requireAdmin, requireSession } from '../middleware/auth.ts';

function toRequest(row: typeof usernameChangeRequest.$inferSelect) {
  return {
    id: row.id,
    requestedUsername: row.requestedUsername,
    status: row.status,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function toAdminRequest(row: typeof usernameChangeRequest.$inferSelect, currentUsername: string) {
  return { ...toRequest(row), userId: row.userId, currentUsername, decidedBy: row.decidedBy };
}

const requestNotFound = () =>
  new ApiError(404, 'username_change_not_found', 'No such username change request.');

export const usernameChangeRoutes = createRouter()
  // Request a username change. One pending request per user
  .post(
    '/username-change-requests',
    requireSession,
    valid('json', createUsernameChangeRequestSchema),
    async (c) => {
      const { db } = c.var.deps;
      const { username } = c.req.valid('json');
      try {
        const [row] = await db
          .insert(usernameChangeRequest)
          .values({ userId: c.var.currentUser.id, requestedUsername: username })
          .returning();
        if (!row) throw new Error('username change request was not created');
        return c.json(toRequest(row), 201);
      } catch (error) {
        if (isUniqueViolation(error, 'username_change_request_one_pending_per_user')) {
          throw new ApiError(
            409,
            'username_change_already_pending',
            'You already have a pending username change request.',
          );
        }
        throw error;
      }
    },
  )
  // The username change requests the current user made, newest first
  .get(
    '/username-change-requests',
    requireSession,
    valid('query', usernameChangeRequestListQuerySchema),
    async (c) => {
      const { db } = c.var.deps;
      const { cursor, limit } = c.req.valid('query');
      const page = keyset({
        sortColumn: usernameChangeRequest.createdAt,
        idColumn: usernameChangeRequest.id,
        direction: 'desc',
        cursor: cursor === undefined ? undefined : decodeCursor(cursor, z.coerce.date()),
      });
      const rows = await db
        .select()
        .from(usernameChangeRequest)
        .where(and(eq(usernameChangeRequest.userId, c.var.currentUser.id), page.where))
        .orderBy(...page.orderBy)
        .limit(limit + 1);
      const { items, nextCursor } = toPage(rows, limit, (row) => ({
        sort: row.createdAt,
        id: row.id,
      }));
      return c.json({ items: items.map(toRequest), nextCursor }, 200);
    },
  )
  // All username change requests, newest first
  .get(
    '/admin/username-change-requests',
    requireAdmin,
    valid('query', adminUsernameChangeRequestListQuerySchema),
    async (c) => {
      const { db } = c.var.deps;
      const { cursor, limit, status } = c.req.valid('query');
      const page = keyset({
        sortColumn: usernameChangeRequest.createdAt,
        idColumn: usernameChangeRequest.id,
        direction: 'desc',
        cursor: cursor === undefined ? undefined : decodeCursor(cursor, z.coerce.date()),
      });
      const rows = await db
        .select({
          request: usernameChangeRequest,
          username: user.username,
          displayUsername: user.displayUsername,
        })
        .from(usernameChangeRequest)
        .innerJoin(user, eq(usernameChangeRequest.userId, user.id))
        .where(
          and(status === undefined ? undefined : eq(usernameChangeRequest.status, status), page.where),
        )
        .orderBy(...page.orderBy)
        .limit(limit + 1);
      const { items, nextCursor } = toPage(rows, limit, (row) => ({
        sort: row.request.createdAt,
        id: row.request.id,
      }));
      return c.json(
        { items: items.map((row) => toAdminRequest(row.request, displayName(row))), nextCursor },
        200,
      );
    },
  )
  // Approve or reject a pending request. The username must be available to approve
  .post(
    '/admin/username-change-requests/:id/decision',
    requireAdmin,
    valid('param', idParamSchema),
    valid('json', decisionSchema),
    async (c) => {
      const { db } = c.var.deps;
      const { id } = c.req.valid('param');
      const { decision } = c.req.valid('json');
      const adminId = c.var.currentUser.id;

      const result = await refusingTakenUsername(() =>
        db.transaction(async (tx) => {
          const [request] = await tx
            .select()
            .from(usernameChangeRequest)
            .where(eq(usernameChangeRequest.id, id))
            .for('update');
          if (!request) throw requestNotFound();
          if (request.status !== 'pending') {
            throw new ApiError(
              409,
              'username_change_not_pending',
              'This request has already been decided.',
            );
          }

          if (decision === 'approve') {
            const key = usernameKey(request.requestedUsername);
            // A case-only change keeps the user's own key, so only other users count here.
            // The unique constraint settles a race between two approvals.
            const [taken] = await tx
              .select({ id: user.id })
              .from(user)
              .where(and(eq(user.username, key), ne(user.id, request.userId)));
            if (taken) throw usernameTaken();
            await tx
              .update(user)
              .set({
                username: key,
                displayUsername: request.requestedUsername,
                name: request.requestedUsername,
              })
              .where(eq(user.id, request.userId));
          }

          const [updated] = await tx
            .update(usernameChangeRequest)
            .set({
              status: decision === 'approve' ? 'approved' : 'rejected',
              decidedBy: adminId,
              decidedAt: new Date(),
            })
            .where(eq(usernameChangeRequest.id, id))
            .returning();
          if (!updated) throw requestNotFound();
          const [owner] = await tx
            .select({ username: user.username, displayUsername: user.displayUsername })
            .from(user)
            .where(eq(user.id, updated.userId));
          if (!owner) throw requestNotFound();
          return toAdminRequest(updated, displayName(owner));
        }),
      );
      return c.json(result, 200);
    },
  );
