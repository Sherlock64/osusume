import { eq, or } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { friendship, listEntry, listSettings } from '../db/schema.ts';
import { encodeCursor } from '../lib/pagination.ts';
import { PASSWORD, type TestApp, createTestApp, expectError } from '../test-support/test-app.ts';

let t: TestApp;
let admin: Awaited<ReturnType<TestApp['seedLoggedIn']>>;
const NO_ID = '00000000-0000-4000-8000-000000000000';
const SECRET_NOTE = 'a-secret-note';

beforeAll(async () => {
  t = await createTestApp();
  admin = await t.seedLoggedIn({ role: 'admin', isFirstAdmin: true });
});

afterAll(async () => {
  await t.cleanup();
});

const put = (cookie: string | undefined, seasonId: string, body: unknown) =>
  t.request('PUT', `/api/v1/me/list/${seasonId}`, body, { cookie });
const myList = (cookie: string | undefined, query = '') =>
  t.request('GET', `/api/v1/me/list${query}`, undefined, { cookie });
const setVisibility = async (cookie: string, visibility: string) => {
  const response = await t.request('PUT', '/api/v1/me/list-settings', { visibility }, { cookie });
  expect(response.status).toBe(200);
  return response.body as { visibility: string; publicSlug: string | null };
};
const memberList = (cookie: string | undefined, username: string, query = '') =>
  t.request('GET', `/api/v1/users/${username}/list${query}`, undefined, { cookie });
const publicList = (slug: string, query = '') =>
  t.request('GET', `/api/v1/lists/${slug}${query}`);
const adminAction = (id: string, action: string) =>
  t.request('POST', `/api/v1/admin/users/${id}/${action}`, undefined, { cookie: admin.cookie });

let seriesCounter = 0;

/** A series with this many seasons, returning its id and season ids in order. */
async function seedSeries(seasons: number, title?: string) {
  seriesCounter += 1;
  const created = await t.request(
    'POST',
    '/api/v1/series',
    { title: title ?? `Series ${String(seriesCounter)}` },
    { cookie: admin.cookie },
  );
  expect(created.status).toBe(201);
  const id = (created.body as { id: string }).id;
  const seasonIds: string[] = [];
  for (let ordinal = 1; ordinal <= seasons; ordinal += 1) {
    const season = await t.request(
      'POST',
      '/api/v1/seasons',
      { seriesId: id, ordinal, title: `Season ${String(ordinal)}` },
      { cookie: admin.cookie },
    );
    expect(season.status).toBe(201);
    seasonIds.push((season.body as { id: string }).id);
  }
  return { id, seasonIds };
}

async function befriend(a: { cookie: string }, b: { cookie: string; enteredUsername: string }) {
  const sent = await t.request(
    'POST',
    '/api/v1/friends/requests',
    { username: b.enteredUsername },
    { cookie: a.cookie },
  );
  const id = (sent.body as { id: string }).id;
  await t.request('POST', `/api/v1/friends/requests/${id}/accept`, undefined, { cookie: b.cookie });
}

/** Uploads a cover into a series' catalog; the first one becomes its primary. */
async function addCover(seriesId: string) {
  const png = await sharp({ create: { width: 60, height: 90, channels: 3, background: 'teal' } }).png().toBuffer();
  const response = await t.upload(seriesId, png, { cookie: admin.cookie });
  expect(response.status).toBe(201);
  return response.body as { id: string; width: number; height: number };
}

interface ListBody {
  items: {
    seriesId: string;
    cover: { id: string; width: number; height: number } | null;
    seriesStatus: { status: string; label: string; count: number; totalSeasons: number };
    seasons: { seasonId: string; status: string; matched: boolean; note?: string | null }[];
  }[];
  nextCursor: string | null;
}

describe('the watch list', () => {
  it('needs a session and a real season', async () => {
    const member = await t.seedLoggedIn();
    const { seasonIds } = await seedSeries(1);
    expectError(await myList(undefined), 401, 'unauthenticated');
    expectError(await put(undefined, seasonIds[0] ?? '', { status: 'watching' }), 401, 'unauthenticated');
    expectError(await put(member.cookie, NO_ID, { status: 'watching' }), 404, 'season_not_found');
    expectError(await put(member.cookie, 'nope', { status: 'watching' }), 400, 'validation_error');
    expectError(await put(member.cookie, NO_ID, { status: 'nope' }), 400, 'validation_error');
  });

  it('keeps one entry per season, and the note until it is cleared', async () => {
    const member = await t.seedLoggedIn();
    const seasonId = (await seedSeries(1)).seasonIds[0] ?? '';
    const added = await put(member.cookie, seasonId, { status: 'watching', note: '  mine  ' });
    expect(added.status).toBe(200);
    expect(added.body).toMatchObject({ seasonId, status: 'watching', note: 'mine' });

    const changed = await put(member.cookie, seasonId, { status: 'completed' });
    expect(changed.body).toMatchObject({ status: 'completed', note: 'mine' });
    expect(await t.db.select().from(listEntry).where(eq(listEntry.userId, member.id))).toHaveLength(1);

    expect((await put(member.cookie, seasonId, { status: 'completed', note: null })).body).toMatchObject({ note: null });
    await put(member.cookie, seasonId, { status: 'completed', note: 'again' });
    expect((await put(member.cookie, seasonId, { status: 'completed', note: '  ' })).body).toMatchObject({ note: null });
  });

  it('holds to one entry under concurrency', async () => {
    const member = await t.seedLoggedIn();
    const seasonId = (await seedSeries(1)).seasonIds[0] ?? '';
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => put(member.cookie, seasonId, { status: 'watching' })),
    );
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200, 200]);
    expect(await t.db.select().from(listEntry).where(eq(listEntry.userId, member.id))).toHaveLength(1);
  });

  it('takes a season off', async () => {
    const member = await t.seedLoggedIn();
    const seasonId = (await seedSeries(1)).seasonIds[0] ?? '';
    await put(member.cookie, seasonId, { status: 'watching' });
    const remove = () =>
      t.request('DELETE', `/api/v1/me/list/${seasonId}`, undefined, { cookie: member.cookie });
    expect((await remove()).status).toBe(204);
    expectError(await remove(), 404, 'list_entry_not_found');
    expect((await myList(member.cookie)).body).toEqual({ items: [], nextCursor: null });
  });

  it('derives the series status over all its seasons in the catalog', async () => {
    const member = await t.seedLoggedIn();
    const { id, seasonIds } = await seedSeries(3);
    await put(member.cookie, seasonIds[0] ?? '', { status: 'completed' });
    await put(member.cookie, seasonIds[1] ?? '', { status: 'completed' });
    const body = (await myList(member.cookie)).body as ListBody;
    expect(body.items[0]?.seriesId).toBe(id);
    expect(body.items[0]?.seriesStatus).toEqual({
      status: 'completed',
      count: 2,
      totalSeasons: 3,
      label: 'Completed 2/3 seasons',
    });
  });

  it("carries each series' primary cover on the own and member lists", async () => {
    const owner = await t.seedLoggedIn();
    const viewer = await t.seedLoggedIn();
    await setVisibility(owner.cookie, 'members');
    const covered = await seedSeries(1, 'A covered');
    const bare = await seedSeries(1, 'B bare');
    const { id, width, height } = await addCover(covered.id);
    await put(owner.cookie, covered.seasonIds[0] ?? '', { status: 'watching' });
    await put(owner.cookie, bare.seasonIds[0] ?? '', { status: 'watching' });
    for (const response of [await myList(owner.cookie), await memberList(viewer.cookie, owner.enteredUsername)]) {
      const body = response.body as ListBody;
      expect(body.items.map((item) => item.cover)).toEqual([{ id, width, height }, null]);
    }
  });

  it('filters by any season, shows all of the series and marks the matching seasons', async () => {
    const member = await t.seedLoggedIn();
    const { id, seasonIds } = await seedSeries(3);
    const other = await seedSeries(1);
    await put(member.cookie, seasonIds[0] ?? '', { status: 'completed' });
    await put(member.cookie, seasonIds[1] ?? '', { status: 'watching' });
    await put(member.cookie, other.seasonIds[0] ?? '', { status: 'dropped' });

    for (const [status, matching] of [
      ['completed', seasonIds[0]],
      ['watching', seasonIds[1]],
    ] as const) {
      const body = (await myList(member.cookie, `?status=${status}`)).body as ListBody;
      expect(body.items.map((item) => item.seriesId)).toEqual([id]);
      expect(body.items[0]?.seasons.map((season) => season.seasonId)).toEqual(seasonIds.slice(0, 2));
      expect(
        body.items[0]?.seasons.filter((season) => season.matched).map((season) => season.seasonId),
      ).toEqual([matching]);
      // The status of a series does not depend on the filter.
      expect(body.items[0]?.seriesStatus.label).toBe('Watching 1/3 seasons');
    }

    const all = (await myList(member.cookie)).body as ListBody;
    expect(all.items).toHaveLength(2);
    expect(all.items.flatMap((item) => item.seasons).some((season) => season.matched)).toBe(false);
    expect(((await myList(member.cookie, '?status=on_hold')).body as ListBody).items).toEqual([]);
    expectError(await myList(member.cookie, '?status=nope'), 400, 'validation_error');
  });

  it('pages by series', async () => {
    const member = await t.seedLoggedIn();
    const expected: string[] = [];
    for (const title of ['Page A', 'Page B', 'Page C']) {
      const { id, seasonIds } = await seedSeries(2, title);
      expected.push(id);
      await put(member.cookie, seasonIds[0] ?? '', { status: 'watching' });
      await put(member.cookie, seasonIds[1] ?? '', { status: 'watching' });
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const query: string = `?limit=2${cursor === null ? '' : `&cursor=${cursor}`}`;
      const body = (await myList(member.cookie, query)).body as ListBody;
      expect(body.items.every((item) => item.seasons.length === 2)).toBe(true);
      seen.push(...body.items.map((item) => item.seriesId));
      cursor = body.nextCursor;
    } while (cursor !== null);
    expect(seen).toEqual(expected);
  });

  it('searches the own list by title, alternate title and season, with the other filters', async () => {
    const member = await t.seedLoggedIn();
    const naruto = await seedSeries(2, 'Naruto');
    const viaAlt = await t.request(
      'POST',
      '/api/v1/series',
      { title: 'Search Alt Parent', altTitles: ['Naruto Gaiden'] },
      { cookie: admin.cookie },
    );
    const altId = (viaAlt.body as { id: string }).id;
    const altSeason = await t.request(
      'POST',
      '/api/v1/seasons',
      { seriesId: altId, ordinal: 1, title: 'Season 1' },
      { cookie: admin.cookie },
    );
    const viaSeason = await seedSeries(0, 'Search Season Parent');
    const narutoSeason = await t.request(
      'POST',
      '/api/v1/seasons',
      { seriesId: viaSeason.id, ordinal: 1, title: 'Naruto Shippuden' },
      { cookie: admin.cookie },
    );
    const other = await seedSeries(1, 'Search Unrelated');
    await put(member.cookie, naruto.seasonIds[0] ?? '', { status: 'watching' });
    await put(member.cookie, naruto.seasonIds[1] ?? '', { status: 'completed' });
    await put(member.cookie, (altSeason.body as { id: string }).id, { status: 'completed' });
    await put(member.cookie, (narutoSeason.body as { id: string }).id, { status: 'completed' });
    await put(member.cookie, other.seasonIds[0] ?? '', { status: 'watching' });
    await t.request('PUT', `/api/v1/me/ratings/${altId}`, { rating: 5 }, { cookie: member.cookie });
    const ids = async (query: string) =>
      ((await myList(member.cookie, query)).body as ListBody).items.map((item) => item.seriesId);

    const all = [naruto.id, altId, viaSeason.id, other.id];
    const matches = [naruto.id, altId, viaSeason.id];
    expect(new Set(await ids('?q=narto'))).toEqual(new Set(matches));
    expect(new Set(await ids('?q=%20%20'))).toEqual(new Set(all));
    expect(await ids('?q=narto&status=watching')).toEqual([naruto.id]);
    expect(await ids('?q=narto&rating=5')).toEqual([altId]);
    expect(await ids('?q=narto&status=watching&rating=5')).toEqual([]);

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const query: string = `?q=narto&limit=1${cursor === null ? '' : `&cursor=${cursor}`}`;
      const body = (await myList(member.cookie, query)).body as ListBody;
      seen.push(...body.items.map((item) => item.seriesId));
      cursor = body.nextCursor;
    } while (cursor !== null);
    expect(seen.sort()).toEqual([...matches].sort());

    expectError(await myList(member.cookie, `?q=${'x'.repeat(201)}`), 400, 'validation_error');
    expect(await ids(`?q=${'x'.repeat(200)}`)).toEqual([]);
    await setVisibility(member.cookie, 'members');
    const viewer = await t.seedLoggedIn();
    const theirs = (await memberList(viewer.cookie, member.enteredUsername, '?q=zzzz')).body as ListBody;
    expect(theirs.items).toHaveLength(all.length);
  });

  it('answers bad input with a 400, never a 500', async () => {
    const member = await t.seedLoggedIn();
    const seasonId = (await seedSeries(1)).seasonIds[0] ?? '';
    await setVisibility(member.cookie, 'members');
    expectError(await put(member.cookie, seasonId, { status: 'watching', note: 'a\0b' }), 400, 'validation_error');
    expectError(await put(member.cookie, seasonId, { status: 'watching', note: 'x'.repeat(10_001) }), 400, 'validation_error');
    expectError(await memberList(member.cookie, 'a%00b'), 400, 'validation_error');
    expectError(await publicList('a%00b'), 400, 'validation_error');

    const nul = encodeCursor({ sort: 'a\0b', id: NO_ID });
    const longSort = encodeCursor({ sort: 'x'.repeat(501), id: NO_ID });
    const numericSort = encodeCursor({ sort: 1e300, id: NO_ID });
    const badId = Buffer.from(JSON.stringify(['a', 'nope'])).toString('base64url');
    for (const cursor of [nul, longSort, numericSort, badId, 'garbage']) {
      expectError(await myList(member.cookie, `?cursor=${cursor}`), 400, 'invalid_cursor');
      expectError(await memberList(member.cookie, member.enteredUsername, `?cursor=${cursor}`), 400, 'invalid_cursor');
      expectError(await publicList('whatever', `?cursor=${cursor}`), 400, 'invalid_cursor');
    }
    for (const limit of ['0', '101', '1e400', 'a']) {
      expectError(await myList(member.cookie, `?limit=${limit}`), 400, 'validation_error');
    }
  });

  it('marks every per-user answer private, including refusals', async () => {
    const member = await t.seedLoggedIn();
    const responses = [
      await myList(member.cookie),
      await myList(undefined),
      await myList(member.cookie, '?limit=0'),
      await memberList(member.cookie, 'no_such_user'),
      await t.request('GET', '/api/v1/me/list-settings', undefined, { cookie: member.cookie }),
    ];
    for (const response of responses) {
      expect(response.headers.get('cache-control')).toBe('private, no-store');
    }
  });
});

describe('who can see a list', () => {
  /** The owner with a noted season on the list, and a friend. */
  async function ownerWithList() {
    const owner = await t.seedLoggedIn();
    const friend = await t.seedLoggedIn();
    await befriend(owner, friend);
    await put(owner.cookie, (await seedSeries(1)).seasonIds[0] ?? '', {
      status: 'watching',
      note: SECRET_NOTE,
    });
    return { owner, friend };
  }

  it('defaults to private with no settings row until one is chosen', async () => {
    const member = await t.seedLoggedIn();
    const read = await t.request('GET', '/api/v1/me/list-settings', undefined, { cookie: member.cookie });
    expect(read.status).toBe(200);
    expect(read.body).toEqual({ visibility: 'private', publicSlug: null });
    expect(await t.db.select().from(listSettings).where(eq(listSettings.userId, member.id))).toEqual([]);
    await setVisibility(member.cookie, 'friends');
    expect(await t.db.select().from(listSettings).where(eq(listSettings.userId, member.id))).toHaveLength(1);
  });

  it.each([
    ['private', { owner: true, friend: false, stranger: false, admin: false }],
    ['friends', { owner: true, friend: true, stranger: false, admin: false }],
    ['members', { owner: true, friend: true, stranger: true, admin: true }],
    ['public', { owner: true, friend: true, stranger: true, admin: true }],
  ] as const)('applies the %s tier, to admins too', async (tier, expected) => {
    const { owner, friend } = await ownerWithList();
    const stranger = await t.seedLoggedIn();
    await setVisibility(owner.cookie, tier);
    const missing = await memberList(stranger.cookie, 'no_such_user');
    const viewers = { owner, friend, stranger, admin };
    for (const [name, viewer] of Object.entries(viewers)) {
      const response = await memberList(viewer.cookie, owner.enteredUsername);
      if (expected[name as keyof typeof expected]) {
        expect(response.status).toBe(200);
        expect(response.text).not.toContain(SECRET_NOTE);
        expect(response.text).not.toContain('"note"');
        expect((response.body as ListBody).items).toHaveLength(1);
      } else {
        expect(response.status).toBe(404);
        expect(response.text).toBe(missing.text);
      }
    }
  });

  it('looks a username up ignoring case', async () => {
    const owner = await t.seedLoggedIn({ username: `MixedCase_${String(Date.now()).slice(-8)}` });
    await setVisibility(owner.cookie, 'members');
    expect((await memberList(admin.cookie, owner.enteredUsername.toUpperCase())).status).toBe(200);
  });

  it('needs a login at every tier, so a username never reaches a list anonymously', async () => {
    const { owner } = await ownerWithList();
    await setVisibility(owner.cookie, 'public');
    expectError(await memberList(undefined, owner.enteredUsername), 401, 'unauthenticated');
  });

  it('hides a disabled user with the same not-found, and shows them again when enabled', async () => {
    const { owner, friend } = await ownerWithList();
    await setVisibility(owner.cookie, 'members');
    const missing = await memberList(friend.cookie, 'no_such_user');
    await adminAction(owner.id, 'disable');
    for (const viewer of [friend, admin]) {
      const hidden = await memberList(viewer.cookie, owner.enteredUsername);
      expect(hidden.status).toBe(404);
      expect(hidden.text).toBe(missing.text);
    }
    await adminAction(owner.id, 'enable');
    expect((await memberList(friend.cookie, owner.enteredUsername)).status).toBe(200);
  });

  it('stops showing a friends list after unfriending or to a pending friend', async () => {
    const owner = await t.seedLoggedIn();
    const other = await t.seedLoggedIn();
    await setVisibility(owner.cookie, 'friends');
    const sent = await t.request(
      'POST',
      '/api/v1/friends/requests',
      { username: owner.enteredUsername },
      { cookie: other.cookie },
    );
    const id = (sent.body as { id: string }).id;
    expect((await memberList(other.cookie, owner.enteredUsername)).status).toBe(404);
    await t.request('POST', `/api/v1/friends/requests/${id}/accept`, undefined, { cookie: owner.cookie });
    expect((await memberList(other.cookie, owner.enteredUsername)).status).toBe(200);
    await t.request('DELETE', `/api/v1/friends/${id}`, undefined, { cookie: owner.cookie });
    expect((await memberList(other.cookie, owner.enteredUsername)).status).toBe(404);
  });
});

describe('a public list', () => {
  async function publicOwner() {
    const owner = await t.seedLoggedIn();
    const { id, seasonIds } = await seedSeries(2, 'Public Series');
    const cover = await addCover(id);
    await put(owner.cookie, seasonIds[0] ?? '', { status: 'completed', note: SECRET_NOTE });
    const settings = await setVisibility(owner.cookie, 'public');
    return { owner, slug: settings.publicSlug ?? '', cover };
  }

  it('shows titles, covers and status only, with no login, unindexed and uncached', async () => {
    const { owner, slug, cover } = await publicOwner();
    expect(slug.length).toBeGreaterThanOrEqual(32);
    const response = await publicList(slug);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      items: [
        {
          title: 'Public Series',
          cover: { id: cover.id, width: cover.width, height: cover.height },
          seriesStatus: {
            status: 'completed',
            count: 1,
            totalSeasons: 2,
            label: 'Completed 1/2 seasons',
          },
          seasons: [{ title: 'Season 1', status: 'completed', matched: false }],
        },
      ],
      nextCursor: null,
    });
    expect(response.text).not.toContain(SECRET_NOTE);
    expect(response.text).not.toContain(owner.enteredUsername);
    expect(response.headers.get('x-robots-tag')).toBe('noindex');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('has a slug only while public, and a new one on going public again', async () => {
    const { owner, slug } = await publicOwner();
    expect((await setVisibility(owner.cookie, 'public')).publicSlug).toBe(slug);

    const unknown = await publicList('no-such-slug');
    expectError(unknown, 404, 'list_not_found');
    expect(unknown.headers.get('x-robots-tag')).toBe('noindex');
    expect(unknown.headers.get('cache-control')).toBe('no-store');

    for (const tier of ['members', 'friends', 'private']) {
      expect((await setVisibility(owner.cookie, 'public')).publicSlug).not.toBeNull();
      expect((await setVisibility(owner.cookie, tier)).publicSlug).toBeNull();
    }
    expect((await publicList(slug)).text).toBe(unknown.text);
    const again = await setVisibility(owner.cookie, 'public');
    expect(again.publicSlug).not.toBe(slug);
    expect((await publicList(again.publicSlug ?? '')).status).toBe(200);
  });

  it('keeps the slug rule when visibility changes race', async () => {
    const { owner } = await publicOwner();
    const responses = await Promise.all(
      ['private', 'public', 'friends', 'public', 'members', 'public'].map((visibility) =>
        t.request('PUT', '/api/v1/me/list-settings', { visibility }, { cookie: owner.cookie }),
      ),
    );
    expect(responses.every((response) => response.status === 200)).toBe(true);
  });

  it('hides a disabled user behind the same not-found as an unknown slug', async () => {
    const { owner, slug } = await publicOwner();
    const unknown = await publicList('no-such-slug');
    await adminAction(owner.id, 'disable');
    const hidden = await publicList(slug);
    expect(hidden.status).toBe(404);
    expect(hidden.text).toBe(unknown.text);
    await adminAction(owner.id, 'enable');
    expect((await publicList(slug)).status).toBe(200);
  });

  it('tells crawlers to stay away', async () => {
    const response = await t.request('GET', '/robots.txt');
    expect(response.status).toBe(200);
    expect(response.text).toContain('Disallow: /lists/');
    expect(response.text).toContain('Disallow: /api/v1/lists/');
  });
});

describe('the catalog with lists through the api', () => {
  it('cannot delete a season on a list until it comes off', async () => {
    const member = await t.seedLoggedIn();
    const seasonId = (await seedSeries(1)).seasonIds[0] ?? '';
    await put(member.cookie, seasonId, { status: 'watching' });
    const remove = () =>
      t.request('DELETE', `/api/v1/seasons/${seasonId}`, undefined, { cookie: admin.cookie });
    expectError(await remove(), 409, 'season_on_list');
    await t.request('DELETE', `/api/v1/me/list/${seasonId}`, undefined, { cookie: member.cookie });
    expect((await remove()).status).toBe(204);
  });

  it('keeps list entries when an admin moves a season to another series', async () => {
    const member = await t.seedLoggedIn();
    const from = await seedSeries(2);
    const to = await seedSeries(1);
    const seasonId = from.seasonIds[1] ?? '';
    await put(member.cookie, seasonId, { status: 'completed', note: 'kept' });

    const moved = await t.request(
      'PATCH',
      `/api/v1/seasons/${seasonId}`,
      { seriesId: to.id, ordinal: 5 },
      { cookie: admin.cookie },
    );
    expect(moved.status).toBe(200);

    const body = (await myList(member.cookie)).body as ListBody;
    expect(body.items.map((item) => item.seriesId)).toEqual([to.id]);
    expect(body.items[0]?.seriesStatus.label).toBe('Completed 1/2 seasons');
    expect(body.items[0]?.seasons).toMatchObject([{ seasonId, status: 'completed', note: 'kept' }]);
  });
});

describe('removing a user through the api', () => {
  async function userWithEverything() {
    const member = await t.seedLoggedIn();
    const friend = await t.seedLoggedIn();
    const asked = await t.seedLoggedIn();
    const asker = await t.seedLoggedIn();
    await befriend(member, friend);
    await t.request('POST', '/api/v1/friends/requests', { username: asked.enteredUsername }, { cookie: member.cookie });
    await t.request('POST', '/api/v1/friends/requests', { username: member.enteredUsername }, { cookie: asker.cookie });
    await put(member.cookie, (await seedSeries(1)).seasonIds[0] ?? '', { status: 'watching' });
    await setVisibility(member.cookie, 'public');
    const pairs = () =>
      t.db
        .select()
        .from(friendship)
        .where(or(eq(friendship.requesterId, member.id), eq(friendship.addresseeId, member.id)));
    expect(await pairs()).toHaveLength(3);
    return { member, friend, pairs };
  }

  it.each(['remove', 'ban', 'delete own account'])('deletes it all on: %s', async (how) => {
    const { member, friend, pairs } = await userWithEverything();
    const settings = await t.db.select().from(listSettings).where(eq(listSettings.userId, member.id));
    const slug = settings[0]?.publicSlug ?? '';
    expect((await publicList(slug)).status).toBe(200);

    const response =
      how === 'delete own account'
        ? await t.request('DELETE', '/api/v1/me', { currentPassword: PASSWORD }, { cookie: member.cookie })
        : await adminAction(member.id, how);
    expect(response.status).toBeLessThan(300);

    expect(await t.db.select().from(listEntry).where(eq(listEntry.userId, member.id))).toEqual([]);
    expect(await t.db.select().from(listSettings).where(eq(listSettings.userId, member.id))).toEqual([]);
    expect(await pairs()).toEqual([]);
    expect((await publicList(slug)).status).toBe(404);
    const friends = await t.request('GET', '/api/v1/friends', undefined, { cookie: friend.cookie });
    expect(friends.body).toEqual({ items: [], nextCursor: null });
  });
});
