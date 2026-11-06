import type { ErrorResponse } from '@osusume/shared';
import { createMiddleware } from 'hono/factory';
import type { AppEnv } from './context.ts';

/** A JSON `\u0000` escape, and not the literal text after an escaped backslash (`\\u0000`). */
const ESCAPED_NUL = /(?<!\\)(?:\\\\)*\\u0000/;

/** Whether JSON text holds a NUL once parsed. A raw NUL byte is not valid JSON to begin with. */
export function jsonHasNul(json: string): boolean {
  return ESCAPED_NUL.test(json);
}

/**
 * Refuses a NUL byte in the URL or a JSON body. Postgres cannot store one in text and fails the
 * query, so without this any free-text field would answer 500. Runs before auth so that every
 * route gets it. Reads a clone, as a route's body limit needs the original still unread.
 */
export const rejectNulBytes = createMiddleware<AppEnv>(async (c, next) => {
  const isJson = /^application\/([a-z-.]+\+)?json/i.test(c.req.header('Content-Type') ?? '');
  if (c.req.url.includes('%00') || (isJson && jsonHasNul(await c.req.raw.clone().text()))) {
    const body: ErrorResponse = {
      error: { code: 'validation_error', message: 'request: must not contain a NUL byte' },
    };
    return c.json(body, 400);
  }
  await next();
});
