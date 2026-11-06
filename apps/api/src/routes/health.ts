import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { livenessResponseSchema, readinessResponseSchema } from '@osusume/shared';

const livenessRoute = createRoute({
  method: 'get',
  path: '/health',
  summary: 'Liveness: the process is serving requests',
  responses: {
    200: {
      description: 'The api is alive',
      content: { 'application/json': { schema: livenessResponseSchema } },
    },
  },
});

const readinessRoute = createRoute({
  method: 'get',
  path: '/health/ready',
  summary: 'Readiness: the api can reach its database',
  responses: {
    200: {
      description: 'The api can serve traffic',
      content: { 'application/json': { schema: readinessResponseSchema } },
    },
    503: {
      description: 'The database is unreachable',
      content: { 'application/json': { schema: readinessResponseSchema } },
    },
  },
});

export function healthRoutes(checkDatabase: () => Promise<void>) {
  return new OpenAPIHono()
    .openapi(livenessRoute, (c) => c.json({ status: 'ok' as const }, 200))
    .openapi(readinessRoute, async (c) => {
      try {
        await checkDatabase();
        return c.json({ status: 'ready' as const }, 200);
      } catch (error) {
        console.error('Readiness check failed:', error);
        return c.json({ status: 'unavailable' as const }, 503);
      }
    });
}
