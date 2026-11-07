import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Transaction } from '../db/client.ts';
import { emailBlacklist, inviteRequest, user } from '../db/schema.ts';
import { lockEmails } from '../lib/locks.ts';
import { INVITE_ACCEPT_LIMIT, INVITE_REQUEST_LIMIT, clearAttempts } from '../lib/rate-limit.ts';
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

// Requests made as setup would otherwise add up to the limit across a whole file.
beforeEach(clearAttempts);

const SENT = { message: 'Request sent to the admins' };

const ask = (email: string, cookie = member.cookie) =>
  t.request('POST', '/api/v1/invite-requests', { email }, { cookie });

const rowsFor = (email: string) =>
  t.db.select().from(inviteRequest).where(sql`lower(${inviteRequest.inviteeEmail}) = lower(${email})`);

/** Requests an invite and finds its row, which the response does not identify. */
async function requestInvite(email = uniqueEmail('invitee')) {
  const response = await ask(email);
  expect(response.status).toBe(202);
  const open = (await rowsFor(email)).find((row) => row.status === 'pending');
  if (!open) throw new Error('no pending request was created');
  return { id: open.id, email };
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

  it('creates a pending request for the admin queue and normalizes the email', async () => {
    const email = uniqueEmail('MIXED');
    const response = await ask(`  ${email.toUpperCase()} `);
    expect(response.status).toBe(202);
    expect(response.body).toEqual(SENT);
    expect(await rowsFor(email)).toMatchObject([
      { inviteeEmail: email.toLowerCase(), status: 'pending', requesterId: member.id, expiresAt: null },
    ]);
  });

  it('refuses a malformed address, whoever asks', async () => {
    expectError(await ask('not an email'), 400, 'validation_error');
    expectError(await ask('not an email', admin.cookie), 400, 'validation_error');
  });

  it('allows unlimited invites for different emails', async () => {
    for (let i = 0; i < 5; i += 1) await requestInvite();
  });

  async function blacklisted() {
    const email = uniqueEmail('blacklisted');
    await t.db.insert(emailBlacklist).values({ email });
    return email;
  }

  /** Every way an address can be refused, ignoring case. */
  const refusable: [string, () => Promise<string>][] = [
    ['with an account', async () => (await t.seedUser()).email.toUpperCase()],
    ['on the blacklist', async () => (await blacklisted()).toUpperCase()],
    ['with a pending invite', async () => (await requestInvite()).email.toUpperCase()],
    ['with an approved invite', async () => (await approvedInvite()).email.toUpperCase()],
  ];

  describe('gives a member byte for byte the same answer', () => {
    it.each(refusable)('for an address %s as for one that goes ahead', async (_label, make) => {
      const accepted = await ask(uniqueEmail('accepted'));
      const email = await make();
      const before = await rowsFor(email);
      const delivered = (await mailsTo(email)).length;

      const refused = await ask(email);

      expect(refused.status).toBe(accepted.status);
      expect(refused.status).toBe(202);
      expect(refused.text).toBe(accepted.text);
      expect(JSON.parse(refused.text)).toEqual(SENT);
      expect([...refused.headers.entries()]).toEqual([...accepted.headers.entries()]);
      expect(await rowsFor(email)).toEqual(before);
      expect(await mailsTo(email)).toHaveLength(delivered);
    });
  });

  it('never tells the requester the id of a request', async () => {
    const email = uniqueEmail('invitee');
    const response = await ask(email);
    const [row] = await rowsFor(email);
    expect(response.text).not.toContain(row?.id);
    expect(response.text).not.toContain(email);
  });

  it('sends nothing to the address, which only an approval does', async () => {
    const { email } = await requestInvite();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await mailsTo(email)).toEqual([]);
  });

  it('tells an admin the specific reason, creating nothing', async () => {
    const registered = (await t.seedUser()).email.toUpperCase();
    expectError(await ask(registered, admin.cookie), 409, 'email_in_use');
    expect(await rowsFor(registered)).toEqual([]);
    const banned = await blacklisted();
    expectError(await ask(banned, admin.cookie), 409, 'email_blacklisted');
    expect(await rowsFor(banned)).toEqual([]);
    const pending = await requestInvite();
    expectError(await ask(pending.email, admin.cookie), 409, 'invite_already_open');
    const approved = await approvedInvite();
    expectError(await ask(approved.email, admin.cookie), 409, 'invite_already_open');
  });

  it('queues an admin\'s own request and answers the same as for a member', async () => {
    const email = uniqueEmail('from-admin');
    const response = await ask(email, admin.cookie);
    expect(response.status).toBe(202);
    expect(response.body).toEqual(SENT);
    expect(await rowsFor(email)).toMatchObject([{ status: 'pending', requesterId: admin.id }]);
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

  it('lets exactly one concurrent request through, and a member cannot tell which', async () => {
    const email = uniqueEmail('race');
    const responses = await Promise.all(
      Array.from({ length: 10 }, (_, i) => ask(i % 2 === 0 ? email : email.toUpperCase())),
    );
    expect(new Set(responses.map((response) => `${String(response.status)} ${response.text}`)).size).toBe(1);
    expect(await rowsFor(email)).toHaveLength(1);
  });

  it('tells concurrent admins apart: one is queued, the rest hear why not', async () => {
    const email = uniqueEmail('race');
    const responses = await Promise.all(Array.from({ length: 10 }, () => ask(email, admin.cookie)));
    const statuses = responses.map((response) => response.status).sort();
    expect(statuses).toEqual([202, ...Array<number>(9).fill(409)]);
  });

  it('lets exactly one through when the earlier invite is approved, which no index covers', async () => {
    const { email } = await approvedInvite();
    await t.db
      .update(inviteRequest)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(inviteRequest.inviteeEmail, email));
    await Promise.all(Array.from({ length: 6 }, () => ask(email)));
    expect((await rowsFor(email)).filter((row) => row.status === 'pending')).toHaveLength(1);
  });
});

describe('the limit on POST /invite-requests', () => {
  const fill = async (cookie: string) => {
    for (let i = 0; i < INVITE_REQUEST_LIMIT.max; i += 1) {
      expect((await ask(uniqueEmail('filler'), cookie)).status).toBe(202);
    }
  };

  it('allows ten an hour', () => {
    expect(INVITE_REQUEST_LIMIT).toEqual({ windowSeconds: 3600, max: 10 });
  });

  it('gives the same 429 whatever the address, creating nothing', async () => {
    const someone = await t.seedLoggedIn();
    await fill(someone.cookie);
    const free = uniqueEmail('free');
    const banned = uniqueEmail('blacklisted');
    await t.db.insert(emailBlacklist).values({ email: banned });
    const open = await requestInvite();
    const responses = [
      await ask(free, someone.cookie),
      await ask((await t.seedUser()).email, someone.cookie),
      await ask(banned, someone.cookie),
      await ask(open.email, someone.cookie),
    ];
    for (const response of responses) {
      expectError(response, 429, 'rate_limited');
      expect(response.text).toBe(responses[0]?.text);
      expect(Number(response.headers.get('x-retry-after'))).toBeGreaterThan(0);
    }
    expect(await rowsFor(free)).toEqual([]);
  });

  it('counts refused and accepted requests alike', async () => {
    const someone = await t.seedLoggedIn();
    const registered = await t.seedUser();
    for (let i = 0; i < INVITE_REQUEST_LIMIT.max; i += 1) {
      const email = i % 2 === 0 ? registered.email : uniqueEmail('filler');
      expect((await ask(email, someone.cookie)).status).toBe(202);
    }
    expectError(await ask(uniqueEmail('free'), someone.cookie), 429, 'rate_limited');
  });

  it('counts each member separately', async () => {
    const someone = await t.seedLoggedIn();
    await fill(someone.cookie);
    expect((await ask(uniqueEmail('free'))).status).toBe(202);
  });

  it('has its own bucket, which the password limit does not use up', async () => {
    const someone = await t.seedLoggedIn();
    const wrongPassword = () =>
      t.request(
        'POST',
        '/api/v1/me/email',
        { currentPassword: 'wrong password', newEmail: uniqueEmail('unsent') },
        { cookie: someone.cookie },
      );
    for (let i = 0; i < 3; i += 1) expectError(await wrongPassword(), 403, 'invalid_password');
    expectError(await wrongPassword(), 429, 'rate_limited');
    await fill(someone.cookie);
    expectError(await ask(uniqueEmail('free'), someone.cookie), 429, 'rate_limited');
  });
});

describe('a member has no record of who they invited', () => {
  it.each(['', '?mine=true', '?mine=false'])('GET /invite-requests%s does not exist', async (query) => {
    await requestInvite();
    for (const cookie of [member.cookie, admin.cookie]) {
      const response = await t.request('GET', `/api/v1/invite-requests${query}`, undefined, { cookie });
      expect(response.status).toBe(404);
    }
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
      const email = uniqueEmail('unsent');
      await failing.request('POST', '/api/v1/invite-requests', { email }, { cookie: failingAdmin.cookie });
      const [pending] = await failing.db.select().from(inviteRequest).where(eq(inviteRequest.inviteeEmail, email));
      const id = pending?.id ?? '';
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
  it('does not hash the password for a dead link', async () => {
    const hash = vi.spyOn((await t.auth.$context).password, 'hash');
    try {
      const response = await t.request('POST', '/api/v1/invites/not-a-real-token/accept', {
        username: uniqueUsername('Dead'),
        password: PASSWORD,
      });
      expectError(response, 404, 'invite_invalid');
      expect(hash).not.toHaveBeenCalled();
    } finally {
      hash.mockRestore();
    }
  });

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

  describe('gives one answer for every link that cannot be accepted', () => {
    const dead: [string, () => Promise<string>][] = [
      ['unknown', () => Promise.resolve('not-a-real-token')],
      ['used', async () => {
        const { token } = await approvedInvite();
        expect((await accept(token)).status).toBe(201);
        return token;
      }],
      ['expired', async () => {
        const { id, token } = await approvedInvite();
        await t.db
          .update(inviteRequest)
          .set({ expiresAt: new Date(Date.now() - 1000) })
          .where(eq(inviteRequest.id, id));
        return token;
      }],
      ['revoked', async () => {
        const { id, token } = await approvedInvite();
        await t.request('POST', `/api/v1/admin/invite-requests/${id}/revoke`, undefined, { cookie: admin.cookie });
        return token;
      }],
      ['blacklisted since approval', async () => {
        const { email, token } = await approvedInvite();
        await t.db.insert(emailBlacklist).values({ email });
        return token;
      }],
      ['registered since approval', async () => {
        const { email, token } = await approvedInvite();
        await t.seedUser({ email });
        return token;
      }],
    ];

    it.each(dead)('%s, for anyone, an admin included', async (_label, make) => {
      const token = await make();
      const callers = [undefined, member.cookie, admin.cookie];
      const body = { username: uniqueUsername('New'), password: PASSWORD };
      const path = `/api/v1/invites/${encodeURIComponent(token)}/accept`;
      const reference = await accept('not-a-real-token');
      expectError(reference, 404, 'invite_invalid');
      for (const cookie of callers) {
        const response = await t.request('POST', path, body, { cookie });
        expect(response.status).toBe(reference.status);
        expect(response.text).toBe(reference.text);
      }
    });
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
    expect((await ask(orphanEmail, someone.cookie)).status).toBe(202);
    const [orphan] = await rowsFor(orphanEmail);
    await decide(orphan?.id ?? '', 'approve');
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
      expect(response.text).toBe(unknown.text);
      expect(response.headers.get('cache-control')).toBe(unknown.headers.get('cache-control'));
      const asAdmin = await t.request('GET', `/api/v1/invites/${encodeURIComponent(token)}`, undefined, {
        cookie: admin.cookie,
      });
      expect(asAdmin.text).toBe(unknown.text);
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
    expect(response.status).toBe(202);
    expect(await rowsFor(email)).toEqual([]);
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
    expect(response.status).toBe(200);
    const [row] = await t.db.select().from(user).where(eq(user.id, someone.id));
    expect(row?.email).toBe(someone.email);
  });
});

describe('accepting an invite, rate limited', () => {
  const attempt = (ip: string) =>
    t.request(
      'POST',
      '/api/v1/invites/dead-link/accept',
      { username: uniqueUsername('New'), password: PASSWORD },
      { ip },
    );

  it('refuses a client at its limit, and leaves other clients alone', async () => {
    for (let count = 0; count < INVITE_ACCEPT_LIMIT.max; count += 1) {
      expectError(await attempt('203.0.113.7'), 404, 'invite_invalid');
    }
    expectError(await attempt('203.0.113.7'), 429, 'rate_limited');
    expectError(await attempt('203.0.113.8'), 404, 'invite_invalid');
  });
});
