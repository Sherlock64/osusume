import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TestApp, createTestApp, expectError } from '../test-support/test-app.ts';

let t: TestApp;
let admin: Awaited<ReturnType<TestApp['seedLoggedIn']>>;
let seasonIds: string[];

beforeAll(async () => {
  t = await createTestApp();
  admin = await t.seedLoggedIn({ role: 'admin', isFirstAdmin: true });
  const series = await t.request('POST', '/api/v1/series', { title: 'Shared' }, { cookie: admin.cookie });
  const seriesId = (series.body as { id: string }).id;
  seasonIds = [];
  for (const ordinal of [1, 2, 3, 4]) {
    const season = await t.request(
      'POST',
      '/api/v1/seasons',
      { seriesId, ordinal, title: `S${String(ordinal)}` },
      { cookie: admin.cookie },
    );
    seasonIds.push((season.body as { id: string }).id);
  }
});

afterAll(async () => {
  await t.cleanup();
});

const SECRET_NOTE = 'a-secret-note';

const compare = (cookie: string | undefined, users: string) =>
  t.request('GET', `/api/v1/compare?users=${users}`, undefined, { cookie });

/** A member whose list is visible to members and holds these seasons by index. */
async function withList(visibility: string, seasons: Record<number, string>) {
  const member = await t.seedLoggedIn();
  await t.request('PUT', '/api/v1/me/list-settings', { visibility }, { cookie: member.cookie });
  for (const [index, status] of Object.entries(seasons)) {
    await t.request(
      'PUT',
      `/api/v1/me/list/${seasonIds[Number(index)] ?? ''}`,
      { status, note: SECRET_NOTE },
      { cookie: member.cookie },
    );
  }
  return member;
}

interface CompareBody {
  users: { username: string; available: boolean }[];
  comparison: {
    onAll: { seasonTitle: string; on: string[]; statuses: { username: string; status: string | null }[] }[];
    onSome: { seasonTitle: string; on: string[]; statuses: { username: string; status: string | null }[] }[];
    onOne: { seasonTitle: string; on: string[]; statuses: { username: string; status: string | null }[] }[];
  } | null;
}

describe('compare', () => {
  it('sorts seasons into three groups, with everyone\'s status on every row', async () => {
    const a = await withList('members', { 0: 'completed', 1: 'watching', 2: 'dropped' });
    const b = await withList('members', { 0: 'watching', 1: 'on_hold' });
    const c = await withList('members', { 0: 'plan_to_watch', 3: 'completed' });
    const [an, bn, cn] = [a.enteredUsername, b.enteredUsername, c.enteredUsername];

    const response = await compare(a.cookie, `${an},${bn},${cn}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.text).not.toContain(SECRET_NOTE);
    expect(response.text).not.toContain('"note"');
    const body = response.body as CompareBody;
    expect(body.users).toEqual([
      { username: an, available: true },
      { username: bn, available: true },
      { username: cn, available: true },
    ]);
    expect(body.comparison?.onAll).toMatchObject([
      {
        seasonTitle: 'S1',
        on: [an, bn, cn],
        statuses: [
          { username: an, status: 'completed' },
          { username: bn, status: 'watching' },
          { username: cn, status: 'plan_to_watch' },
        ],
      },
    ]);
    expect(body.comparison?.onSome).toMatchObject([
      {
        seasonTitle: 'S2',
        on: [an, bn],
        statuses: [
          { username: an, status: 'watching' },
          { username: bn, status: 'on_hold' },
          { username: cn, status: null },
        ],
      },
    ]);
    expect(body.comparison?.onOne.map((row) => [row.seasonTitle, row.on])).toEqual([
      ['S3', [an]],
      ['S4', [cn]],
    ]);
    expect(body.comparison?.onOne[0]?.statuses).toEqual([
      { username: an, status: 'dropped' },
      { username: bn, status: null },
      { username: cn, status: null },
    ]);
  });

  it('compares exactly the names given, not adding the viewer', async () => {
    const viewer = await withList('members', { 0: 'completed' });
    const a = await withList('members', { 1: 'watching' });
    const b = await withList('members', { 1: 'watching' });
    const body = (await compare(viewer.cookie, `${a.enteredUsername},${b.enteredUsername}`)).body as CompareBody;
    expect(body.users.map((user) => user.username)).toEqual([a.enteredUsername, b.enteredUsername]);
    expect(body.comparison?.onAll.map((row) => row.seasonTitle)).toEqual(['S2']);
    expect(body.comparison?.onOne).toEqual([]);
  });

  it('marks a missing, disabled or hidden user the same, and leaves them out of the groups', async () => {
    const viewer = await withList('private', { 0: 'completed' });
    const visible = await withList('members', { 0: 'watching' });
    const hidden = await withList('private', { 1: 'dropped' });
    const friendsOnly = await withList('friends', { 1: 'dropped' });
    const disabled = await withList('members', { 1: 'dropped' });
    await t.request('POST', `/api/v1/admin/users/${disabled.id}/disable`, undefined, { cookie: admin.cookie });

    // Typed in another case, so a canonical capitalization coming back would give an account away.
    const typed = [
      visible.enteredUsername,
      hidden.enteredUsername.toUpperCase(),
      'NO_SUCH_USER',
      friendsOnly.enteredUsername.toUpperCase(),
      disabled.enteredUsername.toUpperCase(),
      viewer.enteredUsername,
    ];
    const body = (await compare(viewer.cookie, typed.join(','))).body as CompareBody;
    expect(body.users).toEqual([
      { username: visible.enteredUsername, available: true },
      { username: typed[1], available: false },
      { username: 'NO_SUCH_USER', available: false },
      { username: typed[3], available: false },
      { username: typed[4], available: false },
      { username: viewer.enteredUsername, available: true },
    ]);
    expect(body.comparison?.onAll.map((row) => row.seasonTitle)).toEqual(['S1']);
    expect(body.comparison?.onOne).toEqual([]);
    expect(body.comparison?.onAll[0]?.statuses.map((row) => row.username)).toEqual([
      visible.enteredUsername,
      viewer.enteredUsername,
    ]);
  });

  it('gives no comparison with fewer than two visible lists', async () => {
    const viewer = await withList('private', { 0: 'completed' });
    const hidden = await withList('private', {});
    const one = await compare(viewer.cookie, `${viewer.enteredUsername},${hidden.enteredUsername}`);
    expect(one.status).toBe(200);
    expect(one.body).toEqual({
      users: [
        { username: viewer.enteredUsername, available: true },
        { username: hidden.enteredUsername, available: false },
      ],
      comparison: null,
    });
    expect((await compare(viewer.cookie, 'nobody_a,nobody_b')).body).toEqual({
      users: [
        { username: 'nobody_a', available: false },
        { username: 'nobody_b', available: false },
      ],
      comparison: null,
    });
  });

  it('counts a name given twice once', async () => {
    const viewer = await withList('private', { 0: 'completed' });
    const name = viewer.enteredUsername;
    const body = (await compare(viewer.cookie, `${name},${name.toUpperCase()},,`)).body as CompareBody;
    expect(body.users).toEqual([{ username: name, available: true }]);
    expect(body.comparison).toBeNull();
  });

  it('gives an admin no special view', async () => {
    const hidden = await withList('private', { 0: 'completed' });
    const visible = await withList('members', { 0: 'completed' });
    const body = (await compare(admin.cookie, `${hidden.enteredUsername},${visible.enteredUsername}`)).body as CompareBody;
    expect(body.users.map((user) => user.available)).toEqual([false, true]);
    expect(body.comparison).toBeNull();
  });

  it('refuses bad input and anonymous callers', async () => {
    const viewer = await t.seedLoggedIn();
    expectError(await compare(undefined, 'a,b'), 401, 'unauthenticated');
    expectError(await compare(viewer.cookie, 'a%00b,c'), 400, 'validation_error');
    expectError(await compare(viewer.cookie, ''), 400, 'validation_error');
    expectError(await compare(viewer.cookie, ',,'), 400, 'validation_error');
    const tooMany = Array.from({ length: 101 }, (_, index) => `user_${String(index)}`).join(',');
    expectError(await compare(viewer.cookie, tooMany), 400, 'validation_error');
    expectError(await t.request('GET', '/api/v1/compare', undefined, { cookie: viewer.cookie }), 400, 'validation_error');
  });
});
