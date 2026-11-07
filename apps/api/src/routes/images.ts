import { imageParamSchema } from '@osusume/shared';
import { eq } from 'drizzle-orm';
import { image } from '../db/schema.ts';
import { ApiError } from '../lib/errors.ts';
import { immutableRead } from '../lib/http-cache.ts';
import { STORED_IMAGE_MIME } from '../lib/image-processing.ts';
import { imageVariantKey } from '../lib/image-storage.ts';
import { createRouter, valid } from '../lib/router.ts';

const imageNotFound = () => new ApiError(404, 'image_not_found', 'No such image.');

export const imageRoutes = createRouter()
  // An image in a named size. Needs no login: every image is catalog art, shown on public lists too
  .get(
    '/images/:id/:size',
    immutableRead,
    valid('param', imageParamSchema),
    async (c) => {
      const { db, imageStorage } = c.var.deps;
      const { id, size } = c.req.valid('param');
      const [row] = await db
        .select({ storageKey: image.storageKey })
        .from(image)
        .where(eq(image.id, id));
      if (!row) throw imageNotFound();

      // What is under an image's URL never changes, so its address is its version.
      const tag = `"${id}-${size}"`;
      if (c.req.header('If-None-Match') === tag) {
        return c.body(null, 304, { ETag: tag });
      }
      const bytes = await imageStorage.get(imageVariantKey(row.storageKey, size));
      if (!bytes) {
        console.error(`Image ${id} has no stored file for size ${size}`);
        throw imageNotFound();
      }
      return c.body(Buffer.from(bytes), 200, {
        'Content-Type': STORED_IMAGE_MIME,
        'Content-Length': String(bytes.byteLength),
        'X-Content-Type-Options': 'nosniff',
        ETag: tag,
      });
    },
  );
