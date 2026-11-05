import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { user } from '../db/schema.ts';
import {
  type TestApp,
  createTestApp,
  expectError,
  uniqueUsername,
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

const create = (cookie: string | undefined, username: string) =>
  t.request('POST', '/api/v1/username-change-requests', { username }, { cookie });
const decide = (id: string, decision: 'approve' | 'reject', cookie = admin.cookie) =>
  t.request('POST', `/api/v1/admin/username-change-requests/${id}/decision`, { decision }, { cookie });

async function requested(username = uniqueUsername('Wanted')) {
  const member = await t.seedLoggedIn();
  const response = await create(member.cookie, username);
  expect(response.status).toBe(201);
  return { member, username, id: (response.body as { id: string }).id };
}

describe('requesting a username change', () => {
  it('needs a session and a valid name', async () => {
    expectError(await create(undefined, 'whatever'), 401, 'unauthenticated');
    const member = await t.seedLoggedIn();
    expectError(await create(member.cookie, 'no spaces'), 400, 'validation_error');
    expectError(await create(member.cookie, 'ab'), 400, 'validation_error');
  });

  it('does not change anything until approved', async () => {
    const { member } = await requested();
    const [row] = await t.db.select().from(user).where(eq(user.id, member.id));
    expect(row?.username).toBe(member.username);
  });

  it('allows one pending request per user', async () => {
    const { member } = await requested();
    expectError(await create(member.cookie, uniqueUsername()), 409, 'username_change_already_pending');
  });

  it('holds to one pending request under concurrency', async () => {
    const member = await t.seedLoggedIn();
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => create(member.cookie, uniqueUsername())),
    );
    expect(responses.filter((response) => response.status === 201)).toHaveLength(1);
    expect(responses.filter((response) => response.status === 409)).toHaveLength(4);
  });

  it('allows a new request once the earlier one is decided', async () => {
    const { member, id } = await requested();
    await decide(id, 'reject');
    expect((await create(member.cookie, uniqueUsername())).status).toBe(201);
  });

  it('lists only your own', async () => {
    const { member, username } = await requested();
    const other = await requested();
    const response = await t.request('GET', '/api/v1/username-change-requests?mine=true', undefined, { cookie: member.cookie });
    expect(response.status).toBe(200);
    const { items } = response.body as { items: { requestedUsername: string }[] };
    expect(items.map((item) => item.requestedUsername)).toEqual([username]);
    expect(items.map((item) => item.requestedUsername)).not.toContain(other.username);
  });
});

describe('the admin queue', () => {
  it('is admin only', async () => {
    const { member, id } = await requested();
    expectError(await t.request('GET', '/api/v1/admin/username-change-requests', undefined, { cookie: member.cookie }), 403, 'admin_required');
    expectError(await decide(id, 'approve', member.cookie), 403, 'admin_required');
  });

  it('lists requests with pagination and a status filter', async () => {
    const { member, id, username } = await requested();
    await requested();
    const first = await t.request('GET', '/api/v1/admin/username-change-requests?status=pending&limit=1', undefined, { cookie: admin.cookie });
    const firstBody = first.body as { items: unknown[]; nextCursor: string | null };
    expect(firstBody.items).toHaveLength(1);
    expect(firstBody.nextCursor).toEqual(expect.any(String));

    const all = await t.request('GET', '/api/v1/admin/username-change-requests?status=pending&limit=100', undefined, { cookie: admin.cookie });
    const { items } = all.body as { items: { id: string }[] };
    expect(items.find((item) => item.id === id)).toMatchObject({
      userId: member.id,
      currentUsername: member.enteredUsername,
      requestedUsername: username,
      status: 'pending',
    });
  });

  it('approves: the new name logs in, the old one stops, capitalization is kept', async () => {
    const { member, id, username } = await requested(uniqueUsername('Fresh'));
    const response = await decide(id, 'approve');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: 'approved',
      decidedBy: admin.id,
      currentUsername: username,
    });
    const [row] = await t.db.select().from(user).where(eq(user.id, member.id));
    expect(row).toMatchObject({ username: username.toLowerCase(), displayUsername: username });
    await t.login(username.toUpperCase());
    await expect(t.login(member.username)).rejects.toThrow(/401/);
  });

  it('allows a capitalization-only change of your own name', async () => {
    const member = await t.seedLoggedIn({ username: uniqueUsername('lower') });
    const changed = member.enteredUsername.toUpperCase();
    const response = await create(member.cookie, changed);
    const { id } = response.body as { id: string };
    expect((await decide(id, 'approve')).status).toBe(200);
    const [row] = await t.db.select().from(user).where(eq(user.id, member.id));
    expect(row).toMatchObject({ username: member.username, displayUsername: changed });
  });

  it('rejects without changing anything', async () => {
    const { member, id } = await requested();
    const response = await decide(id, 'reject');
    expect(response.body).toMatchObject({ status: 'rejected', decidedBy: admin.id });
    const [row] = await t.db.select().from(user).where(eq(user.id, member.id));
    expect(row?.username).toBe(member.username);
  });

  it('refuses a name taken since, ignoring case, and leaves the request pending', async () => {
    const wanted = uniqueUsername('Popular');
    const { member, id } = await requested(wanted);
    await t.seedUser({ username: wanted.toUpperCase() });

    expectError(await decide(id, 'approve'), 409, 'username_taken');

    const [row] = await t.db.select().from(user).where(eq(user.id, member.id));
    expect(row?.username).toBe(member.username);
    expect((await decide(id, 'reject')).body).toMatchObject({ status: 'rejected' });
  });

  it('gives a name to one of two approvals at the same moment', async () => {
    const wanted = uniqueUsername('Contested');
    const a = await requested(wanted);
    const b = await requested(wanted.toLowerCase());
    const responses = await Promise.all([decide(a.id, 'approve'), decide(b.id, 'approve')]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(
      await t.db.select().from(user).where(eq(user.username, wanted.toLowerCase())),
    ).toHaveLength(1);
  });

  it('refuses a second decision and an unknown id', async () => {
    const { id } = await requested();
    await decide(id, 'reject');
    expectError(await decide(id, 'approve'), 409, 'username_change_not_pending');
    expectError(await decide('00000000-0000-4000-8000-000000000000', 'approve'), 404, 'username_change_not_found');
  });

  it('keeps sessions working across a rename', async () => {
    const { member, id } = await requested();
    await decide(id, 'approve');
    const response = await t.request('GET', '/api/v1/invite-requests', undefined, { cookie: member.cookie });
    expect(response.status).toBe(200);
  });
});
