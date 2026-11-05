import { eq, like } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { account, user, verification } from '../db/schema.ts';
import { hashToken } from '../lib/tokens.ts';
import { mailsTo, tokenFrom, waitForMail } from '../test-support/mailpit.ts';
import {
  PASSWORD,
  type TestApp,
  createTestApp,
  expectError,
  uniqueEmail,
  uniqueUsername,
} from '../test-support/test-app.ts';

let t: TestApp;

beforeEach(async () => {
  t = await createTestApp();
});

afterEach(async () => {
  await t.cleanup();
});

function form(overrides: Record<string, unknown> = {}) {
  return { username: uniqueUsername('Owner'), email: uniqueEmail('owner'), password: PASSWORD, ...overrides };
}

async function startSetup(values = form()) {
  const response = await t.request('POST', '/api/v1/setup', values);
  expect(response.status).toBe(202);
  return { ...values, token: tokenFrom(await waitForMail(values.email)) };
}

const verify = (token: string) => t.request('POST', '/api/v1/setup/verify', { token });
const status = () => t.request('GET', '/api/v1/setup/status');

describe('first-run setup', () => {
  it('stays open and creates no account until the link is clicked', async () => {
    expect((await status()).body).toEqual({ open: true });

    const started = await startSetup();

    expect(await t.db.select().from(user)).toEqual([]);
    expect((await status()).body).toEqual({ open: true });
    expect(started.token.length).toBeGreaterThan(20);
  });

  it('creates the permanent first admin when the link is clicked, then closes', async () => {
    const started = await startSetup();

    const response = await verify(started.token);
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      username: started.username,
      email: started.email,
      role: 'admin',
    });
    expect(response.body).not.toHaveProperty('isFirstAdmin');

    const [row] = await t.db.select().from(user);
    expect(row).toMatchObject({
      isFirstAdmin: true,
      role: 'admin',
      emailVerified: true,
      displayUsername: started.username,
      username: started.username.toLowerCase(),
    });

    expect((await status()).body).toEqual({ open: false });
    await t.login(started.username);
    expectError(await t.request('POST', '/api/v1/setup', form()), 409, 'setup_closed');
  });

  it('does not store the raw token or the plain password', async () => {
    const started = await startSetup();
    const rows = await t.db.select().from(verification);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.identifier).toBe(`first-run-setup:${hashToken(started.token)}`);
    expect(rows[0]?.value).not.toContain(started.password);
    expect(rows[0]?.value).not.toContain(started.token);
  });

  it('leaves no pending setup behind once complete, including password hashes', async () => {
    const first = await startSetup();
    await startSetup();
    expect(await t.db.select().from(verification)).toHaveLength(2);

    expect((await verify(first.token)).status).toBe(201);

    expect(await t.db.select().from(verification)).toEqual([]);
  });

  it('refuses a stale second link after the first completes', async () => {
    const first = await startSetup();
    const second = await startSetup();

    expect((await verify(first.token)).status).toBe(201);
    expectError(await verify(second.token), 409, 'setup_closed');
    expectError(await verify(first.token), 409, 'setup_closed');

    expect(await t.db.select().from(user)).toHaveLength(1);
  });

  it('creates exactly one first admin when links are clicked at the same time', async () => {
    const started = await Promise.all([startSetup(), startSetup(), startSetup(), startSetup()]);

    const responses = await Promise.all(started.map((setup) => verify(setup.token)));

    expect(responses.map((response) => response.status).sort()).toEqual([201, 409, 409, 409]);
    const admins = await t.db.select().from(user);
    expect(admins).toHaveLength(1);
    expect(admins[0]?.isFirstAdmin).toBe(true);
    expect(await t.db.select().from(account)).toHaveLength(1);
  });

  it('creates exactly one when the same link is clicked twice at once', async () => {
    const started = await startSetup();
    const responses = await Promise.all([verify(started.token), verify(started.token)]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(await t.db.select().from(user)).toHaveLength(1);
  });

  it('refuses setup started while another completes without leaving a row behind', async () => {
    const started = await startSetup();
    const [completed] = await Promise.all([
      verify(started.token),
      t.request('POST', '/api/v1/setup', form()),
    ]);
    expect(completed.status).toBe(201);
    expect(
      await t.db.select().from(verification).where(like(verification.identifier, 'first-run-setup:%')),
    ).toEqual([]);
  });

  it('refuses an unknown or expired link and stays open', async () => {
    expectError(await verify('not-a-real-token'), 404, 'token_invalid');

    const started = await startSetup();
    await t.db
      .update(verification)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(verification.identifier, `first-run-setup:${hashToken(started.token)}`));
    expectError(await verify(started.token), 404, 'token_invalid');

    expect(await t.db.select().from(user)).toEqual([]);
    expect((await status()).body).toEqual({ open: true });
  });

  it('is closed when any account exists', async () => {
    await t.seedUser();
    expect((await status()).body).toEqual({ open: false });
    const values = form();
    expectError(await t.request('POST', '/api/v1/setup', values), 409, 'setup_closed');
    expect(await mailsTo(values.email)).toEqual([]);
  });

  it.each([
    ['a short password', { password: 'short' }],
    ['an invalid email', { email: 'not-an-email' }],
    ['a short username', { username: 'ab' }],
    ['a username with other characters', { username: 'has space' }],
  ])('refuses %s', async (_label, overrides) => {
    expectError(await t.request('POST', '/api/v1/setup', form(overrides)), 400, 'validation_error');
  });

  it('ignores an attempt to set extra fields', async () => {
    const started = await startSetup(
      form({ role: 'member', isFirstAdmin: false, emailVerified: false }),
    );
    expect((await verify(started.token)).status).toBe(201);
    const [row] = await t.db.select().from(user);
    expect(row).toMatchObject({ role: 'admin', isFirstAdmin: true, emailVerified: true });
  });

  it('keeps nothing when the email cannot be sent', async () => {
    const failing = await createTestApp({
      mailer: { send: () => Promise.reject(new Error('smtp is down')) },
    });
    try {
      expectError(await failing.request('POST', '/api/v1/setup', form()), 503, 'email_failed');
      expect(await failing.db.select().from(verification)).toEqual([]);
    } finally {
      await failing.cleanup();
    }
  });
});
