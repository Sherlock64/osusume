import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { session, user } from '../db/schema.ts';
import {
  PASSWORD,
  type TestApp,
  createTestApp,
  expectError,
  uniqueEmail,
  uniqueUsername,
} from '../test-support/test-app.ts';

let t: TestApp;

beforeAll(async () => {
  t = await createTestApp();
});

afterAll(async () => {
  await t.cleanup();
});

describe('Better Auth surface', () => {
  it.each([
    ['POST', '/sign-up/email'],
    ['POST', '/sign-in/email'],
    ['POST', '/sign-in/social'],
    ['POST', '/update-user'],
    ['POST', '/change-email'],
    ['POST', '/delete-user'],
    ['POST', '/is-username-available'],
    ['POST', '/send-verification-email'],
    ['POST', '/link-social'],
    ['POST', '/set-password'],
    ['GET', '/list-sessions'],
    ['GET', '/list-accounts'],
    ['GET', '/verify-email'],
    ['GET', '/reset-password/some-token'],
  ])('%s %s is not reachable', async (method, path) => {
    const response = await t.request(
      method,
      `/api/auth${path}`,
      method === 'POST' ? { email: uniqueEmail(), password: PASSWORD, name: 'x', username: 'someone' } : undefined,
    );
    expect(response.status).toBe(404);
  });

  it('has public signup turned off even where it is called directly', async () => {
    await expect(
      t.auth.api.signUpEmail({
        body: { email: uniqueEmail(), password: PASSWORD, name: 'direct', username: 'direct_call' },
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(await t.db.select().from(user).where(eq(user.username, 'direct_call'))).toEqual([]);
  });

  it('sends no CORS headers', async () => {
    const response = await t.request('GET', '/api/auth/get-session', undefined, {
      origin: 'https://elsewhere.example.test',
    });
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('refuses a request carrying a session cookie from another origin', async () => {
    const member = await t.seedLoggedIn();
    const response = await t.request(
      'POST',
      '/api/auth/change-password',
      { currentPassword: PASSWORD, newPassword: 'a different password' },
      { origin: 'https://elsewhere.example.test', cookie: member.cookie },
    );
    expect(response.status).toBe(403);
    await t.login(member.username);
  });
});

describe('logging in', () => {
  it('works by username in any capitalization and shows the entered one', async () => {
    const entered = `${uniqueUsername('Mixed')}X`;
    await t.seedUser({ username: entered });

    for (const attempt of [entered, entered.toLowerCase(), entered.toUpperCase()]) {
      const response = await t.request('POST', '/api/auth/sign-in/username', {
        username: attempt,
        password: PASSWORD,
      });
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        user: { displayUsername: entered, username: entered.toLowerCase() },
      });
    }
  });

  it('refuses a wrong password and an unknown username the same way', async () => {
    const member = await t.seedUser();
    const wrong = await t.request('POST', '/api/auth/sign-in/username', {
      username: member.username,
      password: 'not the password',
    });
    const unknown = await t.request('POST', '/api/auth/sign-in/username', {
      username: uniqueUsername('nobody'),
      password: 'not the password',
    });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
  });

  it('issues a uuid session and an http-only cookie', async () => {
    const member = await t.seedUser();
    const response = await t.request('POST', '/api/auth/sign-in/username', {
      username: member.username,
      password: PASSWORD,
    });
    const cookie = response.headers.get('set-cookie')?.toLowerCase();
    expect(cookie).toContain('httponly');
    expect(cookie).toContain('samesite=lax');
    const [row] = await t.db.select().from(session).where(eq(session.userId, member.id));
    expect(row?.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('signs out', async () => {
    const member = await t.seedLoggedIn();
    expect((await t.request('POST', '/api/auth/sign-out', {}, { cookie: member.cookie })).status).toBe(200);
    expectError(await t.request('GET', '/api/v1/username-change-requests', undefined, { cookie: member.cookie }), 401, 'unauthenticated');
  });
});

describe('rate limiting', () => {
  it('limits login attempts from one client', async () => {
    const ip = '192.0.2.10';
    const attempt = () =>
      t.request(
        'POST',
        '/api/auth/sign-in/username',
        { username: 'nobody_here', password: 'not the password' },
        { ip },
      );
    const statuses = [];
    for (let i = 0; i < 4; i += 1) statuses.push((await attempt()).status);
    expect(statuses).toEqual([401, 401, 401, 429]);

    // Another client is unaffected.
    const other = await t.request('POST', '/api/auth/sign-in/username', {
      username: 'nobody_here',
      password: 'not the password',
    });
    expect(other.status).toBe(401);
  });

  it('limits password reset requests from one client', async () => {
    const ip = '192.0.2.11';
    const statuses = [];
    for (let i = 0; i < 4; i += 1) {
      const response = await t.request(
        'POST',
        '/api/auth/request-password-reset',
        { email: uniqueEmail('nobody') },
        { ip },
      );
      statuses.push(response.status);
    }
    expect(statuses).toEqual([200, 200, 200, 429]);
  });
});

describe('authorization middleware', () => {
  it('rejects anonymous requests', async () => {
    expectError(await t.request('GET', '/api/v1/username-change-requests'), 401, 'unauthenticated');
    expectError(await t.request('GET', '/api/v1/admin/users'), 401, 'unauthenticated');
  });

  it('rejects a forged cookie', async () => {
    expectError(
      await t.request('GET', '/api/v1/username-change-requests', undefined, {
        cookie: 'better-auth.session_token=forged.value',
      }),
      401,
      'unauthenticated',
    );
  });

  it('rejects members from admin routes', async () => {
    const member = await t.seedLoggedIn();
    expectError(await t.request('GET', '/api/v1/admin/users', undefined, { cookie: member.cookie }), 403, 'admin_required');
  });

  it('reads the role on every request, so a change applies at once', async () => {
    const admin = await t.seedLoggedIn({ role: 'admin' });
    const allowed = await t.request('GET', '/api/v1/admin/users', undefined, { cookie: admin.cookie });
    expect(allowed.status).toBe(200);
    await t.db.update(user).set({ role: 'member' }).where(eq(user.id, admin.id));
    expectError(await t.request('GET', '/api/v1/admin/users', undefined, { cookie: admin.cookie }), 403, 'admin_required');
  });

  it('rejects a disabled user who somehow still has a session', async () => {
    const member = await t.seedLoggedIn();
    await t.db.update(user).set({ disabledAt: new Date() }).where(eq(user.id, member.id));
    expectError(await t.request('GET', '/api/v1/username-change-requests', undefined, { cookie: member.cookie }), 403, 'account_disabled');
  });

  it('has no user search', async () => {
    const admin = await t.seedLoggedIn({ role: 'admin' });
    for (const path of ['/api/v1/users', '/api/v1/users/search?q=a', '/api/v1/members']) {
      expect((await t.request('GET', path, undefined, { cookie: admin.cookie })).status).toBe(404);
    }
  });
});
