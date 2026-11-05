import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  emailBlacklist,
  emailChangeRequest,
  inviteRequest,
  session,
  user,
  verification,
} from '../db/schema.ts';
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
let first: Awaited<ReturnType<TestApp['seedLoggedIn']>>;
let admin: Awaited<ReturnType<TestApp['seedLoggedIn']>>;

beforeAll(async () => {
  t = await createTestApp();
  first = await t.seedLoggedIn({ role: 'admin', isFirstAdmin: true });
  admin = await t.seedLoggedIn({ role: 'admin' });
});

afterAll(async () => {
  await t.cleanup();
});

const act = (id: string, action: string, cookie = admin.cookie) =>
  t.request('POST', `/api/v1/admin/users/${id}/${action}`, undefined, { cookie });

const actions = ['promote', 'demote', 'disable', 'enable', 'remove', 'ban'];

async function canLogin(username: string, password = PASSWORD) {
  const response = await t.request('POST', '/api/auth/sign-in/username', { username, password });
  return response.status;
}

describe('GET /admin/users', () => {
  it('is admin only', async () => {
    const member = await t.seedLoggedIn();
    expectError(await t.request('GET', '/api/v1/admin/users'), 401, 'unauthenticated');
    expectError(await t.request('GET', '/api/v1/admin/users', undefined, { cookie: member.cookie }), 403, 'admin_required');
  });

  it('pages through every user once, with no secrets', async () => {
    for (let i = 0; i < 3; i += 1) await t.seedUser();
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const query: string = cursor === null ? '' : `&cursor=${cursor}`;
      const response = await t.request('GET', `/api/v1/admin/users?limit=2${query}`, undefined, { cookie: admin.cookie });
      expect(response.status).toBe(200);
      const body = response.body as { items: { id: string }[]; nextCursor: string | null };
      expect(body.items.length).toBeLessThanOrEqual(2);
      seen.push(...body.items.map((item) => item.id));
      expect(JSON.stringify(body)).not.toMatch(/password|tokenHash/i);
      cursor = body.nextCursor;
    } while (cursor !== null);

    const all = await t.db.select({ id: user.id }).from(user);
    expect(seen.sort()).toEqual(all.map((row) => row.id).sort());
  });

  it('shows the capitalized username and the first admin flag', async () => {
    const response = await t.request('GET', '/api/v1/admin/users?limit=100', undefined, { cookie: admin.cookie });
    const { items } = response.body as { items: { id: string }[] };
    expect(items.find((item) => item.id === first.id)).toMatchObject({
      username: first.enteredUsername,
      isFirstAdmin: true,
      role: 'admin',
      disabledAt: null,
    });
  });
});

describe('every action', () => {
  it.each(actions)('%s is admin only', async (action) => {
    const member = await t.seedLoggedIn();
    const target = await t.seedUser();
    expectError(await t.request('POST', `/api/v1/admin/users/${target.id}/${action}`), 401, 'unauthenticated');
    expectError(await act(target.id, action, member.cookie), 403, 'admin_required');
    expect(await t.db.select().from(user).where(eq(user.id, target.id))).toHaveLength(1);
  });

  it.each(actions)('%s refuses the first admin, whoever asks', async (action) => {
    expectError(await act(first.id, action, admin.cookie), 403, 'first_admin_protected');
    expectError(await act(first.id, action, first.cookie), 403, 'first_admin_protected');
    const [row] = await t.db.select().from(user).where(eq(user.id, first.id));
    expect(row).toMatchObject({ role: 'admin', disabledAt: null, isFirstAdmin: true });
    expect(await t.db.select().from(emailBlacklist).where(eq(emailBlacklist.email, first.email))).toEqual([]);
    expect((await t.request('GET', '/api/v1/admin/users?limit=1', undefined, { cookie: first.cookie })).status).toBe(200);
  });

  it.each(actions)('%s refuses your own account', async (action) => {
    const self = await t.seedLoggedIn({ role: 'admin' });
    expectError(await act(self.id, action, self.cookie), 403, 'cannot_target_self');
    const [row] = await t.db.select().from(user).where(eq(user.id, self.id));
    expect(row).toMatchObject({ role: 'admin', disabledAt: null });
  });

  it.each(actions)('%s answers 404 for an unknown user', async (action) => {
    expectError(await act('00000000-0000-4000-8000-000000000000', action), 404, 'user_not_found');
  });

  it.each(actions)('%s answers 400 for a malformed id', async (action) => {
    expectError(await act('not-a-uuid', action), 400, 'validation_error');
  });
});

describe('promote and demote', () => {
  it('apply immediately, including to a session already open', async () => {
    const member = await t.seedLoggedIn();
    expectError(await t.request('GET', '/api/v1/admin/users', undefined, { cookie: member.cookie }), 403, 'admin_required');

    const promoted = await act(member.id, 'promote');
    expect(promoted.body).toMatchObject({ role: 'admin' });
    expect((await t.request('GET', '/api/v1/admin/users', undefined, { cookie: member.cookie })).status).toBe(200);

    const demoted = await act(member.id, 'demote');
    expect(demoted.body).toMatchObject({ role: 'member' });
    expectError(await t.request('GET', '/api/v1/admin/users', undefined, { cookie: member.cookie }), 403, 'admin_required');
  });

  it('lets an admin demote another admin', async () => {
    const other = await t.seedUser({ role: 'admin' });
    expect((await act(other.id, 'demote')).body).toMatchObject({ role: 'member' });
  });
});

describe('disable and enable', () => {
  it('signs out immediately, blocks login, and reverses', async () => {
    const member = await t.seedLoggedIn();

    const disabled = await act(member.id, 'disable');
    expect(disabled.status).toBe(200);
    expect(disabled.body).toMatchObject({ disabledAt: expect.any(String) as string });

    expect(await t.db.select().from(session).where(eq(session.userId, member.id))).toEqual([]);
    expectError(await t.request('GET', '/api/v1/invite-requests', undefined, { cookie: member.cookie }), 401, 'unauthenticated');
    expect((await t.request('GET', '/api/auth/get-session', undefined, { cookie: member.cookie })).body).toBeNull();

    const login = await t.request('POST', '/api/auth/sign-in/username', {
      username: member.username,
      password: PASSWORD,
    });
    expect(login.status).toBe(403);
    expect(login.body).toMatchObject({ code: 'ACCOUNT_DISABLED' });
    expect(login.headers.get('set-cookie')).toBeNull();

    const enabled = await act(member.id, 'enable');
    expect(enabled.body).toMatchObject({ disabledAt: null });
    expect(await canLogin(member.username)).toBe(200);
  });

  it('kills outstanding links and sends no reset email while disabled', async () => {
    const member = await t.seedLoggedIn();
    await t.request('POST', '/api/auth/request-password-reset', { email: member.email });
    const resetToken = tokenFrom(await waitForMail(member.email));
    const newEmail = uniqueEmail('pending');
    await t.request('POST', '/api/v1/me/email', { currentPassword: PASSWORD, newEmail }, { cookie: member.cookie });
    const emailToken = tokenFrom(await waitForMail(newEmail));

    await act(member.id, 'disable');

    expect((await t.request('POST', '/api/auth/reset-password', { token: resetToken, newPassword: 'another password' })).status).toBe(400);
    expectError(await t.request('POST', '/api/v1/me/email/verify', { token: emailToken }), 404, 'token_invalid');
    expect(await t.db.select().from(emailChangeRequest).where(eq(emailChangeRequest.userId, member.id))).toEqual([]);

    await t.request('POST', '/api/auth/request-password-reset', { email: member.email });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(await mailsTo(member.email)).toHaveLength(1);
  });

  it('never leaves a session behind when a login races the disable', async () => {
    const member = await t.seedUser();
    const logins = Array.from({ length: 3 }, () =>
      t.request('POST', '/api/auth/sign-in/username', { username: member.username, password: PASSWORD }),
    );
    const [disable] = await Promise.all([act(member.id, 'disable'), ...logins]);
    expect(disable.status).toBe(200);
    expect(await t.db.select().from(session).where(eq(session.userId, member.id))).toEqual([]);
  });

  it('disabling twice keeps the original time', async () => {
    const member = await t.seedUser();
    const once = await act(member.id, 'disable');
    const twice = await act(member.id, 'disable');
    expect((twice.body as { disabledAt: string }).disabledAt).toBe((once.body as { disabledAt: string }).disabledAt);
  });
});

describe('remove', () => {
  it('deletes the account and everything it owns, and the email can be invited again', async () => {
    const member = await t.seedLoggedIn();
    await t.request('POST', '/api/auth/request-password-reset', { email: member.email });
    await waitForMail(member.email);
    await t.db
      .insert(inviteRequest)
      .values({ requesterId: admin.id, inviteeEmail: member.email, status: 'accepted' });

    expect((await act(member.id, 'remove')).status).toBe(204);

    expect(await t.db.select().from(user).where(eq(user.id, member.id))).toEqual([]);
    expect(await t.db.select().from(verification).where(eq(verification.value, member.id))).toEqual([]);
    expect(
      await t.db.select().from(inviteRequest).where(eq(inviteRequest.inviteeEmail, member.email)),
    ).toEqual([]);
    expectError(await t.request('GET', '/api/v1/invite-requests', undefined, { cookie: member.cookie }), 401, 'unauthenticated');
    expect(await canLogin(member.username)).toBe(401);
    expect(await t.db.select().from(emailBlacklist).where(eq(emailBlacklist.email, member.email))).toEqual([]);

    const again = await t.request('POST', '/api/v1/invite-requests', { email: member.email }, { cookie: admin.cookie });
    expect(again.status).toBe(201);
  });

  it('kills a reset link at once', async () => {
    const member = await t.seedLoggedIn();
    await t.request('POST', '/api/auth/request-password-reset', { email: member.email });
    const token = tokenFrom(await waitForMail(member.email));
    await act(member.id, 'remove');
    expect((await t.request('POST', '/api/auth/reset-password', { token, newPassword: 'another password' })).status).toBe(400);
  });
});

describe('ban', () => {
  it('deletes the account and blacklists its current email', async () => {
    const member = await t.seedLoggedIn({ email: uniqueEmail('BANNED').toLowerCase() });
    await t.db
      .insert(inviteRequest)
      .values({ requesterId: admin.id, inviteeEmail: member.email, status: 'accepted' });

    expect((await act(member.id, 'ban')).status).toBe(204);

    expect(await t.db.select().from(user).where(eq(user.id, member.id))).toEqual([]);
    const [blacklisted] = await t.db
      .select()
      .from(emailBlacklist)
      .where(sql`lower(${emailBlacklist.email}) = ${member.email}`);
    expect(blacklisted?.bannedBy).toBe(admin.id);
    expect(
      await t.db.select().from(inviteRequest).where(eq(inviteRequest.inviteeEmail, member.email)),
    ).toEqual([]);
    expectError(
      await t.request('POST', '/api/v1/invite-requests', { email: member.email.toUpperCase() }, { cookie: admin.cookie }),
      409,
      'email_blacklisted',
    );
  });

  it('blacklists only the current address after an email change', async () => {
    const member = await t.seedLoggedIn();
    const oldEmail = member.email;
    const newEmail = uniqueEmail('moved');
    await t.request('POST', '/api/v1/me/email', { currentPassword: PASSWORD, newEmail }, { cookie: member.cookie });
    const token = tokenFrom(await waitForMail(newEmail));
    await t.request('POST', '/api/v1/me/email/verify', { token });

    await act(member.id, 'ban');

    const invited = (email: string) => t.request('POST', '/api/v1/invite-requests', { email }, { cookie: admin.cookie });
    expectError(await invited(newEmail), 409, 'email_blacklisted');
    expect((await invited(oldEmail)).status).toBe(201);
  });

  it('is one transaction: nothing is blacklisted if the delete fails', async () => {
    const member = await t.seedUser();
    await t.pool.query(`
      CREATE FUNCTION test_fail_delete() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'delete failed on purpose'; END; $$`);
    await t.pool.query(`
      CREATE TRIGGER test_fail_delete BEFORE DELETE ON "user" FOR EACH ROW
      WHEN (OLD.id = '${member.id}') EXECUTE FUNCTION test_fail_delete()`);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect((await act(member.id, 'ban')).status).toBe(500);
    } finally {
      errors.mockRestore();
      await t.pool.query(`DROP TRIGGER test_fail_delete ON "user"`);
      await t.pool.query(`DROP FUNCTION test_fail_delete`);
    }
    expect(await t.db.select().from(emailBlacklist).where(eq(emailBlacklist.email, member.email))).toEqual([]);
    expect(await t.db.select().from(user).where(eq(user.id, member.id))).toHaveLength(1);
  });

  it('wins or loses cleanly against a request for the same address', async () => {
    const member = await t.seedUser();
    const [banned, requested] = await Promise.all([
      act(member.id, 'ban'),
      t.request('POST', '/api/v1/invite-requests', { email: member.email }, { cookie: admin.cookie }),
    ]);
    expect(banned.status).toBe(204);
    expect(requested.status).toBe(409);
    expect(
      await t.db.select().from(inviteRequest).where(eq(inviteRequest.inviteeEmail, member.email)),
    ).toEqual([]);
  });

  it('leaves no account on the banned address when an invite for it is accepted at the same time', async () => {
    // An invite stays approved if its address later reaches an account by an email change.
    const member = await t.seedUser();
    const token = 'race-with-a-ban';
    await t.db.insert(inviteRequest).values({
      requesterId: admin.id,
      inviteeEmail: member.email,
      status: 'approved',
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + 60_000),
    });

    const [banned, accepted] = await Promise.all([
      act(member.id, 'ban'),
      t.request('POST', `/api/v1/invites/${token}/accept`, {
        username: uniqueUsername('Late'),
        password: PASSWORD,
      }),
    ]);

    expect(banned.status).toBe(204);
    expect([404, 409]).toContain(accepted.status);
    expect(await t.db.select().from(user).where(eq(user.email, member.email))).toEqual([]);
  });
});

describe('an address wanted by both an email change and an invite', () => {
  it('ends up on exactly one account', async () => {
    const contested = uniqueEmail('both');
    const member = await t.seedLoggedIn();
    await t.request('POST', '/api/v1/me/email', { currentPassword: PASSWORD, newEmail: contested }, { cookie: member.cookie });
    const changeToken = tokenFrom(await waitForMail(contested));
    const created = await t.request('POST', '/api/v1/invite-requests', { email: contested }, { cookie: admin.cookie });
    const { id } = created.body as { id: string };
    await t.request('POST', `/api/v1/admin/invite-requests/${id}/decision`, { decision: 'approve' }, { cookie: admin.cookie });
    const inviteToken = tokenFrom(await waitForMail(contested, 2));

    const responses = await Promise.all([
      t.request('POST', '/api/v1/me/email/verify', { token: changeToken }),
      t.request('POST', `/api/v1/invites/${encodeURIComponent(inviteToken)}/accept`, {
        username: uniqueUsername('Both'),
        password: PASSWORD,
      }),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409].sort());
  });
});
