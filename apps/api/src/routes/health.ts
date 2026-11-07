import { Hono } from 'hono';

export function healthRoutes(checkDatabase: () => Promise<void>) {
  return new Hono()
    // Liveness: the process is serving requests
    .get('/health', (c) => c.json({ status: 'ok' as const }, 200))
    // Readiness: the api can reach its database
    .get('/health/ready', async (c) => {
      try {
        await checkDatabase();
        return c.json({ status: 'ready' as const }, 200);
      } catch (error) {
        console.error('Readiness check failed:', error);
        return c.json({ status: 'unavailable' as const }, 503);
      }
    });
}
