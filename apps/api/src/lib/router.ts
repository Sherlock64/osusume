import { OpenAPIHono } from '@hono/zod-openapi';
import { type ErrorResponse, errorResponseSchema } from '@osusume/shared';
import type { AppEnv } from './context.ts';

/**
 * A router whose validation failures use the api's error shape. Messages name the field
 * and the rule and never echo the value, which may be a password.
 */
export function createRouter() {
  return new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (result.success) return undefined;
      const message = result.error.issues
        .map((issue) => `${issue.path.join('.') || 'request'}: ${issue.message}`)
        .join('; ');
      const body: ErrorResponse = { error: { code: 'validation_error', message } };
      return c.json(body, 400);
    },
  });
}

function errorResponse(description: string) {
  return { description, content: { 'application/json': { schema: errorResponseSchema } } };
}

/* Response entries for createRoute. Spread the ones a route can return. */
export const invalidRequest = { 400: errorResponse('The request is not valid') };
export const unauthenticated = {
  401: errorResponse('Not logged in'),
  403: errorResponse('The account is disabled'),
};
export const adminOnly = {
  401: errorResponse('Not logged in'),
  403: errorResponse('Not an admin, or the action is not allowed on this account'),
};
export const notFound = { 404: errorResponse('Not found') };
export const conflict = { 409: errorResponse('The current state does not allow this') };
export const notModified = { 304: { description: 'Unchanged since the given ETag' } };
export const rateLimited = { 429: errorResponse('Too many attempts; try again later') };
export const emailFailed = { 503: errorResponse('The email could not be sent') };

/** Marks a route in the OpenAPI document as needing a session cookie. */
export const sessionSecurity = [{ session: [] }];
