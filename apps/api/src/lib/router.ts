import { zValidator } from '@hono/zod-validator';
import type { ErrorResponse } from '@osusume/shared';
import { Hono, type ValidationTargets } from 'hono';
import type { z } from 'zod';
import type { AppEnv } from './context.ts';

export const createRouter = () => new Hono<AppEnv>();

/**
 * Validates a part of the request, with failures in the api's error shape. Messages name the field
 * and the rule and never echo the value, which may be a password.
 */
export function valid<Target extends keyof ValidationTargets, Schema extends z.ZodType>(
  target: Target,
  schema: Schema,
) {
  return zValidator(target, schema, (result, c) => {
    if (result.success) return undefined;
    const message = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'request'}: ${issue.message}`)
      .join('; ');
    const body: ErrorResponse = { error: { code: 'validation_error', message } };
    return c.json(body, 400);
  });
}
