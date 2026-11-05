import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Transaction } from '../db/client.ts';
import { emailBlacklist, inviteRequest, user } from '../db/schema.ts';
import { lockEmails } from '../lib/locks.ts';
import { hashToken } from '../lib/tokens.ts';
import { mailsTo, tokenFrom, waitForMail } from '../test-support/mailpit.ts';
import {
  PASSWORD,
  type TestApp,
  type TestResponse,
  createTestApp,
  expectError,
  uniqueEmail,
  uniqueUsername,
} from '../test-support/test-app.ts';

let t: TestApp;
let admin: Awaited<ReturnType<TestApp['seedLoggedIn']>>;
let member: Awaited<ReturnType<TestApp['seedLoggedIn']>>;

beforeAll(async () => {
  t = await createTestApp();
  admin = await t.seedLoggedIn({ role: 'admin', isFirstAdmin: true });
  member = await t.seedLoggedIn();
});

afterAll(async () => {
  await t.cleanup();
});

interface Created {
  id: string;
}

async function requestInvite(email = uniqueEmail('invitee')) {
  const response = await t.request('POST', '/api/v1/invite-requests', { email }, { cookie: member.cookie });
  expect(response.status).toBe(201);
  return { id: (response.body as Created).id, email };
}

const decide = (id: string, decision: 'approve' | 'reject') =>
  t.request('POST', `/api/v1/admin/invite-requests/${id}/decision`, { decision }, { cookie: admin.cookie });

async function approvedInvite(email = uniqueEmail('invitee')) {
  const request = await requestInvite(email);
  expect((await decide(request.id, 'approve')).status).toBe(200);
  return { ...request, token: tokenFrom(await waitForMail(email)) };
}

const accept = (token: string, username = uniqueUsername('New'), password = PASSWORD) =>
  t.request('POST', `/api/v1/invites/${encodeURIComponent(token)}/accept`, { username, password });

async function rowOf(id: string) {
  const [row] = await t.db.select().from(inviteRequest).where(eq(inviteRequest.id, id));
  return row;
}

describe('POST /invite-requests', () => {
  it('needs a session', async () => {
    expectError(await t.request('POST', '/api/v1/invite-requests', { email: uniqueEmail() }), 401, 'unauthenticated');
  });

  it('creates a pending request and normalizes the email', async () => {
    const entered = `  ${uniqueEmail('MIXED').toUpperCase()} `;
    const response = await t.request('POST', '/api/v1/invite-requests', { email: entered }, { cookie: member.cookie });
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      inviteeEmail: entered.trim().toLowerCase(),
      status: 'pending',
      expiresAt: null,
    });
    expect(response.body).not.toHaveProperty('tokenHash');
  });

  it('allows unlimited invites for different emails', async () => {
    for (let i = 0; i < 5; i += 1) await requestInvite();
  });

  describe('an address with an account or on the blacklist', () => {
    const ask = (email: string, cookie: string) =>
      t.request('POST', '/api/v1/invite-requests', { email }, { cookie });

    async function blacklisted() {
      const email = uniqueEmail('blacklisted');
      await t.db.insert(emailBlacklist).values({ email });
      return email;
    }

    it('gets a member the same refusal for both, ignoring case', async () => {
      const banned = await ask((await blacklisted()).toUpperCase(), member.cookie);
      const registered = await ask((await t.seedUser()).email.toUpperCase(), member.cookie);
      expectError(banned, 409, 'invite_refused');
      expect(registered.status).toBe(banned.status);
      expect(registered.body).toEqual(banned.body);
    });

    it('gets an admin the specific reason, ignoring case', async () => {
      expectError(await ask((await blacklisted()).toUpperCase(), admin.cookie), 409, 'email_blacklisted');
      expectError(await ask((await t.seedUser()).email.toUpperCase(), admin.cookie), 409, 'email_in_use');
    });
  });

  it('refuses a second open invite: pending', async () => {
    const { email } = await requestInvite();
    expectError(
      await t.request('POST', '/api/v1/invite-requests', { email }, { cookie: admin.cookie }),
      409,
      'invite_already_open',
    );
    expectError(
      await t.request('POST', '/api/v1/invite-requests', { email }, { cookie: member.cookie }),
      409,
      'invite_refused',
    );
  });

  it('refuses a second open invite: approved and unexpired', async () => {
    const { email } = await approvedInvite();
    expectError(
      await t.request('POST', '/api/v1/invite-requests', { email }, { cookie: admin.cookie }),
      409,
      'invite_already_open',
    );
    expectError(
      await t.request('POST', '/api/v1/invite-requests', { email }, { cookie: member.cookie }),
      409,
      'invite_refused',
    );
  });

  it('gives a member the same refusal for an account, a ban and an open invite', async () => {
    const ask = (email: string) =>
      t.request('POST', '/api/v1/invite-requests', { email }, { cookie: member.cookie });
    const banned = uniqueEmail('blacklisted');
    await t.db.insert(emailBlacklist).values({ email: banned });
    const bodies = [
      await ask(banned),
      await ask((await t.seedUser()).email),
      await ask((await requestInvite()).email),
    ];
    expect(bodies.map((response) => response.status)).toEqual([409, 409, 409]);
    expect(bodies[1]?.body).toEqual(bodies[0]?.body);
    expect(bodies[2]?.body).toEqual(bodies[0]?.body);
  });

  it('allows a new request once the earlier one is rejected, revoked or expired', async () => {
    const rejected = await requestInvite();
    expect((await decide(rejected.id, 'reject')).status).toBe(200);
    await requestInvite(rejected.email);

    const revoked = await approvedInvite();
    const revocation = await t.request('POST', `/api/v1/admin/invite-requests/${revoked.id}/revoke`, undefined, {
      cookie: admin.cookie,
    });
    expect(revocation.status).toBe(200);
    await requestInvite(revoked.email);

    const expired = await approvedInvite();
    await t.db
      .update(inviteRequest)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(inviteRequest.id, expired.id));
    await requestInvite(expired.email);
  });

  it('lets exactly one concurrent request through', async () => {
    const email = uniqueEmail('race');
    const responses = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        t.request(
          'POST',
          '/api/v1/invite-requests',
          { email: i % 2 === 0 ? email : email.toUpperCase() },
          { cookie: member.cookie },
        ),
      ),
    );
    const statuses = responses.map((response) => response.status).sort();
    expect(statuses).toEqual([201, ...Array<number>(9).fill(409)]);
    const rows = await t.db
      .select()
      .from(inviteRequest)
      .where(sql`lower(${inviteRequest.inviteeEmail}) = ${email}`);
    expect(rows).toHaveLength(1);
  });

  it('lets exactly one through when the earlier invite is approved, which no index covers', async () => {
    const { email } = await approvedInvite();
    await t.db
      .update(inviteRequest)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(inviteRequest.inviteeEmail, email));
    const responses = await Promise.all(
      Array.from({ length: 6 }, () =>
        t.request('POST', '/api/v1/invite-requests', { email }, { cookie: member.cookie }),
      ),
    );
    expect(responses.filter((response) => response.status === 201)).toHaveLength(1);
  });
});

describe('GET /invite-requests', () => {
  it('lists only your own, with cursor pagination', async () => {
    const someone = await t.seedLoggedIn();
    const emails = [uniqueEmail('page'), uniqueEmail('page'), uniqueEmail('page')];
    for (const email of emails) {
      const response = await t.request('POST', '/api/v1/invite-requests', { email }, { cookie: someone.cookie });
      expect(response.status).toBe(201);
    }

    const first = await t.request('GET', '/api/v1/invite-requests?mine=true&limit=2', undefined, { cookie: someone.cookie });
    const firstBody = first.body as { items: { inviteeEmail: string }[]; nextCursor: string };
    expect(firstBody.items).toHaveLength(2);
    expect(firstBody.nextCursor).toEqual(expect.any(String));

    const second = await t.request(
      'GET',
      `/api/v1/invite-requests?limit=2&cursor=${firstBody.nextCursor}`,
      undefined,
      { cookie: someone.cookie },
    );
    const secondBody = second.body as typeof firstBody;
    expect(secondBody.items).toHaveLength(1);
    expect(secondBody.nextCursor).toBeNull();
    expect([...firstBody.items, ...secondBody.items].map((item) => item.inviteeEmail).sort()).toEqual(
      [...emails].sort(),
    );
  });

  it('has no way to see other people\'s requests', async () => {
    expectError(await t.request('GET', '/api/v1/invite-requests?mine=false', undefined, { cookie: admin.cookie }), 400, 'validation_error');
  });

  it('refuses a cursor it did not issue', async () => {
    expectError(await t.request('GET', '/api/v1/invite-requests?cursor=garbage', undefined, { cookie: member.cookie }), 400, 'invalid_cursor');
  });
});

describe('GET /admin/invite-requests', () => {
  it('is admin only', async () => {
    expectError(await t.request('GET', '/api/v1/admin/invite-requests', undefined, { cookie: member.cookie }), 403, 'admin_required');
  });

  it('lists requests with their requester, filtered by status, and hides the token hash', async () => {
    const { id } = await approvedInvite();
    const response = await t.request('GET', '/api/v1/admin/invite-requests?status=approved&limit=100', undefined, { cookie: admin.cookie });
    expect(response.status).toBe(200);
    const body = response.body as { items: { id: string; status: string }[] };
    expect(body.items.every((item) => item.status === 'approved')).toBe(true);
    const item = body.items.find((candidate) => candidate.id === id);
    expect(item).toMatchObject({
      requesterId: member.id,
      requesterUsername: member.enteredUsername,
      decidedBy: admin.id,
    });
    expect(JSON.stringify(response.body)).not.toMatch(/tokenHash|token_hash/);
    const { tokenHash } = (await rowOf(id)) ?? {};
    expect(JSON.stringify(response.body)).not.toContain(tokenHash);
  });
});

describe('POST /admin/invite-requests/{id}/decision', () => {
  it('is admin only', async () => {
    const { id } = await requestInvite();
    expectError(
      await t.request('POST', `/api/v1/admin/invite-requests/${id}/decision`, { decision: 'approve' }, { cookie: member.cookie }),
      403,
      'admin_required',
    );
  });

  it('approves: emails a link, stores only the hash, expires in 7 days', async () => {
    const { id, email, token } = await approvedInvite();
    const mail = await waitForMail(email);
    expect(mail.text).toContain('http://osusume.test/invites/accept?token=');

    const row = await rowOf(id);
    expect(row?.status).toBe('approved');
    expect(row?.decidedBy).toBe(admin.id);
    expect(row?.tokenHash).toBe(hashToken(token));
    expect(row?.tokenHash).not.toContain(token);
    const days = ((row?.expiresAt?.getTime() ?? 0) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.99);
    expect(days).toBeLessThanOrEqual(7);
  });

  it('rejects without emailing or creating a token', async () => {
    const { id, email } = await requestInvite();
    const response = await decide(id, 'reject');
    expect(response.body).toMatchObject({ status: 'rejected', decidedBy: admin.id });
    expect((await rowOf(id))?.tokenHash).toBeNull();
    expect(await mailsTo(email)).toEqual([]);
  });

  it('refuses a second decision and an unknown id', async () => {
    const { id } = await requestInvite();
    await decide(id, 'reject');
    expectError(await decide(id, 'approve'), 409, 'invite_not_pending');
    expectError(await decide('00000000-0000-4000-8000-000000000000', 'approve'), 404, 'invite_not_found');
  });

  it('refuses to approve when the email has been blacklisted since', async () => {
    const { id, email } = await requestInvite();
    await t.db.insert(emailBlacklist).values({ email });
    expectError(await decide(id, 'approve'), 409, 'email_blacklisted');
    expect((await rowOf(id))?.status).toBe('pending');
    expect(await mailsTo(email)).toEqual([]);
  });

  it('refuses to approve when the email now has an account', async () => {
    const { id, email } = await requestInvite();
    await t.seedUser({ email });
    expectError(await decide(id, 'approve'), 409, 'email_in_use');
    expect((await rowOf(id))?.status).toBe('pending');
  });

  it('sends one link when two admins approve at the same moment', async () => {
    const { id, email } = await requestInvite();
    const responses = await Promise.all([decide(id, 'approve'), decide(id, 'approve')]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    await waitForMail(email);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(await mailsTo(email)).toHaveLength(1);
  });

  it('stays pending when the email cannot be sent, so the admin can retry', async () => {
    const failing = await createTestApp({
      mailer: { send: () => Promise.reject(new Error('smtp is down')) },
    });
    try {
      const failingAdmin = await failing.seedLoggedIn({ role: 'admin' });
      const created = await failing.request(
        'POST',
        '/api/v1/invite-requests',
        { email: uniqueEmail('unsent') },
        { cookie: failingAdmin.cookie },
      );
      const { id } = created.body as Created;
      expectError(
        await failing.request(
          'POST',
          `/api/v1/admin/invite-requests/${id}/decision`,
          { decision: 'approve' },
          { cookie: failingAdmin.cookie },
        ),
        503,
        'email_failed',
      );
      const [row] = await failing.db.select().from(inviteRequest).where(eq(inviteRequest.id, id));
      expect(row).toMatchObject({ status: 'pending', tokenHash: null, expiresAt: null });
    } finally {
      await failing.cleanup();
    }
  });
});

describe('POST /admin/invite-requests/{id}/revoke', () => {
  const revoke = (id: string, cookie: string) =>
    t.request('POST', `/api/v1/admin/invite-requests/${id}/revoke`, undefined, { cookie });

  it('is admin only', async () => {
    const { id } = await approvedInvite();
    expectError(await revoke(id, member.cookie), 403, 'admin_required');
  });

  it('stops the link working', async () => {
    const { id, token } = await approvedInvite();
    const response = await revoke(id, admin.cookie);
    expect(response.body).toMatchObject({ status: 'revoked' });
    expectError(await accept(token), 404, 'invite_invalid');
  });

  it('refuses anything not approved', async () => {
    const pending = await requestInvite();
    expectError(await revoke(pending.id, admin.cookie), 409, 'invite_not_revocable');

    const accepted = await approvedInvite();
    expect((await accept(accepted.token)).status).toBe(201);
    expectError(await revoke(accepted.id, admin.cookie), 409, 'invite_not_revocable');
    expectError(await revoke('00000000-0000-4000-8000-000000000000', admin.cookie), 404, 'invite_not_found');
  });

  it('never lets both a revoke and an accept win', async () => {
    const { id, token, email } = await approvedInvite();
    const [revoked, accepted] = await Promise.all([revoke(id, admin.cookie), accept(token)]);
    const accounts = await t.db.select().from(user).where(eq(user.email, email));
    const row = await rowOf(id);
    if (accepted.status === 201) {
      expect(revoked.status).toBe(409);
      expect(accounts).toHaveLength(1);
      expect(row?.status).toBe('accepted');
    } else {
      expect(revoked.status).toBe(200);
      expect(accounts).toEqual([]);
      expect(row?.status).toBe('revoked');
    }
  });
});

describe('POST /invites/{token}/accept', () => {
  it('creates a member with the invited, verified email, who can log in', async () => {
    const { id, email, token } = await approvedInvite();
    const username = uniqueUsername('Invited');

    const response = await t.request('POST', `/api/v1/invites/${encodeURIComponent(token)}/accept`, {
      username,
      password: PASSWORD,
      email: uniqueEmail('attempted-override'),
      role: 'admin',
      isFirstAdmin: true,
    });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ username, email, role: 'member' });
    const [created] = await t.db.select().from(user).where(eq(user.email, email));
    expect(created).toMatchObject({
      emailVerified: true,
      role: 'member',
      isFirstAdmin: false,
      username: username.toLowerCase(),
      displayUsername: username,
    });
    expect(await rowOf(id)).toMatchObject({ status: 'accepted', tokenHash: null });
    await t.login(username.toUpperCase());
  });

  it('is single use', async () => {
    const { token } = await approvedInvite();
    expect((await accept(token)).status).toBe(201);
    expectError(await accept(token), 404, 'invite_invalid');
  });

  it('refuses an unknown or expired link', async () => {
    expectError(await accept('not-a-real-token'), 404, 'invite_invalid');
    const { id, token } = await approvedInvite();
    await t.db
      .update(inviteRequest)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(inviteRequest.id, id));
    expectError(await accept(token), 404, 'invite_invalid');
  });

  it('creates one account when the same link is used twice at once', async () => {
    const { email, token } = await approvedInvite();
    const responses = await Promise.all([
      accept(token),
      accept(token),
      accept(token),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 404, 404]);
    expect(await t.db.select().from(user).where(eq(user.email, email))).toHaveLength(1);
  });

  it('refuses a taken username ignoring case, and the link still works', async () => {
    const { token } = await approvedInvite();
    const taken = await t.seedUser({ username: uniqueUsername('Taken') });
    expectError(await accept(token, taken.enteredUsername.toUpperCase()), 409, 'username_taken');
    expect((await accept(token)).status).toBe(201);
  });

  it('gives one of two people racing for a username a clean refusal', async () => {
    const [a, b] = await Promise.all([approvedInvite(), approvedInvite()]);
    const username = uniqueUsername('Contested');
    const responses = await Promise.all([accept(a.token, username), accept(b.token, username.toLowerCase())]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
  });

  it('refuses when the email has been blacklisted since approval', async () => {
    const { email, token } = await approvedInvite();
    await t.db.insert(emailBlacklist).values({ email });
    const dead = await accept(token);
    expectError(dead, 404, 'invite_invalid');
    expect(dead.body).toEqual((await accept('not-a-real-token')).body);
    expect(await t.db.select().from(user).where(eq(user.email, email))).toEqual([]);
  });

  it('refuses when the email has gained an account since approval', async () => {
    const { email, token } = await approvedInvite();
    await t.seedUser({ email });
    const dead = await accept(token);
    expectError(dead, 404, 'invite_invalid');
    expect(dead.body).toEqual((await accept('not-a-real-token')).body);
  });

  it('tells a logged-in admin the specific reason', async () => {
    const asAdmin = (token: string) =>
      t.request(
        'POST',
        `/api/v1/invites/${encodeURIComponent(token)}/accept`,
        { username: uniqueUsername('New'), password: PASSWORD },
        { cookie: admin.cookie },
      );
    const banned = await approvedInvite();
    await t.db.insert(emailBlacklist).values({ email: banned.email });
    expectError(await asAdmin(banned.token), 409, 'email_blacklisted');
    const taken = await approvedInvite();
    await t.seedUser({ email: taken.email });
    expectError(await asAdmin(taken.token), 409, 'email_in_use');
  });

  it('does not treat a member session as an admin one', async () => {
    const { email, token } = await approvedInvite();
    await t.seedUser({ email });
    const response = await t.request(
      'POST',
      `/api/v1/invites/${encodeURIComponent(token)}/accept`,
      { username: uniqueUsername('New'), password: PASSWORD },
      { cookie: member.cookie },
    );
    expectError(response, 404, 'invite_invalid');
  });

  it.each([
    ['an 11-character password', { username: 'valid_name', password: 'a'.repeat(11) }],
    ['a 129-character password', { username: 'valid_name', password: 'a'.repeat(129) }],
    ['a bad username', { username: 'no spaces', password: PASSWORD }],
  ])('refuses %s', async (_label, body) => {
    const { token } = await approvedInvite();
    expectError(await t.request('POST', `/api/v1/invites/${encodeURIComponent(token)}/accept`, body), 400, 'validation_error');
  });
});

describe('GET /invites/{token}', () => {
  const INVALID = { valid: false, email: null };
  const preview = (token: string) =>
    t.request('GET', `/api/v1/invites/${encodeURIComponent(token)}`);

  it('shows the fixed email of a valid link, with no login and no caching', async () => {
    const { email, token } = await approvedInvite();
    const response = await preview(token);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ valid: true, email });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('does not consume the link', async () => {
    const { email, token } = await approvedInvite();
    await preview(token);
    await preview(token);
    expect((await preview(token)).body).toEqual({ valid: true, email });
    expect((await accept(token)).status).toBe(201);
  });

  it('gives the same answer for every link that cannot be accepted', async () => {
    const unknown = await preview('not-a-real-token');
    expect(unknown.status).toBe(200);
    expect(unknown.body).toEqual(INVALID);

    const expired = await approvedInvite();
    await t.db
      .update(inviteRequest)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(inviteRequest.id, expired.id));

    const revoked = await approvedInvite();
    await t.request('POST', `/api/v1/admin/invite-requests/${revoked.id}/revoke`, undefined, {
      cookie: admin.cookie,
    });

    const used = await approvedInvite();
    expect((await accept(used.token)).status).toBe(201);

    const blacklisted = await approvedInvite();
    await t.db.insert(emailBlacklist).values({ email: blacklisted.email });

    const registered = await approvedInvite();
    await t.seedUser({ email: registered.email });

    // Revoked by the requester's removal: the status changes but the hash stays.
    const someone = await t.seedLoggedIn();
    const orphanEmail = uniqueEmail('orphan');
    const created = await t.request('POST', '/api/v1/invite-requests', { email: orphanEmail }, { cookie: someone.cookie });
    await decide((created.body as Created).id, 'approve');
    const orphanToken = tokenFrom(await waitForMail(orphanEmail));
    await t.db.delete(user).where(eq(user.id, someone.id));

    for (const token of [
      expired.token,
      revoked.token,
      used.token,
      blacklisted.token,
      registered.token,
      orphanToken,
    ]) {
      const response = await preview(token);
      expect(response.status).toBe(200);
      expect(response.body).toEqual(INVALID);
    }
  });

  it('says invalid for a request not yet approved, which has no link', async () => {
    const { id } = await requestInvite();
    expect((await rowOf(id))?.tokenHash).toBeNull();
    expect((await preview(id)).body).toEqual(INVALID);
  });
});

// Timing alone rarely exposes these, so each test holds the address's lock while making an
// uncommitted change, proving the request waits and then sees it. Without the lock the
// request would pass its check against the old state.
describe('the email lock', () => {
  async function callWhileLocked(
    email: string,
    change: (tx: Transaction) => Promise<unknown>,
    call: () => Promise<TestResponse>,
  ): Promise<TestResponse> {
    let pending: Promise<TestResponse> | undefined;
    await t.db.transaction(async (tx) => {
      await lockEmails(tx, email);
      await change(tx);
      pending = call();
      await new Promise((resolve) => setTimeout(resolve, 150));
    });
    if (!pending) throw new Error('the call did not start');
    return pending;
  }

  const blacklist = (email: string) => (tx: Transaction) =>
    tx.insert(emailBlacklist).values({ email });

  it('makes a request wait for a ban in progress', async () => {
    const email = uniqueEmail('locked');
    const response = await callWhileLocked(email, blacklist(email), () =>
      t.request('POST', '/api/v1/invite-requests', { email }, { cookie: member.cookie }),
    );
    expectError(response, 409, 'invite_refused');
  });

  it('makes a request wait for an invite being opened, which no index covers', async () => {
    const email = uniqueEmail('locked');
    const response = await callWhileLocked(
      email,
      (tx) =>
        tx.insert(inviteRequest).values({
          requesterId: member.id,
          inviteeEmail: email,
          status: 'approved',
          expiresAt: new Date(Date.now() + 60_000),
        }),
      () => t.request('POST', '/api/v1/invite-requests', { email }, { cookie: admin.cookie }),
    );
    expectError(response, 409, 'invite_already_open');
  });

  it('makes an approval wait for a ban in progress', async () => {
    const { id, email } = await requestInvite();
    const response = await callWhileLocked(email, blacklist(email), () => decide(id, 'approve'));
    expectError(response, 409, 'email_blacklisted');
    expect((await rowOf(id))?.status).toBe('pending');
    expect(await mailsTo(email)).toEqual([]);
  });

  it('makes an accept wait for a ban in progress', async () => {
    const { email, token } = await approvedInvite();
    const response = await callWhileLocked(email, blacklist(email), () => accept(token));
    expectError(response, 404, 'invite_invalid');
    expect(await t.db.select().from(user).where(eq(user.email, email))).toEqual([]);
  });

  it('makes an email change wait for a ban in progress', async () => {
    const someone = await t.seedLoggedIn();
    const newEmail = uniqueEmail('locked');
    await t.request(
      'POST',
      '/api/v1/me/email',
      { currentPassword: PASSWORD, newEmail },
      { cookie: someone.cookie },
    );
    const token = tokenFrom(await waitForMail(newEmail));
    const response = await callWhileLocked(newEmail, blacklist(newEmail), () =>
      t.request('POST', '/api/v1/me/email/verify', { token }),
    );
    expectError(response, 409, 'email_change_refused');
    const [row] = await t.db.select().from(user).where(eq(user.id, someone.id));
    expect(row?.email).toBe(someone.email);
  });
});
