import {
  listQuerySchema,
  listSlugParamSchema,
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
import { ApiError, isForeignKeyViolation, one } from '../lib/errors.ts';
import { publicNoStore } from '../lib/http-cache.ts';
import { decodeCursor } from '../lib/pagination.ts';
import { createRouter, valid } from '../lib/router.ts';
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

type ListedSeason = Awaited<ReturnType<typeof loadListPage>>['items'][number]['seasons'][number];

function toMemberSeason({ entry, season, matched }: ListedSeason) {
  return {
    seasonId: season.id,
    title: season.title,
    ordinal: season.ordinal,
    year: season.year,
    seasonOfYear: season.seasonOfYear,
    status: entry.status,
    matched,
  };
}

export const listRoutes = createRouter()
  // The current user's list, one item per series by title, with notes
  .get('/me/list', requireSession, valid('query', listQuerySchema), async (c) => {
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
          cover: item.cover,
          seriesStatus: item.seriesStatus,
          seasons: item.seasons.map((listed) => ({
            ...toMemberSeason(listed),
            note: listed.entry.note,
            createdAt: listed.entry.createdAt.toISOString(),
            updatedAt: listed.entry.updatedAt.toISOString(),
          })),
        })),
        nextCursor,
      },
      200,
    );
  })
  // Add a season to the list or change its entry
  .put(
    '/me/list/:seasonId',
    requireSession,
    valid('param', seasonIdParamSchema),
    valid('json', putListEntrySchema),
    async (c) => {
      const { seasonId } = c.req.valid('param');
      const { status, note } = c.req.valid('json');
      const noteValue = note === '' ? null : note;
      try {
        const row = await c.var.deps.db
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
          .returning()
          .then(one);
        return c.json(toEntry(row), 200);
      } catch (error) {
        if (isForeignKeyViolation(error, 'list_entry_season_id_season_id_fk')) {
          throw new ApiError(404, 'season_not_found', 'No such season.');
        }
        throw error;
      }
    },
  )
  // Take a season off the list
  .delete('/me/list/:seasonId', requireSession, valid('param', seasonIdParamSchema), async (c) => {
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
  // Who can see the current user's list
  .get('/me/list-settings', requireSession, async (c) => {
    // The row is created by the first PUT. Until then the list has the default, private.
    const [row] = await c.var.deps.db
      .select({ visibility: listSettings.visibility, publicSlug: listSettings.publicSlug })
      .from(listSettings)
      .where(eq(listSettings.userId, c.var.currentUser.id));
    return c.json(row ?? { visibility: 'private' as const, publicSlug: null }, 200);
  })
  // Choose who can see the list. The public slug exists only while public
  .put('/me/list-settings', requireSession, valid('json', putListSettingsSchema), async (c) => {
    const { visibility } = c.req.valid('json');
    // In one statement, so that two concurrent changes cannot break the slug rule. A list that
    // stays public keeps its slug; one going public gets a new one, so old links stay dead.
    const row = await c.var.deps.db
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
      .returning({ visibility: listSettings.visibility, publicSlug: listSettings.publicSlug })
      .then(one);
    return c.json(row, 200);
  })
  // A member's list, without notes. Not found if missing, disabled or not visible
  .get(
    '/users/:username/list',
    requireSession,
    valid('param', usernameParamSchema),
    valid('query', listQuerySchema),
    async (c) => {
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
            cover: item.cover,
            seriesStatus: item.seriesStatus,
            seasons: item.seasons.map(toMemberSeason),
          })),
          nextCursor,
        },
        200,
      );
    },
  )
  // A public list: titles, covers and status, without notes. Needs no login
  .get(
    '/lists/:slug',
    publicNoStore,
    noIndex,
    valid('param', listSlugParamSchema),
    valid('query', listQuerySchema),
    async (c) => {
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
            cover: item.cover,
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
    },
  );
