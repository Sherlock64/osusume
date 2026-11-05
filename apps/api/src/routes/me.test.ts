import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
} from '../test-support/test-app.ts';

let t: TestApp;
let admin: Awaited<ReturnType<TestApp['seedLoggedIn']>>;

beforeAll(async () => {
  t = await createTestApp();
  admin = await t.seedLoggedIn({ role: 'admin', isFirstAdmin: true });
});

afterAll(async () => {
  await t.cleanup();
});

const NEW_PASSWORD = 'a different password';

const requestReset = (email: string) =>
  t.request('POST', '/api/auth/request-password-reset', { email });
const reset = (token: string, newPassword = NEW_PASSWORD) =>
  t.request('POST', '/api/auth/reset-password', { token, newPassword });

async function canLogin(username: string, password: string) {
  const response = await t.request('POST', '/api/auth/sign-in/username', { username, password });
  return response.status === 200;
}

describe('password reset', () => {
  it('emails a link to the site that sets a new password', async () => {
    const member = await t.seedUser();
    expect((await requestReset(member.email)).status).toBe(200);
    const mail = await waitForMail(member.email);
    expect(mail.text).toContain('http://osusume.test/reset-password?token=');

    const response = await reset(tokenFrom(mail));

    expect(response.status).toBe(200);
    expect(await canLogin(member.username, NEW_PASSWORD)).toBe(true);
    expect(await canLogin(member.username, PASSWORD)).toBe(false);
  });

  it('answers the same whether or not the account exists', async () => {
    const member = await t.seedUser();
    const known = await requestReset(member.email);
    const unknown = await requestReset(uniqueEmail('nobody'));
    expect(known.status).toBe(unknown.status);
    expect(known.body).toEqual(unknown.body);
  });

  it('finds the account whatever capitalization is entered', async () => {
    const member = await t.seedUser();
    await requestReset(member.email.toUpperCase());
    await waitForMail(member.email);
  });

  it('sends nothing to an address with no account', async () => {
    const nobody = uniqueEmail('nobody');
    await requestReset(nobody);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(await mailsTo(nobody)).toEqual([]);
  });

  it('does not make the caller wait for the email, which would reveal the account', async () => {
    let finish: () => void = () => undefined;
    const blocked = await createTestApp({
      mailer: {
        send: () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      },
    });
    try {
      const member = await blocked.seedUser();
      const response = await blocked.request('POST', '/api/auth/request-password-reset', { email: member.email });
      expect(response.status).toBe(200);
    } finally {
      finish();
      await blocked.cleanup();
    }
  });

  it('gives the link one hour', async () => {
    const member = await t.seedUser();
    await requestReset(member.email);
    await waitForMail(member.email);
    const [row] = await t.db.select().from(verification).where(eq(verification.value, member.id));
    const minutes = ((row?.expiresAt.getTime() ?? 0) - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(59);
    expect(minutes).toBeLessThanOrEqual(60);
  });

  it('holds to the password length limits', async () => {
    const member = await t.seedUser();
    await requestReset(member.email);
    const token = tokenFrom(await waitForMail(member.email));
    expect((await reset(token, 'a'.repeat(11))).status).toBe(400);
    expect((await reset(token, 'a'.repeat(129))).status).toBe(400);
    expect((await reset(token, 'a'.repeat(12))).status).toBe(200);
    expect(await canLogin(member.username, 'a'.repeat(12))).toBe(true);
  });

  it('works once and stores no raw token', async () => {
    const member = await t.seedUser();
    await requestReset(member.email);
    const token = tokenFrom(await waitForMail(member.email));
    const rows = await t.db.select().from(verification).where(eq(verification.value, member.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.identifier).not.toContain(token);

    expect((await reset(token)).status).toBe(200);
    expect((await reset(token, 'yet another password')).status).toBe(400);
  });

  it('refuses a made-up token and a short password', async () => {
    const member = await t.seedUser();
    expect((await reset('made-up-token')).status).toBe(400);
    await requestReset(member.email);
    const token = tokenFrom(await waitForMail(member.email));
    expect((await reset(token, 'short')).status).toBe(400);
  });

  it('signs out existing sessions', async () => {
    const member = await t.seedLoggedIn();
    await requestReset(member.email);
    await reset(tokenFrom(await waitForMail(member.email)));
    expectError(await t.request('GET', '/api/v1/username-change-requests', undefined, { cookie: member.cookie }), 401, 'unauthenticated');
  });
});

describe('changing password while logged in', () => {
  const change = (cookie: string | undefined, body: object) =>
    t.request('POST', '/api/auth/change-password', body, { cookie });

  it('needs a session', async () => {
    expect((await change(undefined, { currentPassword: PASSWORD, newPassword: NEW_PASSWORD })).status).toBe(401);
  });

  it('needs the current password', async () => {
    const member = await t.seedLoggedIn();
    const response = await change(member.cookie, {
      currentPassword: 'wrong password',
      newPassword: NEW_PASSWORD,
    });
    expect(response.status).toBe(400);
    expect(await canLogin(member.username, PASSWORD)).toBe(true);
  });

  it('holds to the password length limits', async () => {
    const member = await t.seedLoggedIn();
    for (const newPassword of ['a'.repeat(11), 'a'.repeat(129)]) {
      const response = await change(member.cookie, { currentPassword: PASSWORD, newPassword });
      expect(response.status).toBe(400);
    }
    expect(await canLogin(member.username, PASSWORD)).toBe(true);
    const accepted = await change(member.cookie, {
      currentPassword: PASSWORD,
      newPassword: 'a'.repeat(12),
    });
    expect(accepted.status).toBe(200);
  });

  it('is rate limited', async () => {
    const member = await t.seedLoggedIn();
    const statuses = [];
    for (let i = 0; i < 4; i += 1) {
      const response = await t.request(
        'POST',
        '/api/auth/change-password',
        { currentPassword: 'wrong password', newPassword: NEW_PASSWORD },
        { cookie: member.cookie, ip: '192.0.2.20' },
      );
      statuses.push(response.status);
    }
    expect(statuses).toEqual([400, 400, 400, 429]);
  });

  it('changes the password', async () => {
    const member = await t.seedLoggedIn();
    const response = await change(member.cookie, {
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
    });
    expect(response.status).toBe(200);
    expect(await canLogin(member.username, NEW_PASSWORD)).toBe(true);
    expect(await canLogin(member.username, PASSWORD)).toBe(false);
  });
});

describe('changing email', () => {
  const start = (cookie: string, newEmail: string, currentPassword = PASSWORD) =>
    t.request('POST', '/api/v1/me/email', { currentPassword, newEmail }, { cookie });
  const verify = (token: string) => t.request('POST', '/api/v1/me/email/verify', { token });

  async function started() {
    const member = await t.seedLoggedIn();
    const newEmail = uniqueEmail('changed');
    expect((await start(member.cookie, newEmail)).status).toBe(202);
    return { member, newEmail, token: tokenFrom(await waitForMail(newEmail)) };
  }

  const emailOf = async (id: string) =>
    (await t.db.select({ email: user.email }).from(user).where(eq(user.id, id)))[0]?.email;

  it('needs a session', async () => {
    expectError(
      await t.request('POST', '/api/v1/me/email', { currentPassword: PASSWORD, newEmail: uniqueEmail() }),
      401,
      'unauthenticated',
    );
  });

  it('needs the current password', async () => {
    const member = await t.seedLoggedIn();
    const newEmail = uniqueEmail('unsent');
    expectError(await start(member.cookie, newEmail, 'wrong password'), 403, 'invalid_password');
    expect(await mailsTo(newEmail)).toEqual([]);
  });

  it('applies only when the link goes to the new address and is clicked', async () => {
    const { member, newEmail, token } = await started();
    expect(await emailOf(member.id)).toBe(member.email);
    expect(await mailsTo(member.email)).toEqual([]);

    const response = await verify(token);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ email: newEmail });
    expect(await emailOf(member.id)).toBe(newEmail);
    expect(await t.db.select().from(emailChangeRequest).where(eq(emailChangeRequest.userId, member.id))).toEqual([]);
    // Logging in is by username, so it is unaffected.
    await t.login(member.enteredUsername);
  });

  it('stores the token only as a hash and gives the link 24 hours', async () => {
    const { member, token } = await started();
    const [row] = await t.db.select().from(emailChangeRequest).where(eq(emailChangeRequest.userId, member.id));
    expect(row?.tokenHash).toBe(hashToken(token));
    const hours = ((row?.expiresAt.getTime() ?? 0) - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(23.9);
    expect(hours).toBeLessThanOrEqual(24);
  });

  it('is rate limited per user, whatever the client address', async () => {
    const member = await t.seedLoggedIn();
    const attempt = () => start(member.cookie, uniqueEmail('limited'), 'wrong password');
    expectError(await attempt(), 403, 'invalid_password');
    expectError(await attempt(), 403, 'invalid_password');
    expectError(await attempt(), 403, 'invalid_password');
    const limited = await attempt();
    expectError(limited, 429, 'rate_limited');
    expect(Number(limited.headers.get('x-retry-after'))).toBeGreaterThan(0);
    // The right password is refused too while limited, so guessing gains nothing.
    expectError(await start(member.cookie, uniqueEmail('limited')), 429, 'rate_limited');

    const other = await t.seedLoggedIn();
    expect((await start(other.cookie, uniqueEmail('unlimited'))).status).toBe(202);
  });

  it('revokes open invites for the new address when it applies, and goes through', async () => {
    const { member, newEmail, token } = await started();
    const [pending, approved, expired, rejected] = await t.db
      .insert(inviteRequest)
      .values([
        { requesterId: admin.id, inviteeEmail: newEmail, status: 'pending' },
        {
          requesterId: admin.id,
          inviteeEmail: newEmail.toUpperCase(),
          status: 'approved',
          tokenHash: hashToken('open-for-new-address'),
          expiresAt: new Date(Date.now() + 60_000),
        },
        {
          requesterId: admin.id,
          inviteeEmail: newEmail,
          status: 'approved',
          tokenHash: hashToken('expired-for-new-address'),
          expiresAt: new Date(Date.now() - 60_000),
        },
        { requesterId: admin.id, inviteeEmail: newEmail, status: 'rejected' },
      ])
      .returning();

    expect((await verify(token)).status).toBe(200);

    expect(await emailOf(member.id)).toBe(newEmail);
    const statusOf = async (id: string | undefined) => {
      const [row] = await t.db.select().from(inviteRequest).where(eq(inviteRequest.id, id ?? ''));
      return row;
    };
    expect(await statusOf(pending?.id)).toMatchObject({ status: 'revoked' });
    expect(await statusOf(approved?.id)).toMatchObject({ status: 'revoked', tokenHash: null });
    expect(await statusOf(expired?.id)).toMatchObject({ status: 'approved' });
    expect(await statusOf(rejected?.id)).toMatchObject({ status: 'rejected' });
    expect(
      (await t.request('GET', `/api/v1/invites/open-for-new-address`)).body,
    ).toEqual({ valid: false, email: null });
    expectError(
      await t.request('POST', '/api/v1/invites/open-for-new-address/accept', {
        username: 'too_late_now',
        password: PASSWORD,
      }),
      404,
      'invite_invalid',
    );
  });

  it('leaves open invites for the new address alone until it applies, and if refused', async () => {
    const { newEmail, token } = await started();
    const [open] = await t.db
      .insert(inviteRequest)
      .values({ requesterId: admin.id, inviteeEmail: newEmail, status: 'pending' })
      .returning();
    const pendingStatus = async () =>
      (await t.db.select().from(inviteRequest).where(eq(inviteRequest.id, open?.id ?? '')))[0]?.status;
    expect(await pendingStatus()).toBe('pending');
    await t.db.insert(emailBlacklist).values({ email: newEmail });
    expectError(await verify(token), 409, 'email_change_refused');
    expect(await pendingStatus()).toBe('pending');
  });

  it('refuses a used, unknown or expired link', async () => {
    const used = await started();
    expect((await verify(used.token)).status).toBe(200);
    expectError(await verify(used.token), 409, 'email_change_refused');
    expectError(await verify('not-a-real-token'), 409, 'email_change_refused');

    const expired = await started();
    await t.db
      .update(emailChangeRequest)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(emailChangeRequest.userId, expired.member.id));
    expectError(await verify(expired.token), 409, 'email_change_refused');
    expect(await emailOf(expired.member.id)).toBe(expired.member.email);
  });

  it('asking again replaces the earlier link', async () => {
    const { member, token } = await started();
    const another = uniqueEmail('changed-again');
    expect((await start(member.cookie, another)).status).toBe(202);
    const newest = tokenFrom(await waitForMail(another));
    expectError(await verify(token), 409, 'email_change_refused');
    expect((await verify(newest)).status).toBe(200);
    expect(await emailOf(member.id)).toBe(another);
  });

  it('refuses an address in use or blacklisted, ignoring case', async () => {
    const member = await t.seedLoggedIn();
    const other = await t.seedUser();
    const taken = await start(member.cookie, other.email.toUpperCase());
    expectError(taken, 409, 'email_change_refused');
    expectError(await start(member.cookie, member.email), 409, 'email_change_refused');
    const banned = uniqueEmail('banned');
    await t.db.insert(emailBlacklist).values({ email: banned });
    const refused = await start(member.cookie, banned.toUpperCase());
    expect(refused.body).toEqual(taken.body);
    expect(await mailsTo(banned)).toEqual([]);
  });

  it('tells an admin the specific reason when asking', async () => {
    const asking = await t.seedLoggedIn({ role: 'admin' });
    const other = await t.seedUser();
    expectError(await start(asking.cookie, other.email), 409, 'email_in_use');
    const banned = uniqueEmail('banned');
    await t.db.insert(emailBlacklist).values({ email: banned });
    expectError(await start(asking.cookie, banned), 409, 'email_blacklisted');
  });

  it('refuses at click time when the address has been taken or blacklisted since', async () => {
    const taken = await started();
    await t.seedUser({ email: taken.newEmail });
    const refused = await verify(taken.token);
    expectError(refused, 409, 'email_change_refused');
    expect(refused.body).toEqual((await verify('not-a-real-token')).body);
    expect(await emailOf(taken.member.id)).toBe(taken.member.email);

    const banned = await started();
    await t.db.insert(emailBlacklist).values({ email: banned.newEmail });
    expectError(await verify(banned.token), 409, 'email_change_refused');
    expect(await emailOf(banned.member.id)).toBe(banned.member.email);
  });

  it('tells a logged-in admin the specific reason at click time', async () => {
    const asAdmin = (token: string) =>
      t.request('POST', '/api/v1/me/email/verify', { token }, { cookie: admin.cookie });
    const taken = await started();
    await t.seedUser({ email: taken.newEmail });
    expectError(await asAdmin(taken.token), 409, 'email_in_use');
    const banned = await started();
    await t.db.insert(emailBlacklist).values({ email: banned.newEmail });
    expectError(await asAdmin(banned.token), 409, 'email_blacklisted');
    expectError(await asAdmin('not-a-real-token'), 404, 'token_invalid');
  });

  it('gives an address to one of two people clicking at the same time', async () => {
    const a = await t.seedLoggedIn();
    const b = await t.seedLoggedIn();
    const contested = uniqueEmail('contested');
    await start(a.cookie, contested);
    await waitForMail(contested);
    await start(b.cookie, contested);
    await waitForMail(contested, 2);
    const mails = await mailsTo(contested);
    const responses = await Promise.all(mails.map((mail) => verify(tokenFrom(mail))));
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const holders = await t.db.select().from(user).where(eq(user.email, contested));
    expect(holders).toHaveLength(1);
  });

  it('deletes invite rows holding the old address, and only those', async () => {
    const { member, token } = await started();
    const unrelated = uniqueEmail('unrelated');
    await t.db.insert(inviteRequest).values([
      { requesterId: admin.id, inviteeEmail: member.email, status: 'accepted' },
      { requesterId: admin.id, inviteeEmail: member.email.toUpperCase(), status: 'rejected' },
      { requesterId: admin.id, inviteeEmail: unrelated, status: 'pending' },
    ]);

    expect((await verify(token)).status).toBe(200);

    const left = await t.db
      .select({ email: inviteRequest.inviteeEmail })
      .from(inviteRequest)
      .where(sql`lower(${inviteRequest.inviteeEmail}) IN (${member.email}, ${unrelated})`);
    expect(left).toEqual([{ email: unrelated }]);
  });

  it('leaves invite rows alone until the change applies', async () => {
    const { member } = await started();
    await t.db
      .insert(inviteRequest)
      .values({ requesterId: admin.id, inviteeEmail: member.email, status: 'accepted' });
    expect(
      await t.db.select().from(inviteRequest).where(eq(inviteRequest.inviteeEmail, member.email)),
    ).toHaveLength(1);
  });

  it('kills a reset link sent to the old address', async () => {
    const { member, token } = await started();
    await requestReset(member.email);
    const resetToken = tokenFrom(await waitForMail(member.email));
    expect((await verify(token)).status).toBe(200);
    expect((await reset(resetToken)).status).toBe(400);
    expect(await canLogin(member.enteredUsername, PASSWORD)).toBe(true);
  });

  it('refuses a link for an account disabled since', async () => {
    const { member, token } = await started();
    await t.db.update(user).set({ disabledAt: new Date() }).where(eq(user.id, member.id));
    expectError(await verify(token), 403, 'account_disabled');
    expect(await emailOf(member.id)).toBe(member.email);
  });

  it('keeps nothing when the email cannot be sent', async () => {
    const failing = await createTestApp({
      mailer: { send: () => Promise.reject(new Error('smtp is down')) },
    });
    try {
      const member = await failing.seedLoggedIn();
      expectError(
        await failing.request(
          'POST',
          '/api/v1/me/email',
          { currentPassword: PASSWORD, newEmail: uniqueEmail('unsent') },
          { cookie: member.cookie },
        ),
        503,
        'email_failed',
      );
      expect(await failing.db.select().from(emailChangeRequest)).toEqual([]);
    } finally {
      await failing.cleanup();
    }
  });
});

describe('deleting your own account', () => {
  const remove = (cookie: string | undefined, currentPassword = PASSWORD) =>
    t.request('DELETE', '/api/v1/me', { currentPassword }, { cookie });

  it('needs a session', async () => {
    expectError(await remove(undefined), 401, 'unauthenticated');
  });

  it('refuses the first admin, even with the right password', async () => {
    expectError(await remove(admin.cookie), 403, 'first_admin_protected');
    expect(await t.db.select().from(user).where(eq(user.id, admin.id))).toHaveLength(1);
  });

  it('needs the current password', async () => {
    const member = await t.seedLoggedIn();
    expectError(await remove(member.cookie, 'wrong password'), 403, 'invalid_password');
    expectError(await t.request('DELETE', '/api/v1/me', undefined, { cookie: member.cookie }), 400, 'validation_error');
    expect(await t.db.select().from(user).where(eq(user.id, member.id))).toHaveLength(1);
    expect(await canLogin(member.username, PASSWORD)).toBe(true);
  });

  it('shares its rate limit with changing email', async () => {
    const member = await t.seedLoggedIn();
    expectError(await remove(member.cookie, 'wrong password'), 403, 'invalid_password');
    expectError(await remove(member.cookie, 'wrong password'), 403, 'invalid_password');
    expectError(
      await t.request('POST', '/api/v1/me/email', { currentPassword: 'wrong password', newEmail: uniqueEmail() }, { cookie: member.cookie }),
      403,
      'invalid_password',
    );
    expectError(await remove(member.cookie, 'wrong password'), 429, 'rate_limited');
    expectError(await remove(member.cookie), 429, 'rate_limited');
    expect(await t.db.select().from(user).where(eq(user.id, member.id))).toHaveLength(1);
  });

  it('works for a member and for another admin, and ends the session', async () => {
    for (const role of ['member', 'admin'] as const) {
      const someone = await t.seedLoggedIn({ role });
      const response = await remove(someone.cookie);
      expect(response.status).toBe(204);
      expect(response.headers.get('set-cookie')).toContain('better-auth.session_token=;');
      expect(await t.db.select().from(user).where(eq(user.id, someone.id))).toEqual([]);
      expect(await t.db.select().from(session).where(eq(session.userId, someone.id))).toEqual([]);
      expectError(await t.request('GET', '/api/v1/username-change-requests', undefined, { cookie: someone.cookie }), 401, 'unauthenticated');
      expect(await canLogin(someone.username, PASSWORD)).toBe(false);
    }
  });

  it('clears the secure session cookie over HTTPS', async () => {
    const secure = await createTestApp({ publicBaseUrl: 'https://osusume.test' });
    try {
      const member = await secure.seedLoggedIn();
      expect(member.cookie).toMatch(/^__Secure-better-auth\.session_token=/);
      const response = await secure.request('DELETE', '/api/v1/me', { currentPassword: PASSWORD }, { cookie: member.cookie });
      expect(response.status).toBe(204);
      const cleared = response.headers.get('set-cookie');
      expect(cleared).toContain('__Secure-better-auth.session_token=;');
      expect(cleared).toContain('Secure');
    } finally {
      await secure.cleanup();
    }
  });

  it('kills an outstanding password reset link', async () => {
    const member = await t.seedLoggedIn();
    await requestReset(member.email);
    const token = tokenFrom(await waitForMail(member.email));
    expect(await t.db.select().from(verification).where(eq(verification.value, member.id))).toHaveLength(1);

    await remove(member.cookie);

    expect(await t.db.select().from(verification).where(eq(verification.value, member.id))).toEqual([]);
    expect((await reset(token)).status).toBe(400);
  });

  it('frees the email to be invited again and removes it from invite rows', async () => {
    const member = await t.seedLoggedIn();
    await t.db
      .insert(inviteRequest)
      .values({ requesterId: admin.id, inviteeEmail: member.email, status: 'accepted' });

    await remove(member.cookie);

    expect(
      await t.db.select().from(inviteRequest).where(eq(inviteRequest.inviteeEmail, member.email)),
    ).toEqual([]);
    const again = await t.request('POST', '/api/v1/invite-requests', { email: member.email }, { cookie: admin.cookie });
    expect(again.status).toBe(202);
  });

  it('revokes approved invites they requested', async () => {
    const member = await t.seedLoggedIn();
    const invitee = uniqueEmail('invitee');
    await t.request('POST', '/api/v1/invite-requests', { email: invitee }, { cookie: member.cookie });
    const [open] = await t.db.select().from(inviteRequest).where(eq(inviteRequest.inviteeEmail, invitee));
    await t.request('POST', `/api/v1/admin/invite-requests/${open?.id ?? ''}/decision`, { decision: 'approve' }, { cookie: admin.cookie });
    const token = tokenFrom(await waitForMail(invitee));

    await remove(member.cookie);

    expectError(
      await t.request('POST', `/api/v1/invites/${encodeURIComponent(token)}/accept`, {
        username: 'orphan_invite',
        password: PASSWORD,
      }),
      404,
      'invite_invalid',
    );
  });
});
