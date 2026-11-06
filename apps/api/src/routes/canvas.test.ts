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
  nodes: { seriesId: string; title: string; x: number | null; y: number | null }[];
  links: { seriesAId: string; seriesBId: string; kind: string }[];
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
