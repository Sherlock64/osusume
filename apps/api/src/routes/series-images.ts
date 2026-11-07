import {
  MAX_IMAGE_UPLOAD_BYTES,
  idParamSchema,
  imageSizes,
  seriesImageListQuerySchema,
  seriesImageParamSchema,
} from '@osusume/shared';
import { and, asc, eq } from 'drizzle-orm';
import { bodyLimit } from 'hono/body-limit';
import { createMiddleware } from 'hono/factory';
import { z } from 'zod';
import { lockSeries, seriesNotFound } from '../catalog/entries.ts';
import type { Transaction } from '../db/client.ts';
import { image, series } from '../db/schema.ts';
import type { AppEnv } from '../lib/context.ts';
import { ApiError } from '../lib/errors.ts';
import { revalidatedRead } from '../lib/http-cache.ts';
import { processImage } from '../lib/image-processing.ts';
import { imageOriginalKey, imageVariantKey, removeImageFiles } from '../lib/image-storage.ts';
import { lockCatalog } from '../lib/locks.ts';
import { decodeCursor, keyset, toPage } from '../lib/pagination.ts';
import { createRouter, valid } from '../lib/router.ts';
import { requireAdmin, requireSession } from '../middleware/auth.ts';

const imageNotFound = () => new ApiError(404, 'image_not_found', 'No such image.');
const imageTooLarge = () =>
  new ApiError(
    413,
    'image_too_large',
    `Images can be at most ${String(MAX_IMAGE_UPLOAD_BYTES / (1024 * 1024))} MB.`,
  );

// Room for the multipart framing around the file, so the file's own size decides.
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

const limitUploadSize = bodyLimit({
  maxSize: MAX_IMAGE_UPLOAD_BYTES + MULTIPART_OVERHEAD_BYTES,
  onError: () => {
    throw imageTooLarge();
  },
});

/** Stops reading the body at the limit, before it is parsed. */
const uploadSizeLimit = createMiddleware<AppEnv>(async (c, next) => {
  await limitUploadSize(c, next);
});

type ImageRow = typeof image.$inferSelect;

function toSeriesImage(row: ImageRow) {
  return {
    id: row.id,
    width: row.width,
    height: row.height,
    isPrimary: row.isPrimary,
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

const uploadFormSchema = z.object({ file: z.file() });

export const seriesImageRoutes = createRouter()
  // A series' image catalog, earliest added first
  .get(
    '/series/:id/images',
    requireSession,
    ...revalidatedRead,
    valid('param', idParamSchema),
    valid('query', seriesImageListQuerySchema),
    async (c) => {
      const { db } = c.var.deps;
      const { id } = c.req.valid('param');
      const { cursor, limit } = c.req.valid('query');
      const [found] = await db.select({ id: series.id }).from(series).where(eq(series.id, id));
      if (!found) throw seriesNotFound();
      const page = keyset({
        sortColumn: image.createdAt,
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
        sort: row.createdAt,
        id: row.id,
      }));
      return c.json({ items: items.map(toSeriesImage), nextCursor }, 200);
    },
  )
  // Upload an image into the catalog. Its content decides whether it is accepted. The first image becomes the primary
  .post(
    '/series/:id/images',
    requireAdmin,
    uploadSizeLimit,
    valid('param', idParamSchema),
    valid('form', uploadFormSchema),
    async (c) => {
      const { db, imageStorage } = c.var.deps;
      const { id } = c.req.valid('param');
      const { file } = c.req.valid('form');
      if (file.size > MAX_IMAGE_UPLOAD_BYTES) throw imageTooLarge();
      // Checked again under the lock. This one spares resizing an image with nowhere to go.
      const [found] = await db.select({ id: series.id }).from(series).where(eq(series.id, id));
      if (!found) throw seriesNotFound();

      const processed = await processImage(new Uint8Array(await file.arrayBuffer()));
      const imageId = crypto.randomUUID();
      const storageKey = `images/${imageId}`;

      // Files first: a row never points at bytes that are not there.
      try {
        for (const size of imageSizes) {
          await imageStorage.put(imageVariantKey(storageKey, size), processed.variants[size]);
        }
        await imageStorage.put(imageOriginalKey(storageKey), processed.original);
        const added = await db.transaction(async (tx) => {
          await lockCatalog(tx);
          await lockSeries(tx, id);
          const [primary] = await tx
            .select({ id: image.id })
            .from(image)
            .where(and(eq(image.seriesId, id), eq(image.isPrimary, true)));
          const [row] = await tx
            .insert(image)
            .values({
              id: imageId,
              storageKey,
              width: processed.width,
              height: processed.height,
              uploadedBy: c.var.currentUser.id,
              seriesId: id,
              isPrimary: primary === undefined,
            })
            .returning();
          if (!row) throw new Error('image was not created');
          return row;
        });
        return c.json(toSeriesImage(added), 201);
      } catch (error) {
        await removeImageFiles(imageStorage, [storageKey]);
        throw error;
      }
    },
  )
  // Make this image the series' primary
  .post(
    '/series/:id/images/:imageId/primary',
    requireAdmin,
    valid('param', seriesImageParamSchema),
    async (c) => {
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
    },
  )
  // Delete an image and all its files. A removed primary falls to the earliest added; a season using it falls back to the primary
  .delete(
    '/series/:id/images/:imageId',
    requireAdmin,
    valid('param', seriesImageParamSchema),
    async (c) => {
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
            .orderBy(asc(image.createdAt), asc(image.id))
            .limit(1);
          if (earliest) {
            await tx.update(image).set({ isPrimary: true }).where(eq(image.id, earliest.id));
          }
        }
        return row.storageKey;
      });
      await removeImageFiles(imageStorage, [storageKey]);
      return c.body(null, 204);
    },
  );
