import { createRoute } from '@hono/zod-openapi';
import { imageParamSchema } from '@osusume/shared';
import { eq } from 'drizzle-orm';
import { image } from '../db/schema.ts';
import { ApiError } from '../lib/errors.ts';
import { immutableRead } from '../lib/http-cache.ts';
import { STORED_IMAGE_MIME } from '../lib/image-processing.ts';
import { imageVariantKey } from '../lib/image-storage.ts';
import {
  createRouter,
  invalidRequest,
  notFound,
  notModified,
  sessionSecurity,
  unauthenticated,
} from '../lib/router.ts';
import { requireSession } from '../middleware/auth.ts';

const imageNotFound = () => new ApiError(404, 'image_not_found', 'No such image.');

const readRoute = createRoute({
  method: 'get',
  path: '/images/{id}/{size}',
  summary: 'An image in a named size',
  security: sessionSecurity,
  middleware: [requireSession, immutableRead] as const,
  request: { params: imageParamSchema },
  responses: {
    200: {
      description: 'The image',
      content: { [STORED_IMAGE_MIME]: { schema: { type: 'string', format: 'binary' } } },
    },
    ...notModified,
    ...invalidRequest,
    ...unauthenticated,
    ...notFound,
  },
});

export const imageRoutes = createRouter()
  .openapi(readRoute, async (c) => {
    const { db, imageStorage } = c.var.deps;
    const { id, size } = c.req.valid('param');
    const [row] = await db
      .select({ storageKey: image.storageKey, mime: image.mime })
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
      'Content-Type': row.mime,
      'Content-Length': String(bytes.byteLength),
      'X-Content-Type-Options': 'nosniff',
      ETag: tag,
    });
  });
