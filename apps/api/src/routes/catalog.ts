import { createRoute, z } from '@hono/zod-openapi';
import {
  catalogProposalSchema,
  createSeasonSchema,
  createSeriesSchema,
  createTagSchema,
  idParamSchema,
  paginatedSchema,
  seasonDetailSchema,
  seriesDetailSchema,
  seriesListQuerySchema,
  seriesSummarySchema,
  tagListQuerySchema,
  tagSchema,
  updateSeasonSchema,
  updateSeriesSchema,
  updateTagSchema,
} from '@osusume/shared';
import { and, eq, getTableColumns, sql } from 'drizzle-orm';
import {
  assertSeasonCover,
  assertTagsExist,
  insertSeason,
  insertSeries,
  loadSeasonDetail,
  loadSeriesDetail,
  lockSeries,
  refusingTakenOrdinal,
  seasonNotFound,
  seriesDateKey,
  setSeasonTags,
  setSeriesTags,
  toSeriesSummaries,
} from '../catalog/entries.ts';
import { withoutTag } from '../catalog/proposals.ts';
import { seriesMatchingSearch, seriesRelevance } from '../catalog/search.ts';
import { catalogRequest, image, season, seasonTag, series, seriesTag, tag } from '../db/schema.ts';
import { ApiError, isForeignKeyViolation, isUniqueViolation } from '../lib/errors.ts';
import { revalidatedRead } from '../lib/http-cache.ts';
import { removeImageFiles } from '../lib/image-storage.ts';
import { lockCatalog } from '../lib/locks.ts';
import { type SortTerm, decodeCursor, keysetBy, toPage } from '../lib/pagination.ts';
import {
  adminOnly,
  conflict,
  createRouter,
  invalidRequest,
  notFound,
  notModified,
  sessionSecurity,
  unauthenticated,
} from '../lib/router.ts';
import { requireAdmin, requireSession } from '../middleware/auth.ts';

const tagNotFound = () => new ApiError(404, 'tag_not_found', 'No such tag.');
const tagNameTaken = () => new ApiError(409, 'tag_name_taken', 'A tag with this name already exists.');

/** Runs a tag write, turning a taken name, ignoring case, into a clean refusal. */
async function refusingTakenTagName<Result>(run: () => Promise<Result>): Promise<Result> {
  try {
    return await run();
  } catch (error) {
    if (isUniqueViolation(error, 'tag_name_lower_unique')) throw tagNameTaken();
    throw error;
  }
}

const seriesContent = { 'application/json': { schema: seriesDetailSchema } };
const seasonContent = { 'application/json': { schema: seasonDetailSchema } };
const tagContent = { 'application/json': { schema: tagSchema } };
const jsonBody = <Schema extends z.ZodType>(schema: Schema) => ({
  required: true,
  content: { 'application/json': { schema } },
});

const listSeriesRoute = createRoute({
  method: 'get',
  path: '/series',
  summary: 'Browse or search series: newest first with blank dates last, or best match first',
  security: sessionSecurity,
  middleware: [requireSession, ...revalidatedRead] as const,
  request: { query: seriesListQuerySchema },
  responses: {
    200: {
      description: 'A page of series',
      content: { 'application/json': { schema: paginatedSchema(seriesSummarySchema) } },
    },
    ...notModified,
    ...invalidRequest,
    ...unauthenticated,
  },
});

const getSeriesRoute = createRoute({
  method: 'get',
  path: '/series/{id}',
  summary: 'A series with its seasons, in ordinal order',
  security: sessionSecurity,
  middleware: [requireSession, ...revalidatedRead] as const,
  request: { params: idParamSchema },
  responses: {
    200: { description: 'The series', content: seriesContent },
    ...notModified,
    ...invalidRequest,
    ...unauthenticated,
    ...notFound,
  },
});

const getSeasonRoute = createRoute({
  method: 'get',
  path: '/seasons/{id}',
  summary: 'A season with its effective tags',
  security: sessionSecurity,
  middleware: [requireSession, ...revalidatedRead] as const,
  request: { params: idParamSchema },
  responses: {
    200: { description: 'The season', content: seasonContent },
    ...notModified,
    ...invalidRequest,
    ...unauthenticated,
    ...notFound,
  },
});

const listTagsRoute = createRoute({
  method: 'get',
  path: '/tags',
  summary: 'The tag vocabulary, in name order',
  security: sessionSecurity,
  middleware: [requireSession, ...revalidatedRead] as const,
  request: { query: tagListQuerySchema },
  responses: {
    200: {
      description: 'A page of tags',
      content: { 'application/json': { schema: paginatedSchema(tagSchema) } },
    },
    ...notModified,
    ...invalidRequest,
    ...unauthenticated,
  },
});

const createSeriesRoute = createRoute({
  method: 'post',
  path: '/series',
  summary: 'Create a series',
  security: sessionSecurity,
  middleware: requireAdmin,
  request: { body: jsonBody(createSeriesSchema) },
  responses: {
    201: { description: 'The new series', content: seriesContent },
    ...invalidRequest,
    ...adminOnly,
  },
});

const updateSeriesRoute = createRoute({
  method: 'patch',
  path: '/series/{id}',
  summary: 'Edit a series. Sent tags replace its tags',
  security: sessionSecurity,
  middleware: requireAdmin,
  request: { params: idParamSchema, body: jsonBody(updateSeriesSchema) },
  responses: {
    200: { description: 'The edited series', content: seriesContent },
    ...invalidRequest,
    ...adminOnly,
    ...notFound,
  },
});

const deleteSeriesRoute = createRoute({
  method: 'delete',
  path: '/series/{id}',
  summary: 'Delete a series with no seasons. Its pending add-season requests are rejected',
  security: sessionSecurity,
  middleware: requireAdmin,
  request: { params: idParamSchema },
  responses: {
    204: { description: 'The series was deleted' },
    ...invalidRequest,
    ...adminOnly,
    ...notFound,
    ...conflict,
  },
});

const createSeasonRoute = createRoute({
  method: 'post',
  path: '/seasons',
  summary: 'Add a season to a series',
  security: sessionSecurity,
  middleware: requireAdmin,
  request: { body: jsonBody(createSeasonSchema) },
  responses: {
    201: { description: 'The new season', content: seasonContent },
    ...invalidRequest,
    ...adminOnly,
    ...notFound,
    ...conflict,
  },
});

const updateSeasonRoute = createRoute({
  method: 'patch',
  path: '/seasons/{id}',
  summary: 'Edit a season or move it to another series. Sent tags replace its own tags',
  security: sessionSecurity,
  middleware: requireAdmin,
  request: { params: idParamSchema, body: jsonBody(updateSeasonSchema) },
  responses: {
    200: { description: 'The edited season', content: seasonContent },
    ...invalidRequest,
    ...adminOnly,
    ...notFound,
    ...conflict,
  },
});

const deleteSeasonRoute = createRoute({
  method: 'delete',
  path: '/seasons/{id}',
  summary: "Delete a season that is on no one's list",
  security: sessionSecurity,
  middleware: requireAdmin,
  request: { params: idParamSchema },
  responses: {
    204: { description: 'The season was deleted' },
    ...invalidRequest,
    ...adminOnly,
    ...notFound,
    ...conflict,
  },
});

const createTagRoute = createRoute({
  method: 'post',
  path: '/tags',
  summary: 'Add a tag to the vocabulary',
  security: sessionSecurity,
  middleware: requireAdmin,
  request: { body: jsonBody(createTagSchema) },
  responses: {
    201: { description: 'The new tag', content: tagContent },
    ...invalidRequest,
    ...adminOnly,
    ...conflict,
  },
});

const updateTagRoute = createRoute({
  method: 'patch',
  path: '/tags/{id}',
  summary: 'Rename a tag',
  security: sessionSecurity,
  middleware: requireAdmin,
  request: { params: idParamSchema, body: jsonBody(updateTagSchema) },
  responses: {
    200: { description: 'The renamed tag', content: tagContent },
    ...invalidRequest,
    ...adminOnly,
    ...notFound,
    ...conflict,
  },
});

const deleteTagRoute = createRoute({
  method: 'delete',
  path: '/tags/{id}',
  summary: 'Delete a tag, detaching it from every series, season and pending request using it',
  security: sessionSecurity,
  middleware: requireAdmin,
  request: { params: idParamSchema },
  responses: {
    204: { description: 'The tag was deleted' },
    ...invalidRequest,
    ...adminOnly,
    ...notFound,
  },
});

/** relevance (0 when not searching), date key, lowercased title. */
const seriesSortSchema = z.tuple([z.number().int(), z.number().int(), z.string()]);

const tagNameKey = sql<string>`lower(${tag.name})`;

export const catalogRoutes = createRouter()
  .openapi(listSeriesRoute, async (c) => {
    const { db } = c.var.deps;
    const { cursor, limit, q, tag: tagId } = c.req.valid('query');
    const search = q === undefined || q === '' ? undefined : q;

    const relevance = search === undefined ? sql<number>`0` : seriesRelevance(search);
    const dateKey = seriesDateKey();
    const titleKey = sql<string>`lower(${series.title})`;

    const terms: SortTerm[] = [
      { expression: dateKey, type: 'integer', direction: 'desc' },
      { expression: titleKey, type: 'text', direction: 'asc' },
      { expression: series.id, type: 'uuid', direction: 'asc' },
    ];
    if (search !== undefined) terms.unshift({ expression: relevance, type: 'integer', direction: 'desc' });

    const position = cursor === undefined ? undefined : decodeCursor(cursor, seriesSortSchema);
    const values =
      position === undefined
        ? undefined
        : [...(search === undefined ? position.sort.slice(1) : position.sort), position.id];
    const page = keysetBy(terms, values);

    const hasTag =
      tagId === undefined
        ? undefined
        : sql`${series.id} IN (
            SELECT ${seriesTag.seriesId} FROM ${seriesTag} WHERE ${seriesTag.tagId} = ${tagId}
            UNION
            SELECT ${season.seriesId} FROM ${seasonTag}
            INNER JOIN ${season} ON ${season.id} = ${seasonTag.seasonId}
            WHERE ${seasonTag.tagId} = ${tagId}
          )`;

    const rows = await db
      .select({ ...getTableColumns(series), relevance, dateKey, titleKey })
      .from(series)
      .where(
        and(search === undefined ? undefined : seriesMatchingSearch(search), hasTag, page.where),
      )
      .orderBy(...page.orderBy)
      .limit(limit + 1);
    const { items, nextCursor } = toPage(rows, limit, (row) => ({
      sort: [row.relevance, row.dateKey, row.titleKey],
      id: row.id,
    }));
    return c.json({ items: await toSeriesSummaries(db, items), nextCursor }, 200);
  })
  .openapi(getSeriesRoute, async (c) => {
    return c.json(await loadSeriesDetail(c.var.deps.db, c.req.valid('param').id), 200);
  })
  .openapi(getSeasonRoute, async (c) => {
    return c.json(await loadSeasonDetail(c.var.deps.db, c.req.valid('param').id), 200);
  })
  .openapi(listTagsRoute, async (c) => {
    const { db } = c.var.deps;
    const { cursor, limit } = c.req.valid('query');
    const position = cursor === undefined ? undefined : decodeCursor(cursor, z.string());
    const page = keysetBy(
      [
        { expression: tagNameKey, type: 'text', direction: 'asc' },
        { expression: tag.id, type: 'uuid', direction: 'asc' },
      ],
      position === undefined ? undefined : [position.sort, position.id],
    );
    const rows = await db
      .select({ id: tag.id, name: tag.name, nameKey: tagNameKey })
      .from(tag)
      .where(page.where)
      .orderBy(...page.orderBy)
      .limit(limit + 1);
    const { items, nextCursor } = toPage(rows, limit, (row) => ({ sort: row.nameKey, id: row.id }));
    return c.json({ items: items.map(({ id, name }) => ({ id, name })), nextCursor }, 200);
  })
  .openapi(createSeriesRoute, async (c) => {
    const { db } = c.var.deps;
    const body = c.req.valid('json');
    const created = await db.transaction(async (tx) => {
      await lockCatalog(tx);
      await assertTagsExist(tx, body.tagIds ?? []);
      return loadSeriesDetail(tx, await insertSeries(tx, body));
    });
    return c.json(created, 201);
  })
  .openapi(updateSeriesRoute, async (c) => {
    const { db } = c.var.deps;
    const { id } = c.req.valid('param');
    const { tagIds, ...fields } = c.req.valid('json');
    const updated = await db.transaction(async (tx) => {
      await lockCatalog(tx);
      await lockSeries(tx, id);
      await assertTagsExist(tx, tagIds ?? []);
      await tx
        .update(series)
        .set({ ...fields, updatedAt: new Date() })
        .where(eq(series.id, id));
      if (tagIds !== undefined) await setSeriesTags(tx, id, tagIds);
      return loadSeriesDetail(tx, id);
    });
    return c.json(updated, 200);
  })
  .openapi(deleteSeriesRoute, async (c) => {
    const { db, imageStorage } = c.var.deps;
    const { id } = c.req.valid('param');
    const adminId = c.var.currentUser.id;
    let storageKeys: string[];
    try {
      storageKeys = await db.transaction(async (tx) => {
        await lockCatalog(tx);
        const row = await lockSeries(tx, id);
        await tx
          .update(catalogRequest)
          .set({
            status: 'rejected',
            reviewedBy: adminId,
            decisionNote: `The series "${row.title}" was deleted.`,
          })
          .where(
            and(
              eq(catalogRequest.seriesId, id),
              eq(catalogRequest.kind, 'add_season'),
              eq(catalogRequest.status, 'pending'),
            ),
          );
        // The catalog's rows go with the series, by the foreign key.
        const catalog = await tx
          .select({ storageKey: image.storageKey })
          .from(image)
          .where(eq(image.seriesId, id));
        await tx.delete(series).where(eq(series.id, id));
        return catalog.map((entry) => entry.storageKey);
      });
    } catch (error) {
      if (isForeignKeyViolation(error, 'season_series_id_series_id_fk')) {
        throw new ApiError(
          409,
          'series_has_seasons',
          'This series still has seasons. Delete them first.',
        );
      }
      throw error;
    }
    await removeImageFiles(imageStorage, storageKeys);
    return c.body(null, 204);
  })
  .openapi(createSeasonRoute, async (c) => {
    const { db } = c.var.deps;
    const { seriesId, ...entry } = c.req.valid('json');
    const created = await refusingTakenOrdinal(() =>
      db.transaction(async (tx) => {
        await lockCatalog(tx);
        await lockSeries(tx, seriesId);
        await assertTagsExist(tx, entry.tagIds ?? []);
        await assertSeasonCover(tx, seriesId, entry.coverImageId);
        return loadSeasonDetail(tx, await insertSeason(tx, seriesId, entry));
      }),
    );
    return c.json(created, 201);
  })
  .openapi(updateSeasonRoute, async (c) => {
    const { db } = c.var.deps;
    const { id } = c.req.valid('param');
    const { tagIds, seriesId, ...fields } = c.req.valid('json');
    const updated = await refusingTakenOrdinal(() =>
      db.transaction(async (tx) => {
        await lockCatalog(tx);
        const [row] = await tx.select().from(season).where(eq(season.id, id)).for('update');
        if (!row) throw seasonNotFound();
        const moving = seriesId !== undefined && seriesId !== row.seriesId;
        if (moving) await lockSeries(tx, seriesId);
        await assertTagsExist(tx, tagIds ?? []);
        await assertSeasonCover(tx, moving ? seriesId : row.seriesId, fields.coverImageId);
        // List entries point at the season, so they follow it. A taken ordinal in the new series
        // breaks the unique constraint, which refusingTakenOrdinal reports. A cover from the old
        // catalog cannot stay.
        await tx
          .update(season)
          .set({
            ...fields,
            ...(moving ? { seriesId, coverImageId: fields.coverImageId ?? null } : {}),
            updatedAt: new Date(),
          })
          .where(eq(season.id, id));
        if (tagIds !== undefined) await setSeasonTags(tx, id, tagIds);
        return loadSeasonDetail(tx, id);
      }),
    );
    return c.json(updated, 200);
  })
  .openapi(deleteSeasonRoute, async (c) => {
    const { db } = c.var.deps;
    const { id } = c.req.valid('param');
    let deleted;
    try {
      deleted = await db.delete(season).where(eq(season.id, id)).returning({ id: season.id });
    } catch (error) {
      if (isForeignKeyViolation(error, 'list_entry_season_id_season_id_fk')) {
        throw new ApiError(
          409,
          'season_on_list',
          "This season is on someone's list, so it cannot be deleted.",
        );
      }
      throw error;
    }
    if (deleted.length === 0) throw seasonNotFound();
    return c.body(null, 204);
  })
  .openapi(createTagRoute, async (c) => {
    const { db } = c.var.deps;
    const { name } = c.req.valid('json');
    const [created] = await refusingTakenTagName(() =>
      db.insert(tag).values({ name }).returning({ id: tag.id, name: tag.name }),
    );
    if (!created) throw new Error('tag was not created');
    return c.json(created, 201);
  })
  .openapi(updateTagRoute, async (c) => {
    const { db } = c.var.deps;
    const { id } = c.req.valid('param');
    const { name } = c.req.valid('json');
    const [updated] = await refusingTakenTagName(() =>
      db.update(tag).set({ name }).where(eq(tag.id, id)).returning({ id: tag.id, name: tag.name }),
    );
    if (!updated) throw tagNotFound();
    return c.json(updated, 200);
  })
  .openapi(deleteTagRoute, async (c) => {
    const { db } = c.var.deps;
    const { id } = c.req.valid('param');
    await db.transaction(async (tx) => {
      await lockCatalog(tx);
      // A pending request that chose this tag would otherwise fail on approval.
      const pending = await tx
        .select({ id: catalogRequest.id, payload: catalogRequest.payload })
        .from(catalogRequest)
        .where(
          and(
            eq(catalogRequest.status, 'pending'),
            sql`${catalogRequest.payload}::text LIKE ${`%${id}%`}`,
          ),
        );
      for (const request of pending) {
        await tx
          .update(catalogRequest)
          .set({ payload: withoutTag(catalogProposalSchema.parse(request.payload), id) })
          .where(eq(catalogRequest.id, request.id));
      }
      // series_tag and season_tag rows go with it, by their foreign keys.
      const deleted = await tx.delete(tag).where(eq(tag.id, id)).returning({ id: tag.id });
      if (deleted.length === 0) throw tagNotFound();
    });
    return c.body(null, 204);
  });
