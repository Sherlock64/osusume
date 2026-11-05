import { createRoute, z } from '@hono/zod-openapi';
import {
  MAX_IMAGE_UPLOAD_BYTES,
  type ImageSize,
  errorResponseSchema,
  imageParamSchema,
  imageSchema,
  imageSizes,
} from '@osusume/shared';
import { eq } from 'drizzle-orm';
import { bodyLimit } from 'hono/body-limit';
import { createMiddleware } from 'hono/factory';
import { image } from '../db/schema.ts';
import type { AppEnv } from '../lib/context.ts';
import { ApiError } from '../lib/errors.ts';
import { immutableRead } from '../lib/http-cache.ts';
import { STORED_IMAGE_MIME, processImage } from '../lib/image-processing.ts';
import {
  adminOnly,
  createRouter,
  invalidRequest,
  notFound,
  notModified,
  sessionSecurity,
  unauthenticated,
} from '../lib/router.ts';
import { requireAdmin, requireSession } from '../middleware/auth.ts';

const imageTooLarge = () =>
  new ApiError(
    413,
    'image_too_large',
    `Images can be at most ${String(MAX_IMAGE_UPLOAD_BYTES / (1024 * 1024))} MB.`,
  );
const imageNotFound = () => new ApiError(404, 'image_not_found', 'No such image.');

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

const variantKey = (storageKey: string, size: ImageSize) => `${storageKey}/${size}.webp`;

const uploadRoute = createRoute({
  method: 'post',
  path: '/images',
  summary: 'Upload a cover image. Its content decides whether it is accepted, not its declared type',
  security: sessionSecurity,
  middleware: [requireAdmin, uploadSizeLimit] as const,
  request: {
    body: {
      required: true,
      content: {
        'multipart/form-data': {
          schema: z.object({
            file: z.file().openapi({ type: 'string', format: 'binary' }),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: 'The stored image, available in every named size',
      content: { 'application/json': { schema: imageSchema } },
    },
    ...invalidRequest,
    ...adminOnly,
    413: {
      description: 'The file is too large',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    415: {
      description: 'The content is not an accepted image format',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
  },
});

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
  .openapi(uploadRoute, async (c) => {
    const { db, imageStorage } = c.var.deps;
    const { file } = c.req.valid('form');
    if (file.size > MAX_IMAGE_UPLOAD_BYTES) throw imageTooLarge();

    const processed = await processImage(new Uint8Array(await file.arrayBuffer()));
    const id = crypto.randomUUID();
    const storageKey = `images/${id}`;

    // Files first: a row never points at bytes that are not there.
    try {
      for (const size of imageSizes) {
        await imageStorage.put(variantKey(storageKey, size), processed.variants[size]);
      }
      const [row] = await db
        .insert(image)
        .values({
          id,
          storageKey,
          mime: STORED_IMAGE_MIME,
          width: processed.width,
          height: processed.height,
          uploadedBy: c.var.currentUser.id,
        })
        .returning();
      if (!row) throw new Error('image was not created');
      return c.json(
        {
          id: row.id,
          mime: row.mime,
          width: row.width,
          height: row.height,
          createdAt: row.createdAt.toISOString(),
        },
        201,
      );
    } catch (error) {
      await imageStorage.remove(storageKey);
      throw error;
    }
  })
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
    const bytes = await imageStorage.get(variantKey(row.storageKey, size));
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
