import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.ts';
import { type TestApp, createTestApp } from './test-support/test-app.ts';

let harness: TestApp;

function appWith(checkDatabase: () => Promise<void>) {
  return createApp({
    checkDatabase,
    db: harness.db,
    auth: harness.auth,
    mailer: { send: () => Promise.resolve() },
    publicBaseUrl: 'http://osusume.test',
  });
}

const databaseDown = () => Promise.reject(new Error('database is down'));
const healthy = () => Promise.resolve();

beforeAll(async () => {
  harness = await createTestApp();
});

afterAll(async () => {
  await harness.cleanup();
});

describe('health endpoints', () => {
  it('reports liveness without touching the database', async () => {
    const response = await appWith(databaseDown).request('/api/v1/health');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('reports ready when the database answers', async () => {
    const response = await appWith(healthy).request('/api/v1/health/ready');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ready' });
  });

  it('reports unavailable when the database does not answer', async () => {
    const response = await appWith(databaseDown).request('/api/v1/health/ready');
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: 'unavailable' });
  });
});

describe('OpenAPI document', () => {
  it('is served at /api/v1/openapi.json and lists the routes', async () => {
    const response = await appWith(healthy).request('/api/v1/openapi.json');
    expect(response.status).toBe(200);
    const document = (await response.json()) as { servers: unknown; paths: Record<string, unknown> };
    expect(document.servers).toEqual([{ url: '/api/v1' }]);
    expect(Object.keys(document.paths).sort()).toEqual([
      '/admin/catalog-requests',
      '/admin/catalog-requests/{id}/decision',
      '/admin/invite-requests',
      '/admin/invite-requests/{id}/decision',
      '/admin/invite-requests/{id}/revoke',
      '/admin/username-change-requests',
      '/admin/username-change-requests/{id}/decision',
      '/admin/users',
      '/admin/users/{id}/ban',
      '/admin/users/{id}/demote',
      '/admin/users/{id}/disable',
      '/admin/users/{id}/enable',
      '/admin/users/{id}/promote',
      '/admin/users/{id}/remove',
      '/catalog-requests',
      '/health',
      '/health/ready',
      '/invite-requests',
      '/invites/{token}',
      '/invites/{token}/accept',
      '/me',
      '/me/email',
      '/me/email/verify',
      '/seasons',
      '/seasons/{id}',
      '/series',
      '/series/{id}',
      '/setup',
      '/setup/status',
      '/setup/verify',
      '/tags',
      '/tags/{id}',
      '/username-change-requests',
    ]);
  });

  it('never describes secrets', async () => {
    const response = await appWith(healthy).request('/api/v1/openapi.json');
    const text = await response.text();
    for (const secret of ['tokenHash', 'token_hash', 'passwordHash', 'accessToken']) {
      expect(text).not.toContain(secret);
    }
  });
});

describe('routing', () => {
  it('serves nothing outside /api/v1 and /api/auth', async () => {
    expect((await appWith(healthy).request('/health')).status).toBe(404);
  });

  it('reports a malformed JSON body as a client error', async () => {
    const response = await appWith(healthy).request('http://osusume.test/api/v1/setup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('bad_request');
  });

  it('reports a failed validation in the error shape without echoing the value', async () => {
    const response = await appWith(healthy).request('http://osusume.test/api/v1/setup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'someone', email: 'a@example.test', password: 'sho' }),
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('validation_error');
    expect(body.error.message).toContain('password');
    expect(body.error.message).not.toContain('sho');
  });
});
