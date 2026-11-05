import { OpenAPIHono } from '@hono/zod-openapi';
import type { ErrorResponse } from '@osusume/shared';
import { ApiError } from './lib/errors.ts';
import { healthRoutes } from './routes/health.ts';

export interface AppDependencies {
  /** Resolves when the database answers a query; rejects otherwise. */
  checkDatabase: () => Promise<void>;
}

export function createApp(dependencies: AppDependencies) {
  const v1 = new OpenAPIHono().route('/', healthRoutes(dependencies.checkDatabase));

  v1.doc('/openapi.json', {
    openapi: '3.0.0',
    info: { title: 'Osusume API', version: '1.0.0' },
    servers: [{ url: '/api/v1' }],
  });

  const app = new OpenAPIHono().route('/api/v1', v1);

  app.onError((error, c) => {
    if (error instanceof ApiError) {
      const body: ErrorResponse = { error: { code: error.code, message: error.message } };
      return c.json(body, error.status);
    }
    console.error('Unhandled error:', error);
    const body: ErrorResponse = {
      error: { code: 'internal_error', message: 'Something went wrong.' },
    };
    return c.json(body, 500);
  });

  return app;
}

/** The route type behind the Hono client. See `createApiClient` in @osusume/shared. */
export type AppType = ReturnType<typeof createApp>;
