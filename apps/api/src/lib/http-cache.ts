import { createMiddleware } from 'hono/factory';
import { etag } from 'hono/etag';
import type { AppEnv } from './context.ts';

/**
 * For all of /api/v1. Whatever does not state its own policy may depend on who is asking, so
 * nothing stores it. Routes with a policy of their own use the middleware below.
 */
export const privateByDefault = createMiddleware(async (c, next) => {
  await next();
  if (!c.res.headers.has('Cache-Control')) c.res.headers.set('Cache-Control', 'private, no-store');
});

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

/**
 * For per-user answers, before the auth middleware so that refusals carry it too. Nothing may be
 * reused, not even a 404, because who may see a list can change at any time.
 */
export const privateNoStore = createMiddleware<AppEnv>(async (c, next) => {
  await next();
  c.res.headers.set('Cache-Control', 'private, no-store');
  c.res.headers.set('Vary', 'Cookie');
});

/** For a public list, found or not: no cache may keep it, as the owner can hide it at any time. */
export const publicNoStore = createMiddleware<AppEnv>(async (c, next) => {
  await next();
  c.res.headers.set('Cache-Control', 'no-store');
});
