import { OpenAPIHono } from '@hono/zod-openapi';
import type { ErrorResponse } from '@osusume/shared';
import { HTTPException } from 'hono/http-exception';
import { exposedAuthEndpoints } from './auth/auth.ts';
import type { AppDependencies, AppEnv } from './lib/context.ts';
import { ApiError } from './lib/errors.ts';
import { adminUserRoutes } from './routes/admin-users.ts';
import { catalogRequestRoutes } from './routes/catalog-requests.ts';
import { catalogRoutes } from './routes/catalog.ts';
import { healthRoutes } from './routes/health.ts';
import { imageRoutes } from './routes/images.ts';
import { inviteRoutes } from './routes/invites.ts';
import { meRoutes } from './routes/me.ts';
import { setupRoutes } from './routes/setup.ts';
import { usernameChangeRoutes } from './routes/username-changes.ts';

export type { AppDependencies } from './lib/context.ts';

const AUTH_BASE_PATH = '/api/auth';

export function createApp(dependencies: AppDependencies) {
  const v1 = new OpenAPIHono<AppEnv>();
  v1.use(async (c, next) => {
    c.set('deps', dependencies);
    await next();
  });

  const routes = v1
    .route('/', healthRoutes(dependencies.checkDatabase))
    .route('/', setupRoutes)
    .route('/', inviteRoutes)
    .route('/', meRoutes)
    .route('/', usernameChangeRoutes)
    .route('/', adminUserRoutes)
    .route('/', catalogRoutes)
    .route('/', catalogRequestRoutes)
    .route('/', imageRoutes);

  routes.openAPIRegistry.registerComponent('securitySchemes', 'session', {
    type: 'apiKey',
    in: 'cookie',
    name: 'better-auth.session_token',
    description:
      'The session cookie Better Auth sets at /api/auth/sign-in/username. Over HTTPS its name has the __Secure- prefix.',
  });

  routes.doc('/openapi.json', {
    openapi: '3.0.0',
    info: { title: 'Osusume API', version: '1.0.0' },
    servers: [{ url: '/api/v1' }],
  });

  const app = new OpenAPIHono().route('/api/v1', routes);

  app.on(['GET', 'POST'], `${AUTH_BASE_PATH}/*`, (c) => {
    const endpoints: readonly string[] = exposedAuthEndpoints[c.req.method as 'GET' | 'POST'];
    if (!endpoints.includes(c.req.path.slice(AUTH_BASE_PATH.length))) {
      const body: ErrorResponse = { error: { code: 'not_found', message: 'Not found.' } };
      return c.json(body, 404);
    }
    return dependencies.auth.handler(c.req.raw);
  });

  app.onError((error, c) => {
    if (error instanceof ApiError) {
      const body: ErrorResponse = { error: { code: error.code, message: error.message } };
      return c.json(body, error.status);
    }
    if (error instanceof HTTPException) {
      // Hono raises these for requests it cannot parse, such as a malformed JSON body.
      const body: ErrorResponse = { error: { code: 'bad_request', message: error.message } };
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
