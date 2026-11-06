import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encodeCursor } from '../lib/pagination.ts';
import { type TestApp, createTestApp, expectError } from '../test-support/test-app.ts';

let t: TestApp;
let admin: Awaited<ReturnType<TestApp['seedLoggedIn']>>;
const NO_ID = '00000000-0000-4000-8000-000000000000';

beforeAll(async () => {
  t = await createTestApp();
  admin = await t.seedLoggedIn({ role: 'admin', isFirstAdmin: true });
});

afterAll(async () => {
  await t.cleanup();
});

const ask = (cookie: string | undefined, username: string) =>
  t.request('POST', '/api/v1/friends/requests', { username }, { cookie });
const act = (cookie: string, id: string, action: 'accept' | 'decline') =>
  t.request('POST', `/api/v1/friends/requests/${id}/${action}`, undefined, { cookie });
const cancel = (cookie: string, id: string) =>
  t.request('DELETE', `/api/v1/friends/requests/${id}`, undefined, { cookie });
const unfriend = (cookie: string, id: string) =>
  t.request('DELETE', `/api/v1/friends/${id}`, undefined, { cookie });
const list = async (cookie: string, query = '') => {
  const response = await t.request('GET', `/api/v1/friends${query}`, undefined, { cookie });
  expect(response.status).toBe(200);
  return response.body as {
    items: { id: string; relation: string; username: string }[];
    nextCursor: string | null;
  };
};

async function pending() {
  const from = await t.seedLoggedIn();
  const to = await t.seedLoggedIn();
  const response = await ask(from.cookie, to.enteredUsername);
  expect(response.status).toBe(201);
  return { from, to, id: (response.body as { id: string }).id };
}

describe('friend requests', () => {
  it('finds a member by exact username, ignoring case', async () => {
    const from = await t.seedLoggedIn();
    const to = await t.seedLoggedIn({ username: `CasedName_${String(Date.now()).slice(-8)}` });
    const response = await ask(from.cookie, to.enteredUsername.toLowerCase());
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ relation: 'outgoing', username: to.enteredUsername });
    expectError(await ask(from.cookie, to.enteredUsername.slice(0, -1)), 404, 'user_not_found');
  });

  it('refuses bad input and anonymous callers', async () => {
    const from = await t.seedLoggedIn();
    expectError(await ask(undefined, 'whoever'), 401, 'unauthenticated');
    expectError(await ask(from.cookie, 'a\0bcd'), 400, 'validation_error');
    expectError(await ask(from.cookie, 'ab'), 400, 'validation_error');
    expectError(await act(from.cookie, 'nope', 'accept'), 400, 'validation_error');
  });

  it('answers a disabled user the same as a missing one', async () => {
    const from = await t.seedLoggedIn();
    const to = await t.seedUser();
    const missing = await ask(from.cookie, 'no_such_user');
    await t.request('POST', `/api/v1/admin/users/${to.id}/disable`, undefined, { cookie: admin.cookie });
    const disabled = await ask(from.cookie, to.enteredUsername);
    expect(disabled.status).toBe(404);
    expect(disabled.text).toBe(missing.text);
  });

  it('refuses asking yourself, in any case', async () => {
    const from = await t.seedLoggedIn();
    expectError(await ask(from.cookie, from.enteredUsername.toUpperCase()), 400, 'friend_request_self');
  });

  it('refuses duplicates, a pending pair the other way and existing friends', async () => {
    const { from, to, id } = await pending();
    expectError(await ask(from.cookie, to.enteredUsername), 409, 'friend_request_already_sent');
    expectError(await ask(to.cookie, from.enteredUsername), 409, 'friend_request_incoming');
    await act(to.cookie, id, 'accept');
    expectError(await ask(from.cookie, to.enteredUsername), 409, 'already_friends');
    expectError(await ask(to.cookie, from.enteredUsername), 409, 'already_friends');
  });

  it('holds to one row per pair when both ask at once', async () => {
    const a = await t.seedLoggedIn();
    const b = await t.seedLoggedIn();
    const responses = await Promise.all([
      ask(a.cookie, b.enteredUsername),
      ask(b.cookie, a.enteredUsername),
      ask(a.cookie, b.enteredUsername),
    ]);
    expect(responses.filter((response) => response.status === 201)).toHaveLength(1);
    expect(responses.filter((response) => response.status === 409)).toHaveLength(2);
  });
});

describe('answering a request', () => {
  it('makes both members friends on accept', async () => {
    const { from, to, id } = await pending();
    const accepted = await act(to.cookie, id, 'accept');
    expect(accepted.status).toBe(200);
    expect(accepted.body).toMatchObject({ id, relation: 'friend', username: from.enteredUsername });
    expect((await list(from.cookie)).items).toMatchObject([{ id, relation: 'friend', username: to.enteredUsername }]);
    expect((await list(to.cookie)).items).toMatchObject([{ id, relation: 'friend', username: from.enteredUsername }]);
  });

  it('lets only the addressee accept or decline', async () => {
    const { from, id } = await pending();
    const stranger = await t.seedLoggedIn();
    const missing = await act(from.cookie, NO_ID, 'accept');
    for (const cookie of [from.cookie, stranger.cookie, admin.cookie]) {
      for (const action of ['accept', 'decline'] as const) {
        const response = await act(cookie, id, action);
        expect(response.status).toBe(404);
        expect(response.text).toBe(missing.text);
      }
    }
    expect((await list(from.cookie)).items).toMatchObject([{ id, relation: 'outgoing' }]);
  });

  it('lets the sender ask again after a decline', async () => {
    const { from, to, id } = await pending();
    expect((await act(to.cookie, id, 'decline')).status).toBe(204);
    expect((await list(from.cookie)).items).toEqual([]);
    expect((await list(to.cookie)).items).toEqual([]);
    expectError(await act(to.cookie, id, 'accept'), 404, 'friend_request_not_found');
    expect((await ask(from.cookie, to.enteredUsername)).status).toBe(201);
  });

  it('lets only the sender cancel, and only while pending', async () => {
    const { from, to, id } = await pending();
    expectError(await cancel(to.cookie, id), 404, 'friend_request_not_found');
    expect((await cancel(from.cookie, id)).status).toBe(204);
    expectError(await act(to.cookie, id, 'accept'), 404, 'friend_request_not_found');

    const second = await pending();
    await act(second.to.cookie, second.id, 'accept');
    expectError(await cancel(second.from.cookie, second.id), 404, 'friend_request_not_found');
  });
});

describe('unfriending', () => {
  it('works from either side and only between friends', async () => {
    const first = await pending();
    expectError(await unfriend(first.from.cookie, first.id), 404, 'friend_not_found');
    await act(first.to.cookie, first.id, 'accept');
    const stranger = await t.seedLoggedIn();
    expectError(await unfriend(stranger.cookie, first.id), 404, 'friend_not_found');
    expect((await unfriend(first.from.cookie, first.id)).status).toBe(204);
    expect((await list(first.to.cookie)).items).toEqual([]);

    const second = await pending();
    await act(second.to.cookie, second.id, 'accept');
    expect((await unfriend(second.to.cookie, second.id)).status).toBe(204);
    expect((await ask(second.to.cookie, second.from.enteredUsername)).status).toBe(201);
  });
});

describe('the friends list', () => {
  it('shows friends and requests both ways, pages and filters', async () => {
    const me = await t.seedLoggedIn();
    const friend = await t.seedLoggedIn({ username: `a_friend_${String(Date.now()).slice(-8)}` });
    const incoming = await t.seedLoggedIn({ username: `b_incoming_${String(Date.now()).slice(-8)}` });
    const outgoing = await t.seedLoggedIn({ username: `c_outgoing_${String(Date.now()).slice(-8)}` });
    const sent = await ask(friend.cookie, me.enteredUsername);
    await act(me.cookie, (sent.body as { id: string }).id, 'accept');
    await ask(incoming.cookie, me.enteredUsername);
    await ask(me.cookie, outgoing.enteredUsername);

    const first = await list(me.cookie, '?limit=2');
    expect(first.items.map((item) => item.relation)).toEqual(['friend', 'incoming']);
    const second = await list(me.cookie, `?limit=2&cursor=${first.nextCursor ?? ''}`);
    expect(second.items.map((item) => item.relation)).toEqual(['outgoing']);
    expect(second.nextCursor).toBeNull();

    for (const [relation, member] of [
      ['friend', friend],
      ['incoming', incoming],
      ['outgoing', outgoing],
    ] as const) {
      const { items } = await list(me.cookie, `?relation=${relation}`);
      expect(items.map((item) => item.username)).toEqual([member.enteredUsername]);
    }
  });

  it('refuses a cursor it could not have issued, and marks answers private', async () => {
    const me = await t.seedLoggedIn();
    const get = (query: string) => t.request('GET', `/api/v1/friends${query}`, undefined, { cookie: me.cookie });
    const nul = encodeCursor({ sort: 'a\0b', id: NO_ID });
    expectError(await get(`?cursor=${nul}`), 400, 'invalid_cursor');
    expectError(await get('?cursor=garbage'), 400, 'invalid_cursor');
    expect((await get('')).headers.get('cache-control')).toBe('private, no-store');
    expect((await t.request('GET', '/api/v1/friends')).headers.get('cache-control')).toBe('private, no-store');
  });
});
