import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

type Member = Awaited<ReturnType<TestApp['seedLoggedIn']>>;
interface CanvasBody {
  nodes: { seriesId: string; title: string; x: number | null; y: number | null; groupId: string | null }[];
  links: { seriesAId: string; seriesBId: string; kind: string }[];
  groups: { id: string; name: string }[];
}

const setList = (m: Member, seasonId: string, status: string) =>
  t.request('PUT', `/api/v1/me/list/${seasonId}`, { status }, { cookie: m.cookie });
const unlist = (m: Member, seasonId: string) =>
  t.request('DELETE', `/api/v1/me/list/${seasonId}`, undefined, { cookie: m.cookie });
const canvas = (cookie: string | undefined, username: string) =>
  t.request('GET', `/api/v1/users/${username}/canvas`, undefined, { cookie });
const read = async (m: Member) => (await canvas(m.cookie, m.enteredUsername)).body as CanvasBody;
const link = (m: Member, a: string, b: string, kind = 'recommend') =>
  t.request('PUT', '/api/v1/me/canvas/links', { seriesAId: a, seriesBId: b, kind }, { cookie: m.cookie });
const place = (m: Member, positions: unknown) =>
  t.request('PUT', '/api/v1/me/canvas/positions', { positions }, { cookie: m.cookie });

const friends = async (a: Member, b: Member) => {
  const sent = await t.request('POST', '/api/v1/friends/requests', { username: b.enteredUsername }, { cookie: a.cookie });
  await t.request('POST', `/api/v1/friends/requests/${(sent.body as { id: string }).id}/accept`, undefined, { cookie: b.cookie });
};
const setVisibility = (m: Member, visibility: string) =>
  t.request('PUT', '/api/v1/me/list-settings', { visibility }, { cookie: m.cookie });

let counter = 0;
async function seedSeries(seasons: number, title?: string) {
  counter += 1;
  const created = await t.request(
    'POST',
    '/api/v1/series',
    { title: title ?? `Canvas ${String(counter)}` },
    { cookie: admin.cookie },
  );
  const id = (created.body as { id: string }).id;
  const seasonIds: string[] = [];
  for (let ordinal = 1; ordinal <= seasons; ordinal += 1) {
    const s = await t.request(
      'POST',
      '/api/v1/seasons',
      { seriesId: id, ordinal, title: `S${String(ordinal)}` },
      { cookie: admin.cookie },
    );
    seasonIds.push((s.body as { id: string }).id);
  }
  return { id, seasonIds };
}

describe('the canvas', () => {
  it('has a node per series that has a season past plan to watch', async () => {
    const m = await t.seedLoggedIn();
    const planned = await seedSeries(1, 'B planned');
    const multi = await seedSeries(3, 'B multi');
    const solo = await seedSeries(1, 'A solo');
    await setList(m, planned.seasonIds[0] ?? '', 'plan_to_watch');
    await setList(m, multi.seasonIds[0] ?? '', 'completed');
    await setList(m, multi.seasonIds[1] ?? '', 'watching');
    await setList(m, solo.seasonIds[0] ?? '', 'dropped');
    // A plan-to-watch season next to a started one does not remove the series.
    await setList(m, multi.seasonIds[2] ?? '', 'plan_to_watch');
    const body = await read(m);
    expect(body.nodes.map((n) => n.seriesId)).toEqual([solo.id, multi.id]);
    expect(body.nodes[0]).toMatchObject({ x: null, y: null });
    expect((await read(await t.seedLoggedIn())).nodes).toEqual([]);
  });

  it('applies the list visibility tiers, with one not-found', async () => {
    const owner = await t.seedLoggedIn();
    const friend = await t.seedLoggedIn();
    const stranger = await t.seedLoggedIn();
    const s = await seedSeries(1);
    await setList(owner, s.seasonIds[0] ?? '', 'watching');
    const sent = await t.request('POST', '/api/v1/friends/requests', { username: friend.enteredUsername }, { cookie: owner.cookie });
    await t.request('POST', `/api/v1/friends/requests/${(sent.body as { id: string }).id}/accept`, undefined, { cookie: friend.cookie });
    const missing = await canvas(stranger.cookie, 'no_such_user');
    expect(missing.status).toBe(404);
    const expected = {
      private: [200, 404, 404],
      friends: [200, 200, 404],
      members: [200, 200, 200],
      public: [200, 200, 200],
    } as const;
    for (const [tier, statuses] of Object.entries(expected)) {
      await t.request('PUT', '/api/v1/me/list-settings', { visibility: tier }, { cookie: owner.cookie });
      const got = await Promise.all(
        [owner, friend, stranger].map((v) => canvas(v.cookie, owner.enteredUsername)),
      );
      expect(got.map((r) => r.status)).toEqual(statuses);
      for (const r of got.filter((x) => x.status === 404)) expect(r.text).toBe(missing.text);
    }
    expectError(await canvas(undefined, owner.enteredUsername), 401, 'unauthenticated');
    await t.request('POST', `/api/v1/admin/users/${owner.id}/disable`, undefined, { cookie: admin.cookie });
    expect((await canvas(friend.cookie, owner.enteredUsername)).text).toBe(missing.text);
  });

  it('lets only the owner write, on series that are on the canvas', async () => {
    const m = await t.seedLoggedIn();
    const a = await seedSeries(1);
    const b = await seedSeries(1);
    const off = await seedSeries(1);
    await setList(m, a.seasonIds[0] ?? '', 'watching');
    await setList(m, b.seasonIds[0] ?? '', 'watching');
    await setList(m, off.seasonIds[0] ?? '', 'plan_to_watch');
    const other = await t.seedLoggedIn();
    expectError(
      await t.request('PUT', '/api/v1/me/canvas/links', { seriesAId: a.id, seriesBId: b.id, kind: 'avoid' }),
      401,
      'unauthenticated',
    );
    expectError(await link(other, a.id, b.id), 404, 'series_not_on_canvas');
    expectError(await link(m, a.id, off.id), 404, 'series_not_on_canvas');
    expectError(await link(m, a.id, a.id), 400, 'canvas_link_same_series');
    expectError(await link(m, a.id, b.id, 'nope'), 400, 'validation_error');
    expectError(await place(m, []), 400, 'validation_error');
    expectError(await place(m, [{ seriesId: a.id, x: 'a', y: 1 }]), 400, 'validation_error');

    // Positions for series off the canvas are ignored, and the last of a repeat wins.
    expect((await place(m, [
      { seriesId: a.id, x: 1, y: 2 },
      { seriesId: a.id, x: 3.5, y: -4 },
      { seriesId: off.id, x: 9, y: 9 },
      { seriesId: NO_ID, x: 9, y: 9 },
    ])).status).toBe(204);
    expect((await read(m)).nodes.find((n) => n.seriesId === a.id)).toMatchObject({ x: 3.5, y: -4 });
    expect((await read(other)).nodes).toEqual([]);
  });

  it('keeps one link per pair, whichever way it is written', async () => {
    const m = await t.seedLoggedIn();
    const a = await seedSeries(1);
    const b = await seedSeries(1);
    for (const s of [a, b]) await setList(m, s.seasonIds[0] ?? '', 'completed');
    const [low, high] = [a.id, b.id].sort() as [string, string];
    expect((await link(m, high, low, 'recommend')).body).toEqual({ seriesAId: low, seriesBId: high, kind: 'recommend' });
    expect((await link(m, low, high, 'avoid')).body).toMatchObject({ kind: 'avoid' });
    expect((await read(m)).links).toEqual([{ seriesAId: low, seriesBId: high, kind: 'avoid' }]);
    const remove = () =>
      t.request('DELETE', `/api/v1/me/canvas/links?seriesAId=${high}&seriesBId=${low}`, undefined, { cookie: m.cookie });
    expect((await remove()).status).toBe(204);
    expect((await remove()).status).toBe(204);
    expect((await read(m)).links).toEqual([]);
  });

  it('brings back links and position when a series returns to the list', async () => {
    const m = await t.seedLoggedIn();
    const a = await seedSeries(1);
    const b = await seedSeries(1);
    for (const s of [a, b]) await setList(m, s.seasonIds[0] ?? '', 'watching');
    await link(m, a.id, b.id);
    await place(m, [{ seriesId: a.id, x: 10, y: 20 }]);

    await unlist(m, a.seasonIds[0] ?? '');
    const gone = await read(m);
    expect(gone.nodes.map((n) => n.seriesId)).toEqual([b.id]);
    expect(gone.links).toEqual([]);

    await setList(m, a.seasonIds[0] ?? '', 'on_hold');
    const back = await read(m);
    expect(back.links).toHaveLength(1);
    expect(back.nodes.find((n) => n.seriesId === a.id)).toMatchObject({ x: 10, y: 20 });
  });
});

describe('ratings', () => {
  const rate = (m: Member, seriesId: string, rating: unknown) =>
    t.request('PUT', `/api/v1/me/ratings/${seriesId}`, { rating }, { cookie: m.cookie });

  it('shows on the canvas and the own list, 3 until rated', async () => {
    const m = await t.seedLoggedIn();
    const s = await seedSeries(1);
    await setList(m, s.seasonIds[0] ?? '', 'completed');
    const ratingOf = async () => (await read(m)).nodes[0] as unknown as { rating: number };
    expect((await ratingOf()).rating).toBe(3);
    expect((await rate(m, s.id, 0)).status).toBe(200);
    expect((await ratingOf()).rating).toBe(0);
    expect((await rate(m, s.id, 5)).status).toBe(200);
    expect((await ratingOf()).rating).toBe(5);
    const list = await t.request('GET', '/api/v1/me/list', undefined, { cookie: m.cookie });
    expect((list.body as { items: { rating: number | null }[] }).items[0]?.rating).toBe(5);
    // Another member's rating stays theirs.
    const other = await t.seedLoggedIn();
    await setList(other, s.seasonIds[0] ?? '', 'completed');
    expect((await read(other)).nodes[0]).toMatchObject({ rating: 3 });
  });

  it('filters the own list by rating, unrated counting as 3, alongside status', async () => {
    const m = await t.seedLoggedIn();
    const [a, b, c] = [await seedSeries(1, 'R a'), await seedSeries(1, 'R b'), await seedSeries(1, 'R c')];
    await setList(m, a.seasonIds[0] ?? '', 'completed');
    await setList(m, b.seasonIds[0] ?? '', 'completed');
    await setList(m, c.seasonIds[0] ?? '', 'watching');
    await rate(m, a.id, 5);
    const ids = async (query: string) =>
      ((await t.request('GET', `/api/v1/me/list?${query}`, undefined, { cookie: m.cookie })).body as {
        items: { seriesId: string }[];
      }).items.map((item) => item.seriesId);
    expect(await ids('rating=5')).toEqual([a.id]);
    expect(await ids('rating=3')).toEqual([b.id, c.id]);
    expect(await ids('rating=3&status=watching')).toEqual([c.id]);
    expect(await ids('rating=0')).toEqual([]);
    const bad = await t.request('GET', '/api/v1/me/list?rating=9', undefined, { cookie: m.cookie });
    expect(bad.status).toBe(400);
  });

  it('refuses ratings outside 0 to 5 and unknown series', async () => {
    const m = await t.seedLoggedIn();
    const s = await seedSeries(1);
    for (const bad of [-1, 6, 2.5, '3']) expect((await rate(m, s.id, bad)).status).toBe(400);
    expectError(await rate(m, NO_ID, 3), 404, 'series_not_found');
  });
});

describe('map search', () => {
  const search = (cookie: string | undefined, username: string, q: string) =>
    t.request('GET', `/api/v1/users/${username}/canvas/search?q=${encodeURIComponent(q)}`, undefined, { cookie });
  const ids = async (m: Member, username: string, q: string) =>
    ((await search(m.cookie, username, q)).body as { seriesIds: string[] }).seriesIds;

  it('finds series on the map only, best match first, misspellings included', async () => {
    const m = await t.seedLoggedIn();
    const naruto = await seedSeries(1, 'Naruto Mapsearch');
    const other = await seedSeries(1, 'Mapsearch Naruto Shippuden Extra');
    const planned = await seedSeries(1, 'Naruto Mapsearch Planned');
    await setList(m, other.seasonIds[0] ?? '', 'completed');
    await setList(m, naruto.seasonIds[0] ?? '', 'watching');
    await setList(m, planned.seasonIds[0] ?? '', 'plan_to_watch');
    const found = await ids(m, m.enteredUsername, 'narto mapsearch');
    expect(found[0]).toBe(naruto.id);
    expect(found).toContain(other.id);
    expect(found).not.toContain(planned.id);
    expectError(await search(m.cookie, m.enteredUsername, '  '), 400, 'validation_error');
    expectError(await search(m.cookie, m.enteredUsername, 'a'.repeat(201)), 400, 'validation_error');
  });

  it('returns at most 20', async () => {
    const m = await t.seedLoggedIn();
    for (let i = 0; i < 21; i += 1) {
      const s = await seedSeries(1, `Limitcase ${String(i)}`);
      await setList(m, s.seasonIds[0] ?? '', 'watching');
    }
    expect(await ids(m, m.enteredUsername, 'Limitcase')).toHaveLength(20);
  });

  it('follows the canvas visibility, with its one not-found', async () => {
    const owner = await t.seedLoggedIn();
    const friend = await t.seedLoggedIn();
    const stranger = await t.seedLoggedIn();
    const s = await seedSeries(1, 'Visiblesearch');
    await setList(owner, s.seasonIds[0] ?? '', 'watching');
    await friends(owner, friend);
    const missing = await canvas(stranger.cookie, 'no_such_user');
    await setVisibility(owner, 'friends');
    expect(await ids(friend, owner.enteredUsername, 'Visiblesearch')).toEqual([s.id]);
    const hidden = await search(stranger.cookie, owner.enteredUsername, 'Visiblesearch');
    expect(hidden.status).toBe(404);
    expect(hidden.text).toBe(missing.text);
    expectError(await search(undefined, owner.enteredUsername, 'x'), 401, 'unauthenticated');
  });
});

describe('groups', () => {
  const create = (m: Member, name: unknown, seriesId: string) =>
    t.request('POST', '/api/v1/me/canvas/groups', { name, seriesId }, { cookie: m.cookie });
  const rename = (m: Member, groupId: string, name: unknown) =>
    t.request('PATCH', `/api/v1/me/canvas/groups/${groupId}`, { name }, { cookie: m.cookie });
  const remove = (m: Member, groupId: string) =>
    t.request('DELETE', `/api/v1/me/canvas/groups/${groupId}`, undefined, { cookie: m.cookie });
  const add = (m: Member, groupId: string, seriesId: string) =>
    t.request('PUT', `/api/v1/me/canvas/groups/${groupId}/series/${seriesId}`, undefined, { cookie: m.cookie });
  const takeOut = (m: Member, groupId: string, seriesId: string) =>
    t.request('DELETE', `/api/v1/me/canvas/groups/${groupId}/series/${seriesId}`, undefined, { cookie: m.cookie });
  const groupOf = async (m: Member, seriesId: string) =>
    (await read(m)).nodes.find((n) => n.seriesId === seriesId)?.groupId;

  async function onCanvas(m: Member, count: number) {
    const all: { id: string }[] = [];
    for (let i = 0; i < count; i += 1) {
      const s = await seedSeries(1);
      await setList(m, s.seasonIds[0] ?? '', 'watching');
      all.push(s);
    }
    return all as [{ id: string }, { id: string }];
  }

  it('creates, renames, adds, removes and deletes, as the owner and a visitor see it', async () => {
    const m = await t.seedLoggedIn();
    const friend = await t.seedLoggedIn();
    const stranger = await t.seedLoggedIn();
    await friends(m, friend);
    await setVisibility(m, 'friends');
    const [a, b] = (await onCanvas(m, 2)) as [{ id: string }, { id: string }];
    const created = await create(m, '  Shonen  ', a.id);
    expect(created.status).toBe(201);
    const group = created.body as { id: string; name: string };
    expect(group.name).toBe('Shonen');
    expect((await rename(m, group.id, 'Battle')).body).toEqual({ id: group.id, name: 'Battle' });
    expect((await add(m, group.id, b.id)).status).toBe(204);
    for (const viewer of [m, friend]) {
      const body = (await canvas(viewer.cookie, m.enteredUsername)).body as CanvasBody;
      expect(body.groups).toEqual([{ id: group.id, name: 'Battle' }]);
      expect(body.nodes.map((n) => n.groupId)).toEqual([group.id, group.id]);
    }
    expect((await canvas(stranger.cookie, m.enteredUsername)).status).toBe(404);
    expect((await takeOut(m, group.id, a.id)).status).toBe(204);
    expect((await takeOut(m, group.id, a.id)).status).toBe(204);
    expect(await groupOf(m, a.id)).toBeNull();
    expect((await remove(m, group.id)).status).toBe(204);
    expect((await read(m)).groups).toEqual([]);
    expect(await groupOf(m, b.id)).toBeNull();
  });

  it('refuses another member and series off their canvas, and bad names', async () => {
    const m = await t.seedLoggedIn();
    const other = await t.seedLoggedIn();
    const [a] = await onCanvas(m, 1);
    const [mine] = await onCanvas(other, 1);
    const group = (await create(m, 'Mine', a.id)).body as { id: string };
    expectError(await rename(other, group.id, 'x'), 404, 'canvas_group_not_found');
    expectError(await remove(other, group.id), 404, 'canvas_group_not_found');
    expectError(await add(other, group.id, mine.id), 404, 'canvas_group_not_found');
    expectError(await takeOut(other, group.id, a.id), 404, 'canvas_group_not_found');
    expectError(await add(m, NO_ID, a.id), 404, 'canvas_group_not_found');
    expectError(await add(m, group.id, mine.id), 404, 'series_not_on_canvas');
    expectError(await create(other, 'x', a.id), 404, 'series_not_on_canvas');
    for (const name of ['', '   ', 'a'.repeat(61)]) {
      expectError(await create(m, name, a.id), 400, 'validation_error');
      expectError(await rename(m, group.id, name), 400, 'validation_error');
    }
    expect((await read(m)).groups).toEqual([{ id: group.id, name: 'Mine' }]);
  });

  it('keeps a series in one group, and a group goes with its last member', async () => {
    const m = await t.seedLoggedIn();
    const [a, b] = (await onCanvas(m, 2)) as [{ id: string }, { id: string }];
    const groupA = (await create(m, 'A', a.id)).body as { id: string };
    const groupB = (await create(m, 'B', b.id)).body as { id: string };
    expect((await add(m, groupB.id, a.id)).status).toBe(204);
    expect(await groupOf(m, a.id)).toBe(groupB.id);
    expectError(await rename(m, groupA.id, 'gone'), 404, 'canvas_group_not_found');
    // Starting a new group moves the series too.
    const groupC = (await create(m, 'C', a.id)).body as { id: string };
    expect((await read(m)).groups.map((g) => g.id)).toEqual([groupB.id, groupC.id]);
    expect((await takeOut(m, groupC.id, a.id)).status).toBe(204);
    expectError(await rename(m, groupC.id, 'gone'), 404, 'canvas_group_not_found');
  });

  it('leaves positions and lines alone when a group is deleted', async () => {
    const m = await t.seedLoggedIn();
    const [a, b] = (await onCanvas(m, 2)) as [{ id: string }, { id: string }];
    await link(m, a.id, b.id);
    await place(m, [{ seriesId: a.id, x: 5, y: 6 }]);
    const group = (await create(m, 'G', a.id)).body as { id: string };
    await add(m, group.id, b.id);
    await remove(m, group.id);
    const body = await read(m);
    expect(body.links).toHaveLength(1);
    expect(body.nodes.find((n) => n.seriesId === a.id)).toMatchObject({ x: 5, y: 6, groupId: null });
  });

  it('hides members off the list, and the group when all are', async () => {
    const m = await t.seedLoggedIn();
    const a = await seedSeries(1);
    const b = await seedSeries(1);
    for (const s of [a, b]) await setList(m, s.seasonIds[0] ?? '', 'watching');
    const group = (await create(m, 'G', a.id)).body as { id: string };
    await add(m, group.id, b.id);
    await unlist(m, a.seasonIds[0] ?? '');
    expect((await read(m)).groups).toHaveLength(1);
    await unlist(m, b.seasonIds[0] ?? '');
    expect((await read(m)).groups).toEqual([]);
    await setList(m, a.seasonIds[0] ?? '', 'completed');
    const back = await read(m);
    expect(back.groups).toEqual([{ id: group.id, name: 'G' }]);
    expect(back.nodes[0]?.groupId).toBe(group.id);
  });
});
