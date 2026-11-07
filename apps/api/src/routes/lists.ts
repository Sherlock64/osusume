import { createRoute } from '@hono/zod-openapi';
import {
  listEntrySchema,
  listQuerySchema,
  listSettingsSchema,
  listSlugParamSchema,
  memberListResponseSchema,
  ownListResponseSchema,
  publicListResponseSchema,
  putListEntrySchema,
  putListSettingsSchema,
  seasonIdParamSchema,
  textCursorSortSchema,
  usernameKey,
  usernameParamSchema,
} from '@osusume/shared';
import { and, eq, sql } from 'drizzle-orm';
import { createMiddleware } from 'hono/factory';
import { listEntry, listSettings } from '../db/schema.ts';
import type { AppEnv } from '../lib/context.ts';
import { ApiError, isForeignKeyViolation } from '../lib/errors.ts';
import { publicNoStore } from '../lib/http-cache.ts';
import { decodeCursor } from '../lib/pagination.ts';
import {
  createRouter,
  invalidRequest,
  notFound,
  sessionSecurity,
  unauthenticated,
} from '../lib/router.ts';
import { generateToken } from '../lib/tokens.ts';
import { requireSession } from '../middleware/auth.ts';
import {
  canView,
  listNotFound,
  loadListPage,
  loadListRefBySlug,
  loadListRefs,
  loadViewer,
} from '../social/lists.ts';

/** Keeps a public list out of search results, found or not. */
const noIndex = createMiddleware<AppEnv>(async (c, next) => {
  await next();
  c.res.headers.set('X-Robots-Tag', 'noindex');
});

const decodeListCursor = (cursor: string | undefined) =>
  cursor === undefined ? undefined : decodeCursor(cursor, textCursorSortSchema);

function toEntry(row: typeof listEntry.$inferSelect) {
  return {
    seasonId: row.seasonId,
    status: row.status,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const getListRoute = createRoute({
  method: 'get',
  path: '/me/list',
  summary: "The current user's list, one item per series by title, with notes",
  security: sessionSecurity,
  middleware: requireSession,
  request: { query: listQuerySchema },
  responses: {
    200: {
      description: 'A page of series',
      content: { 'application/json': { schema: ownListResponseSchema } },
    },
    ...invalidRequest,
    ...unauthenticated,
  },
});

const putEntryRoute = createRoute({
  method: 'put',
  path: '/me/list/{seasonId}',
  summary: 'Add a season to the list or change its entry',
  security: sessionSecurity,
  middleware: requireSession,
  request: {
    params: seasonIdParamSchema,
    body: { required: true, content: { 'application/json': { schema: putListEntrySchema } } },
  },
  responses: {
    200: {
      description: 'The entry',
      content: { 'application/json': { schema: listEntrySchema } },
    },
    ...invalidRequest,
    ...unauthenticated,
    ...notFound,
  },
});

const deleteEntryRoute = createRoute({
  method: 'delete',
  path: '/me/list/{seasonId}',
  summary: 'Take a season off the list',
  security: sessionSecurity,
  middleware: requireSession,
  request: { params: seasonIdParamSchema },
  responses: {
    204: { description: 'Taken off the list' },
    ...invalidRequest,
    ...unauthenticated,
    ...notFound,
  },
});

const getSettingsRoute = createRoute({
  method: 'get',
  path: '/me/list-settings',
  summary: "Who can see the current user's list",
  security: sessionSecurity,
  middleware: requireSession,
  responses: {
    200: {
      description: 'The settings',
      content: { 'application/json': { schema: listSettingsSchema } },
    },
    ...unauthenticated,
  },
});

const putSettingsRoute = createRoute({
  method: 'put',
  path: '/me/list-settings',
  summary: 'Choose who can see the list. The public slug exists only while public',
  security: sessionSecurity,
  middleware: requireSession,
  request: {
    body: { required: true, content: { 'application/json': { schema: putListSettingsSchema } } },
  },
  responses: {
    200: {
      description: 'The settings',
      content: { 'application/json': { schema: listSettingsSchema } },
    },
    ...invalidRequest,
    ...unauthenticated,
  },
});

const memberListRoute = createRoute({
  method: 'get',
  path: '/users/{username}/list',
  summary: "A member's list, without notes. Not found if missing, disabled or not visible",
  security: sessionSecurity,
  middleware: requireSession,
  request: { params: usernameParamSchema, query: listQuerySchema },
  responses: {
    200: {
      description: 'A page of series',
      content: { 'application/json': { schema: memberListResponseSchema } },
    },
    ...invalidRequest,
    ...unauthenticated,
    ...notFound,
  },
});

const publicListRoute = createRoute({
  method: 'get',
  path: '/lists/{slug}',
  summary: 'A public list, titles and status only. Needs no login',
  middleware: [publicNoStore, noIndex] as const,
  request: { params: listSlugParamSchema, query: listQuerySchema },
  responses: {
    200: {
      description: 'A page of series',
      content: { 'application/json': { schema: publicListResponseSchema } },
    },
    ...invalidRequest,
    ...notFound,
  },
});

export const listRoutes = createRouter()
  .openapi(getListRoute, async (c) => {
    const { cursor, limit, status } = c.req.valid('query');
    const { items, nextCursor } = await loadListPage(c.var.deps.db, c.var.currentUser.id, {
      cursor: decodeListCursor(cursor),
      limit,
      status,
    });
    return c.json(
      {
        items: items.map((item) => ({
          seriesId: item.seriesId,
          title: item.title,
          seriesStatus: item.seriesStatus,
          seasons: item.seasons.map(({ entry, season, matched }) => ({
            seasonId: season.id,
            title: season.title,
            ordinal: season.ordinal,
            year: season.year,
            seasonOfYear: season.seasonOfYear,
            status: entry.status,
            matched,
            note: entry.note,
            createdAt: entry.createdAt.toISOString(),
            updatedAt: entry.updatedAt.toISOString(),
          })),
        })),
        nextCursor,
      },
      200,
    );
  })
  .openapi(putEntryRoute, async (c) => {
    const { seasonId } = c.req.valid('param');
    const { status, note } = c.req.valid('json');
    const noteValue = note === '' ? null : note;
    try {
      const [row] = await c.var.deps.db
        .insert(listEntry)
        .values({ userId: c.var.currentUser.id, seasonId, status, note: noteValue ?? null })
        .onConflictDoUpdate({
          target: [listEntry.userId, listEntry.seasonId],
          set: {
            status,
            ...(noteValue === undefined ? {} : { note: noteValue }),
            updatedAt: new Date(),
          },
        })
        .returning();
      if (!row) throw new Error('list entry was not saved');
      return c.json(toEntry(row), 200);
    } catch (error) {
      if (isForeignKeyViolation(error, 'list_entry_season_id_season_id_fk')) {
        throw new ApiError(404, 'season_not_found', 'No such season.');
      }
      throw error;
    }
  })
  .openapi(deleteEntryRoute, async (c) => {
    const { seasonId } = c.req.valid('param');
    const deleted = await c.var.deps.db
      .delete(listEntry)
      .where(and(eq(listEntry.userId, c.var.currentUser.id), eq(listEntry.seasonId, seasonId)))
      .returning({ id: listEntry.id });
    if (deleted.length === 0) {
      throw new ApiError(404, 'list_entry_not_found', 'This season is not on your list.');
    }
    return c.body(null, 204);
  })
  .openapi(getSettingsRoute, async (c) => {
    // The row is created by the first PUT. Until then the list has the default, private.
    const [row] = await c.var.deps.db
      .select({ visibility: listSettings.visibility, publicSlug: listSettings.publicSlug })
      .from(listSettings)
      .where(eq(listSettings.userId, c.var.currentUser.id));
    return c.json(row ?? { visibility: 'private' as const, publicSlug: null }, 200);
  })
  .openapi(putSettingsRoute, async (c) => {
    const { visibility } = c.req.valid('json');
    // In one statement, so that two concurrent changes cannot break the slug rule. A list that
    // stays public keeps its slug; one going public gets a new one, so old links stay dead.
    const [row] = await c.var.deps.db
      .insert(listSettings)
      .values({
        userId: c.var.currentUser.id,
        visibility,
        publicSlug: visibility === 'public' ? generateToken() : null,
      })
      .onConflictDoUpdate({
        target: listSettings.userId,
        set: {
          visibility,
          publicSlug:
            visibility === 'public'
              ? sql`coalesce(${listSettings.publicSlug}, excluded.public_slug)`
              : null,
          updatedAt: new Date(),
        },
      })
      .returning({ visibility: listSettings.visibility, publicSlug: listSettings.publicSlug });
    if (!row) throw new Error('list settings were not saved');
    return c.json(row, 200);
  })
  .openapi(memberListRoute, async (c) => {
    const { db } = c.var.deps;
    const { username } = c.req.valid('param');
    const { cursor, limit, status } = c.req.valid('query');
    const decoded = decodeListCursor(cursor);
    const list = (await loadListRefs(db, [username])).get(usernameKey(username));
    const viewer = await loadViewer(db, c.var.currentUser.id, list ? [list.ownerId] : []);
    if (!list || !canView(viewer, list)) throw listNotFound();

    const { items, nextCursor } = await loadListPage(db, list.ownerId, {
      cursor: decoded,
      limit,
      status,
    });
    return c.json(
      {
        items: items.map((item) => ({
          seriesId: item.seriesId,
          title: item.title,
          seriesStatus: item.seriesStatus,
          seasons: item.seasons.map(({ entry, season, matched }) => ({
            seasonId: season.id,
            title: season.title,
            ordinal: season.ordinal,
            year: season.year,
            seasonOfYear: season.seasonOfYear,
            status: entry.status,
            matched,
          })),
        })),
        nextCursor,
      },
      200,
    );
  })
  .openapi(publicListRoute, async (c) => {
    const { db } = c.var.deps;
    const { slug } = c.req.valid('param');
    const { cursor, limit, status } = c.req.valid('query');
    const decoded = decodeListCursor(cursor);
    const list = await loadListRefBySlug(db, slug);
    // Anyone with the link sees the same thing, so a session plays no part here.
    if (!list || !canView(null, list)) throw listNotFound();

    const { items, nextCursor } = await loadListPage(db, list.ownerId, {
      cursor: decoded,
      limit,
      status,
    });
    return c.json(
      {
        items: items.map((item) => ({
          title: item.title,
          seriesStatus: item.seriesStatus,
          seasons: item.seasons.map(({ entry, season, matched }) => ({
            title: season.title,
            status: entry.status,
            matched,
          })),
        })),
        nextCursor,
      },
      200,
    );
  });
