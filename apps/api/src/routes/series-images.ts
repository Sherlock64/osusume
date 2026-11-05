import { createRoute, z } from '@hono/zod-openapi';
import {
  addSeriesImageSchema,
  idParamSchema,
  paginatedSchema,
  seriesImageListQuerySchema,
  seriesImageParamSchema,
  seriesImageSchema,
} from '@osusume/shared';
import { and, asc, eq } from 'drizzle-orm';
import { lockSeries, seriesNotFound } from '../catalog/entries.ts';
import type { Transaction } from '../db/client.ts';
import { image, series } from '../db/schema.ts';
import { ApiError } from '../lib/errors.ts';
import { revalidatedRead } from '../lib/http-cache.ts';
import { removeImageFiles } from '../lib/image-storage.ts';
import { lockCatalog } from '../lib/locks.ts';
import { decodeCursor, keyset, toPage } from '../lib/pagination.ts';
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

const imageNotFound = () => new ApiError(404, 'image_not_found', 'No such image.');

type ImageRow = typeof image.$inferSelect;

function addedAtOf(row: ImageRow): Date {
  if (row.addedAt === null) throw new Error('An image in a catalog has no added time');
  return row.addedAt;
}

function toSeriesImage(row: ImageRow) {
  return {
    id: row.id,
    mime: row.mime,
    width: row.width,
    height: row.height,
    isPrimary: row.isPrimary,
    addedAt: addedAtOf(row).toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

/** An image in this series' catalog, held for the transaction. */
async function lockCatalogImage(tx: Transaction, seriesId: string, imageId: string): Promise<ImageRow> {
  const [row] = await tx
    .select()
    .from(image)
    .where(and(eq(image.id, imageId), eq(image.seriesId, seriesId)))
    .for('update');
  if (!row) throw imageNotFound();
  return row;
}

const seriesImageContent = { 'application/json': { schema: seriesImageSchema } };

const listRoute = createRoute({
  method: 'get',
  path: '/series/{id}/images',
  summary: "A series' image catalog, earliest added first",
  security: sessionSecurity,
  middleware: [requireSession, ...revalidatedRead] as const,
  request: { params: idParamSchema, query: seriesImageListQuerySchema },
  responses: {
    200: {
      description: 'A page of images',
      content: { 'application/json': { schema: paginatedSchema(seriesImageSchema) } },
    },
    ...notModified,
    ...invalidRequest,
    ...unauthenticated,
    ...notFound,
  },
});

const addRoute = createRoute({
  method: 'post',
  path: '/series/{id}/images',
  summary: 'Add an uploaded image to the catalog. The first image becomes the primary',
  security: sessionSecurity,
  middleware: requireAdmin,
  request: {
    params: idParamSchema,
    body: { required: true, content: { 'application/json': { schema: addSeriesImageSchema } } },
  },
  responses: {
    201: { description: 'The image in the catalog', content: seriesImageContent },
    ...invalidRequest,
    ...adminOnly,
    ...notFound,
    ...conflict,
  },
});

const setPrimaryRoute = createRoute({
  method: 'post',
  path: '/series/{id}/images/{imageId}/primary',
  summary: "Make this image the series' primary",
  security: sessionSecurity,
  middleware: requireAdmin,
  request: { params: seriesImageParamSchema },
  responses: {
    200: { description: 'The new primary image', content: seriesImageContent },
    ...invalidRequest,
    ...adminOnly,
    ...notFound,
  },
});

const removeRoute = createRoute({
  method: 'delete',
  path: '/series/{id}/images/{imageId}',
  summary:
    'Delete an image and all its files. A removed primary falls to the earliest added; a season using it falls back to the primary',
  security: sessionSecurity,
  middleware: requireAdmin,
  request: { params: seriesImageParamSchema },
  responses: {
    204: { description: 'The image was deleted' },
    ...invalidRequest,
    ...adminOnly,
    ...notFound,
  },
});

export const seriesImageRoutes = createRouter()
  .openapi(listRoute, async (c) => {
    const { db } = c.var.deps;
    const { id } = c.req.valid('param');
    const { cursor, limit } = c.req.valid('query');
    const [found] = await db.select({ id: series.id }).from(series).where(eq(series.id, id));
    if (!found) throw seriesNotFound();
    const page = keyset({
      sortColumn: image.addedAt,
      idColumn: image.id,
      cursor: cursor === undefined ? undefined : decodeCursor(cursor, z.coerce.date()),
    });
    const rows = await db
      .select()
      .from(image)
      .where(and(eq(image.seriesId, id), page.where))
      .orderBy(...page.orderBy)
      .limit(limit + 1);
    const { items, nextCursor } = toPage(rows, limit, (row) => ({
      sort: addedAtOf(row),
      id: row.id,
    }));
    return c.json({ items: items.map(toSeriesImage), nextCursor }, 200);
  })
  .openapi(addRoute, async (c) => {
    const { db } = c.var.deps;
    const { id } = c.req.valid('param');
    const { imageId } = c.req.valid('json');
    const added = await db.transaction(async (tx) => {
      await lockCatalog(tx);
      await lockSeries(tx, id);
      const [row] = await tx.select().from(image).where(eq(image.id, imageId)).for('update');
      if (!row) throw imageNotFound();
      if (row.seriesId !== null) {
        throw new ApiError(409, 'image_in_catalog', 'This image is already in a catalog.');
      }
      const [primary] = await tx
        .select({ id: image.id })
        .from(image)
        .where(and(eq(image.seriesId, id), eq(image.isPrimary, true)));
      const [updated] = await tx
        .update(image)
        .set({ seriesId: id, isPrimary: primary === undefined, addedAt: new Date() })
        .where(eq(image.id, imageId))
        .returning();
      if (!updated) throw imageNotFound();
      return updated;
    });
    return c.json(toSeriesImage(added), 201);
  })
  .openapi(setPrimaryRoute, async (c) => {
    const { db } = c.var.deps;
    const { id, imageId } = c.req.valid('param');
    const primary = await db.transaction(async (tx) => {
      await lockCatalog(tx);
      await lockSeries(tx, id);
      await lockCatalogImage(tx, id, imageId);
      // In this order: the index allows one primary at any moment, not just at commit.
      await tx
        .update(image)
        .set({ isPrimary: false })
        .where(and(eq(image.seriesId, id), eq(image.isPrimary, true)));
      const [updated] = await tx
        .update(image)
        .set({ isPrimary: true })
        .where(eq(image.id, imageId))
        .returning();
      if (!updated) throw imageNotFound();
      return updated;
    });
    return c.json(toSeriesImage(primary), 200);
  })
  .openapi(removeRoute, async (c) => {
    const { db, imageStorage } = c.var.deps;
    const { id, imageId } = c.req.valid('param');
    const storageKey = await db.transaction(async (tx) => {
      await lockCatalog(tx);
      await lockSeries(tx, id);
      const row = await lockCatalogImage(tx, id, imageId);
      // season.cover_image_id goes null with it, which means the series primary.
      await tx.delete(image).where(eq(image.id, imageId));
      if (row.isPrimary) {
        const [earliest] = await tx
          .select({ id: image.id })
          .from(image)
          .where(eq(image.seriesId, id))
          .orderBy(asc(image.addedAt), asc(image.id))
          .limit(1);
        if (earliest) {
          await tx.update(image).set({ isPrimary: true }).where(eq(image.id, earliest.id));
        }
      }
      return row.storageKey;
    });
    await removeImageFiles(imageStorage, [storageKey]);
    return c.body(null, 204);
  });
