import { createRoute } from '@hono/zod-openapi';
import {
  type FriendRelation,
  createFriendRequestSchema,
  friendEntrySchema,
  friendListQuerySchema,
  idParamSchema,
  paginatedSchema,
  textCursorSortSchema,
  usernameKey,
} from '@osusume/shared';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { displayName } from '../auth/accounts.ts';
import type { Database } from '../db/client.ts';
import { friendship, user } from '../db/schema.ts';
import { ApiError, isUniqueViolation } from '../lib/errors.ts';
import { decodeCursor, keyset, toPage } from '../lib/pagination.ts';
import {
  conflict,
  createRouter,
  invalidRequest,
  notFound,
  sessionSecurity,
  unauthenticated,
} from '../lib/router.ts';
import { requireSession } from '../middleware/auth.ts';

type FriendshipRow = typeof friendship.$inferSelect;

function relationOf(row: FriendshipRow, viewerId: string): FriendRelation {
  if (row.status === 'accepted') return 'friend';
  return row.requesterId === viewerId ? 'outgoing' : 'incoming';
}

function toEntry(row: FriendshipRow, viewerId: string, username: string) {
  return {
    id: row.id,
    relation: relationOf(row, viewerId),
    username,
    createdAt: row.createdAt.toISOString(),
  };
}

const requestNotFound = () =>
  new ApiError(404, 'friend_request_not_found', 'No such pending friend request.');

/** Why a pair that already has a row cannot get another. */
function pairConflict(existing: FriendshipRow | undefined, viewerId: string): ApiError {
  if (existing?.status === 'accepted') {
    return new ApiError(409, 'already_friends', 'You are already friends.');
  }
  if (existing?.addresseeId === viewerId) {
    return new ApiError(
      409,
      'friend_request_incoming',
      'This member already sent you a friend request. Accept it instead.',
    );
  }
  return new ApiError(409, 'friend_request_already_sent', 'You already sent this request.');
}

async function loadPair(db: Database, a: string, b: string) {
  const [row] = await db
    .select()
    .from(friendship)
    .where(
      or(
        and(eq(friendship.requesterId, a), eq(friendship.addresseeId, b)),
        and(eq(friendship.requesterId, b), eq(friendship.addresseeId, a)),
      ),
    );
  return row;
}

const listRoute = createRoute({
  method: 'get',
  path: '/friends',
  summary: 'Accepted friends and pending requests either way, by username',
  security: sessionSecurity,
  middleware: requireSession,
  request: { query: friendListQuerySchema },
  responses: {
    200: {
      description: 'A page of friends and requests',
      content: { 'application/json': { schema: paginatedSchema(friendEntrySchema) } },
    },
    ...invalidRequest,
    ...unauthenticated,
  },
});

const createRequestRoute = createRoute({
  method: 'post',
  path: '/friends/requests',
  summary: 'Send a friend request to an exact username, ignoring case',
  security: sessionSecurity,
  middleware: requireSession,
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: createFriendRequestSchema } },
    },
  },
  responses: {
    201: {
      description: 'The request is waiting for the other member',
      content: { 'application/json': { schema: friendEntrySchema } },
    },
    ...invalidRequest,
    ...unauthenticated,
    ...notFound,
    ...conflict,
  },
});

const acceptRoute = createRoute({
  method: 'post',
  path: '/friends/requests/{id}/accept',
  summary: 'Accept a pending request sent to the current user',
  security: sessionSecurity,
  middleware: requireSession,
  request: { params: idParamSchema },
  responses: {
    200: {
      description: 'The new friend',
      content: { 'application/json': { schema: friendEntrySchema } },
    },
    ...invalidRequest,
    ...unauthenticated,
    ...notFound,
  },
});

const declineRoute = createRoute({
  method: 'post',
  path: '/friends/requests/{id}/decline',
  summary: 'Decline a pending request sent to the current user. The sender may ask again',
  security: sessionSecurity,
  middleware: requireSession,
  request: { params: idParamSchema },
  responses: {
    204: { description: 'Declined' },
    ...invalidRequest,
    ...unauthenticated,
    ...notFound,
  },
});

const cancelRoute = createRoute({
  method: 'delete',
  path: '/friends/requests/{id}',
  summary: 'Cancel a pending request the current user sent',
  security: sessionSecurity,
  middleware: requireSession,
  request: { params: idParamSchema },
  responses: {
    204: { description: 'Cancelled' },
    ...invalidRequest,
    ...unauthenticated,
    ...notFound,
  },
});

const unfriendRoute = createRoute({
  method: 'delete',
  path: '/friends/{id}',
  summary: 'End a friendship, from either side',
  security: sessionSecurity,
  middleware: requireSession,
  request: { params: idParamSchema },
  responses: {
    204: { description: 'No longer friends' },
    ...invalidRequest,
    ...unauthenticated,
    ...notFound,
  },
});

export const friendRoutes = createRouter()
  .openapi(listRoute, async (c) => {
    const { db } = c.var.deps;
    const viewerId = c.var.currentUser.id;
    const { cursor, limit, relation } = c.req.valid('query');
    const page = keyset({
      sortColumn: user.username,
      idColumn: friendship.id,
      cursor: cursor === undefined ? undefined : decodeCursor(cursor, textCursorSortSchema),
    });
    const relationFilter = {
      friend: eq(friendship.status, 'accepted'),
      incoming: and(eq(friendship.status, 'pending'), eq(friendship.addresseeId, viewerId)),
      outgoing: and(eq(friendship.status, 'pending'), eq(friendship.requesterId, viewerId)),
    };
    const rows = await db
      .select({
        friendship,
        username: user.username,
        displayUsername: user.displayUsername,
      })
      .from(friendship)
      .innerJoin(
        user,
        sql`${user.id} = CASE WHEN ${friendship.requesterId} = ${viewerId} THEN ${friendship.addresseeId} ELSE ${friendship.requesterId} END`,
      )
      .where(
        and(
          or(eq(friendship.requesterId, viewerId), eq(friendship.addresseeId, viewerId)),
          relation === undefined ? undefined : relationFilter[relation],
          page.where,
        ),
      )
      .orderBy(...page.orderBy)
      .limit(limit + 1);
    const { items, nextCursor } = toPage(rows, limit, (row) => ({
      sort: row.username,
      id: row.friendship.id,
    }));
    return c.json(
      {
        items: items.map((row) => toEntry(row.friendship, viewerId, displayName(row))),
        nextCursor,
      },
      200,
    );
  })
  .openapi(createRequestRoute, async (c) => {
    const { db } = c.var.deps;
    const viewerId = c.var.currentUser.id;
    const { username } = c.req.valid('json');
    const [target] = await db
      .select({ id: user.id, username: user.username, displayUsername: user.displayUsername })
      .from(user)
      .where(and(eq(user.username, usernameKey(username)), isNull(user.disabledAt)));
    if (!target) throw new ApiError(404, 'user_not_found', 'No member has this username.');
    if (target.id === viewerId) {
      throw new ApiError(400, 'friend_request_self', 'You cannot send yourself a friend request.');
    }
    try {
      const [row] = await db
        .insert(friendship)
        .values({ requesterId: viewerId, addresseeId: target.id })
        .returning();
      if (!row) throw new Error('friend request was not created');
      return c.json(toEntry(row, viewerId, displayName(target)), 201);
    } catch (error) {
      if (isUniqueViolation(error, 'friendship_pair_unique')) {
        throw pairConflict(await loadPair(db, viewerId, target.id), viewerId);
      }
      throw error;
    }
  })
  .openapi(acceptRoute, async (c) => {
    const { db } = c.var.deps;
    const viewerId = c.var.currentUser.id;
    const { id } = c.req.valid('param');
    const [row] = await db
      .update(friendship)
      .set({ status: 'accepted' })
      .where(
        and(
          eq(friendship.id, id),
          eq(friendship.addresseeId, viewerId),
          eq(friendship.status, 'pending'),
        ),
      )
      .returning();
    if (!row) throw requestNotFound();
    const [requester] = await db
      .select({ username: user.username, displayUsername: user.displayUsername })
      .from(user)
      .where(eq(user.id, row.requesterId));
    if (!requester) throw requestNotFound();
    return c.json(toEntry(row, viewerId, displayName(requester)), 200);
  })
  .openapi(declineRoute, async (c) => {
    const { id } = c.req.valid('param');
    const deleted = await c.var.deps.db
      .delete(friendship)
      .where(
        and(
          eq(friendship.id, id),
          eq(friendship.addresseeId, c.var.currentUser.id),
          eq(friendship.status, 'pending'),
        ),
      )
      .returning({ id: friendship.id });
    if (deleted.length === 0) throw requestNotFound();
    return c.body(null, 204);
  })
  .openapi(cancelRoute, async (c) => {
    const { id } = c.req.valid('param');
    const deleted = await c.var.deps.db
      .delete(friendship)
      .where(
        and(
          eq(friendship.id, id),
          eq(friendship.requesterId, c.var.currentUser.id),
          eq(friendship.status, 'pending'),
        ),
      )
      .returning({ id: friendship.id });
    if (deleted.length === 0) throw requestNotFound();
    return c.body(null, 204);
  })
  .openapi(unfriendRoute, async (c) => {
    const viewerId = c.var.currentUser.id;
    const { id } = c.req.valid('param');
    const deleted = await c.var.deps.db
      .delete(friendship)
      .where(
        and(
          eq(friendship.id, id),
          eq(friendship.status, 'accepted'),
          or(eq(friendship.requesterId, viewerId), eq(friendship.addresseeId, viewerId)),
        ),
      )
      .returning({ id: friendship.id });
    if (deleted.length === 0) {
      throw new ApiError(404, 'friend_not_found', 'You are not friends with this member.');
    }
    return c.body(null, 204);
  });
