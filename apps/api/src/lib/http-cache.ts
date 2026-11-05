import { createMiddleware } from 'hono/factory';
import { etag } from 'hono/etag';

/** Sets the headers on what a route answers with, and leaves its refusals uncached. */
function cacheHeaders(cacheControl: string) {
  return createMiddleware(async (c, next) => {
    await next();
    if (c.res.status !== 200 && c.res.status !== 304) return;
    c.res.headers.set('Cache-Control', cacheControl);
    c.res.headers.set('Vary', 'Cookie');
  });
}

/**
 * For catalog reads, after the auth middleware. Only the browser may store a response, and it
 * must ask again before reusing it: an edit shows at once, and a logged-out or disabled user
 * is refused. An unchanged response costs a 304, not the body.
 */
export const revalidatedRead = [cacheHeaders('private, no-cache'), etag()] as const;

/**
 * For content that never changes under its URL, after the auth middleware. Only the browser may
 * store it. The route sets its own ETag and answers 304 itself.
 */
export const immutableRead = cacheHeaders('private, max-age=604800, immutable');
