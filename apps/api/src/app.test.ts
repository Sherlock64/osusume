import { describe, expect, it } from 'vitest';
import { createApp } from './app.ts';

const healthy = createApp({ checkDatabase: () => Promise.resolve() });

describe('health endpoints', () => {
  it('reports liveness without touching the database', async () => {
    const app = createApp({
      checkDatabase: () => Promise.reject(new Error('database is down')),
    });
    const response = await app.request('/api/v1/health');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('reports ready when the database answers', async () => {
    const response = await healthy.request('/api/v1/health/ready');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ready' });
  });

  it('reports unavailable when the database does not answer', async () => {
    const app = createApp({
      checkDatabase: () => Promise.reject(new Error('database is down')),
    });
    const response = await app.request('/api/v1/health/ready');
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: 'unavailable' });
  });
});

describe('OpenAPI document', () => {
  it('is served at /api/v1/openapi.json and lists the routes', async () => {
    const response = await healthy.request('/api/v1/openapi.json');
    expect(response.status).toBe(200);
    const document = (await response.json()) as { servers: unknown; paths: Record<string, unknown> };
    expect(document.servers).toEqual([{ url: '/api/v1' }]);
    expect(Object.keys(document.paths).sort()).toEqual(['/health', '/health/ready']);
  });
});

describe('routing', () => {
  it('serves nothing outside /api/v1', async () => {
    expect((await healthy.request('/health')).status).toBe(404);
  });
});
