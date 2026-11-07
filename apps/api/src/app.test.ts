import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.ts';
import { MAX_REQUEST_BODY_BYTES } from './lib/body-size.ts';
import { type TestApp, createTestApp } from './test-support/test-app.ts';

let harness: TestApp;

function appWith(checkDatabase: () => Promise<void>) {
  return createApp({
    checkDatabase,
    db: harness.db,
    auth: harness.auth,
    mailer: { send: () => Promise.resolve() },
    imageStorage: harness.imageStorage,
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

describe('request body limit', () => {
  const oversized = 'x'.repeat(MAX_REQUEST_BODY_BYTES + 1);

  function chunked(body: string): ReadableStream<Uint8Array> {
    return new Blob([body]).stream();
  }

  it.each([
    ['a v1 route', '/api/v1/setup'],
    ['an auth route', '/api/auth/sign-in/username'],
    ['the upload route, when the body is not multipart', `/api/v1/series/${randomUUID()}/images`],
  ])('refuses too much JSON on %s, by Content-Length', async (_name, path) => {
    const response = await appWith(healthy).request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: oversized,
    });
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: { code: 'request_too_large' } });
  });

  it.each([
    ['a v1 route', '/api/v1/setup'],
    ['an auth route', '/api/auth/sign-in/username'],
  ])('refuses too much JSON on %s with no Content-Length', async (_name, path) => {
    const response = await appWith(healthy).request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: chunked(oversized),
      duplex: 'half',
    });
    expect(response.status).toBe(413);
  });

  it('refuses a form sent to an auth route, which Better Auth would parse', async () => {
    const response = await appWith(healthy).request('/api/auth/sign-in/username', {
      method: 'POST',
      headers: { 'Content-Type': 'multipart/form-data; boundary=x' },
      body: oversized,
    });
    expect(response.status).toBe(413);
  });

  it('lets a body under the limit reach the route, with or without Content-Length', async () => {
    const body = JSON.stringify({ username: 'x'.repeat(MAX_REQUEST_BODY_BYTES / 2) });
    for (const init of [{ body }, { body: chunked(body), duplex: 'half' }] as RequestInit[]) {
      const response = await appWith(healthy).request('/api/v1/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        ...init,
      });
      expect(response.status).toBe(400);
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

describe('the default cache policy', () => {
  it('stops a shared cache keeping what does not state its own', async () => {
    const response = await appWith(healthy).request('/api/v1/health');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('leaves a route its own policy', async () => {
    const response = await appWith(healthy).request('/api/v1/invites/not-a-real-token');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});
