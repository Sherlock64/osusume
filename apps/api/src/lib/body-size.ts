import { bodyLimit } from 'hono/body-limit';
import { createMiddleware } from 'hono/factory';
import { ApiError } from './errors.ts';

/**
 * Far above any real request: a catalog request with 100 long seasons is about 500 KB. The schemas
 * could add up to more, but only with every field at its maximum at once.
 */
export const MAX_REQUEST_BODY_BYTES = 1024 * 1024;

/** The one route that takes a large body. It enforces its own limit, on multipart only. */
const IMAGE_UPLOAD_PATH = /^\/api\/v1\/series\/[^/]+\/images\/?$/;

const limitBody = bodyLimit({
  maxSize: MAX_REQUEST_BODY_BYTES,
  onError: () => {
    throw new ApiError(413, 'request_too_large', 'The request is too large.');
  },
});

/**
 * Runs before anything reads a body, as `rejectNulBytes` and Better Auth both buffer it whole.
 * Covers every content type, since Better Auth also parses forms. Only a multipart POST to the
 * upload route is let past: a JSON body there would reach `rejectNulBytes` unlimited.
 */
export const limitRequestBody = createMiddleware(async (c, next) => {
  const isImageUpload =
    c.req.method === 'POST' &&
    IMAGE_UPLOAD_PATH.test(c.req.path) &&
    /^multipart\/form-data/i.test(c.req.header('Content-Type') ?? '');
  if (isImageUpload) {
    await next();
    return;
  }
  await limitBody(c, next);
});
