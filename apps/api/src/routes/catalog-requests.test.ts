import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { removeUser } from '../auth/accounts.ts';
import { catalogRequest, season, series, tag } from '../db/schema.ts';
import { lockCatalog } from '../lib/locks.ts';
import { type TestApp, type TestResponse, createTestApp, expectError } from '../test-support/test-app.ts';

let t: TestApp;
let admin: Awaited<ReturnType<TestApp['seedLoggedIn']>>;
let member: Awaited<ReturnType<TestApp['seedLoggedIn']>>;
let otherMember: Awaited<ReturnType<TestApp['seedLoggedIn']>>;

beforeAll(async () => {
  t = await createTestApp();
  admin = await t.seedLoggedIn({ role: 'admin', isFirstAdmin: true });
  member = await t.seedLoggedIn();
  otherMember = await t.seedLoggedIn();
});

afterAll(async () => {
  await t.cleanup();
});

const NO_ID = '00000000-0000-4000-8000-000000000000';

interface RequestBody {
  id: string;
  kind: string;
  seriesId: string | null;
  seriesTitle: string | null;
  status: string;
  decisionNote: string | null;
  requesterId?: string | null;
  requesterUsername?: string | null;
  reviewedBy?: string | null;
  proposal: Record<string, unknown>;
}
interface Page<Item> {
  items: Item[];
  nextCursor: string | null;
}

const file = (body: unknown, cookie = member.cookie) =>
  t.request('POST', '/api/v1/catalog-requests', body, { cookie });
const decide = (id: string, body: unknown, cookie = admin.cookie) =>
  t.request('POST', `/api/v1/admin/catalog-requests/${id}/decision`, body, { cookie });

let counter = 0;
function unique(label: string): string {
  counter += 1;
  return `${label} ${String(counter)}`;
}

async function makeTag(name = unique('Tag')) {
  const [row] = await t.db.insert(tag).values({ name }).returning();
  if (!row) throw new Error('no tag');
  return row;
}

async function makeSeries(title = unique('Existing')) {
  const [row] = await t.db.insert(series).values({ title }).returning();
  if (!row) throw new Error('no series');
  return row;
}

function newSeries(values: Record<string, unknown> = {}) {
  return {
    kind: 'new_series',
    series: { title: unique('Requested series') },
    seasons: [{ ordinal: 1, title: 'First' }],
    ...values,
  };
}

async function filed(body: unknown = newSeries()) {
  const response = await file(body);
  expect(response.status).toBe(201);
  return response.body as RequestBody;
}

describe('authorization', () => {
  it('filing and listing need a session', async () => {
    expectError(await t.request('POST', '/api/v1/catalog-requests', newSeries()), 401, 'unauthenticated');
    expectError(await t.request('GET', '/api/v1/catalog-requests'), 401, 'unauthenticated');
  });

  it('the admin routes refuse the anonymous and members', async () => {
    const { id } = await filed();
    const body = { decision: 'approve' };
    expectError(await t.request('GET', '/api/v1/admin/catalog-requests'), 401, 'unauthenticated');
    expectError(await t.request('POST', `/api/v1/admin/catalog-requests/${id}/decision`, body), 401, 'unauthenticated');
    expectError(
      await t.request('GET', '/api/v1/admin/catalog-requests', undefined, { cookie: member.cookie }),
      403,
      'admin_required',
    );
    expectError(await decide(id, body, member.cookie), 403, 'admin_required');
    const [row] = await t.db.select().from(catalogRequest).where(eq(catalogRequest.id, id));
    expect(row?.status).toBe('pending');
  });
});

describe('filing a request', () => {
  it('creates no catalog rows until approved', async () => {
    const title = unique('Not yet real');
    await filed(newSeries({ series: { title } }));
    expect(await t.db.select().from(series).where(eq(series.title, title))).toEqual([]);
  });

  it('keeps the full proposed entry: episode count, season tags and suggested tags', async () => {
    const seriesTagRow = await makeTag();
    const seasonTagRow = await makeTag();
    const title = unique('Full entry');
    const body = await filed({
      kind: 'new_series',
      series: { title, altTitles: ['Alt'], synopsis: 'Words', tagIds: [seriesTagRow.id] },
      seasons: [
        {
          ordinal: 1,
          title: 'One',
          altTitles: ['Uno'],
          year: 2001,
          seasonOfYear: 'winter',
          episodeCount: 12,
          synopsis: 'More words',
          tagIds: [seasonTagRow.id],
        },
      ],
      suggestedTags: ['Time Loops', 'time loops', ' Cozy '],
    });
    expect(body).toMatchObject({ kind: 'new_series', seriesId: null, status: 'pending', decisionNote: null });
    expect(body.proposal).toMatchObject({
      series: { title, altTitles: ['Alt'], tagIds: [seriesTagRow.id] },
      seasons: [{ episodeCount: 12, seasonOfYear: 'winter', tagIds: [seasonTagRow.id] }],
      suggestedTags: ['Time Loops', 'Cozy'],
    });
    expect(body).not.toHaveProperty('requesterId');
    expect(JSON.stringify(body.proposal)).not.toContain(member.id);
  });

  it('accepts an add-season request and shows the series title', async () => {
    const target = await makeSeries();
    const body = await filed({
      kind: 'add_season',
      seriesId: target.id,
      season: { ordinal: 2, title: 'Second', episodeCount: 24 },
    });
    expect(body).toMatchObject({ kind: 'add_season', seriesId: target.id, seriesTitle: target.title });
  });

  it.each([
    ['no kind', { series: { title: 'x' }, seasons: [{ ordinal: 1, title: 'x' }] }],
    ['an unknown kind', { kind: 'new_tag' }],
    ['a repeated ordinal in a new series', {
      kind: 'new_series',
      series: { title: 'x' },
      seasons: [{ ordinal: 1, title: 'a' }, { ordinal: 1, title: 'b' }],
    }],
    ['no series on an add-season', { kind: 'add_season', season: { ordinal: 1, title: 'x' } }],
    ['a season with no title', { kind: 'new_series', series: { title: 'x' }, seasons: [{ ordinal: 1 }] }],
    ['a season with no ordinal', { kind: 'new_series', series: { title: 'x' }, seasons: [{ title: 'x' }] }],
    ['a blank suggested tag', {
      kind: 'new_series',
      series: { title: 'x' },
      seasons: [{ ordinal: 1, title: 'x' }],
      suggestedTags: ['  '],
    }],
  ])('refuses %s', async (_label, body) => {
    expectError(await file(body), 400, 'validation_error');
  });

  it('refuses a tag outside the vocabulary, on the series and on a season', async () => {
    expectError(await file(newSeries({ series: { title: 'x', tagIds: [NO_ID] } })), 400, 'unknown_tag');
    expectError(
      await file(newSeries({ seasons: [{ ordinal: 1, title: 'x', tagIds: [NO_ID] }] })),
      400,
      'unknown_tag',
    );
  });

  it('accepts a new series with no seasons, and approving creates just the series', async () => {
    const title = unique('Seasonless');
    const { id } = await filed({ kind: 'new_series', series: { title } });
    const response = await decide(id, { decision: 'approve' });
    expect(response.body).toMatchObject({ status: 'approved', seriesTitle: title });
    const seriesId = (response.body as RequestBody).seriesId ?? '';
    expect(await t.db.select().from(season).where(eq(season.seriesId, seriesId))).toEqual([]);
  });

  it('keeps no cover from a member, on the series or a season', async () => {
    const body = await filed({
      kind: 'new_series',
      series: { title: unique('Coverless'), coverImageId: NO_ID },
      seasons: [{ ordinal: 1, title: 'One', coverImageId: NO_ID }],
    });
    expect(JSON.stringify(body.proposal)).not.toContain('coverImageId');
    const target = await makeSeries();
    const added = await filed({
      kind: 'add_season',
      seriesId: target.id,
      season: { ordinal: 1, title: 'One', coverImageId: NO_ID },
    });
    expect(JSON.stringify(added.proposal)).not.toContain('coverImageId');
  });

  it('keeps no cover from an admin edit either: images come after approval', async () => {
    const title = unique('Edited coverless');
    const { id } = await filed(newSeries());
    const response = await decide(id, {
      decision: 'approve',
      proposal: {
        kind: 'new_series',
        series: { title, coverImageId: NO_ID },
        seasons: [{ ordinal: 1, title: 'One', coverImageId: NO_ID }],
      },
    });
    expect(response.status).toBe(200);
    expect(JSON.stringify((response.body as RequestBody).proposal)).not.toContain('coverImageId');
    const [created] = await t.db.select().from(series).where(eq(series.title, title));
    const rows = await t.db.select().from(season).where(eq(season.seriesId, created?.id ?? ''));
    expect(rows.map((row) => row.coverImageId)).toEqual([null]);
  });

  it('refuses a year out of range', async () => {
    expectError(await file(newSeries({ seasons: [{ ordinal: 1, title: 'x', year: 3000 }] })), 400, 'validation_error');
  });

  it('refuses an add-season for a missing series or a taken ordinal', async () => {
    const season_ = { ordinal: 1, title: 'x' };
    expectError(await file({ kind: 'add_season', seriesId: NO_ID, season: season_ }), 404, 'series_not_found');
    const target = await makeSeries();
    await t.db.insert(season).values({ seriesId: target.id, ordinal: 1, title: 'Taken' });
    expectError(await file({ kind: 'add_season', seriesId: target.id, season: season_ }), 409, 'ordinal_taken');
  });
});

describe('listing requests', () => {
  it("shows a member only their own, newest first, across pages", async () => {
    const someone = await t.seedLoggedIn();
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const response = await file(newSeries(), someone.cookie);
      ids.push((response.body as RequestBody).id);
    }
    await file(newSeries(), otherMember.cookie);

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const path: string = `/api/v1/catalog-requests?mine=true&limit=2${cursor === null ? '' : `&cursor=${cursor}`}`;
      const response = await t.request('GET', path, undefined, { cookie: someone.cookie });
      expect(response.status).toBe(200);
      const page = response.body as Page<RequestBody>;
      seen.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
    } while (cursor !== null);
    expect(seen).toEqual([...ids].reverse());
  });

  it('refuses a mine value other than true', async () => {
    expectError(
      await t.request('GET', '/api/v1/catalog-requests?mine=false', undefined, { cookie: member.cookie }),
      400,
      'validation_error',
    );
  });

  it('shows an admin everything, with the requester, filtered by status', async () => {
    const { id } = await filed();
    const pending = await t.request('GET', '/api/v1/admin/catalog-requests?status=pending&limit=100', undefined, {
      cookie: admin.cookie,
    });
    const row = (pending.body as Page<RequestBody>).items.find((item) => item.id === id);
    expect(row).toMatchObject({ requesterId: member.id, requesterUsername: member.enteredUsername, reviewedBy: null });

    await decide(id, { decision: 'reject', decisionNote: 'No' });
    const stillPending = await t.request('GET', '/api/v1/admin/catalog-requests?status=pending&limit=100', undefined, {
      cookie: admin.cookie,
    });
    expect((stillPending.body as Page<RequestBody>).items.map((item) => item.id)).not.toContain(id);
    const rejected = await t.request('GET', '/api/v1/admin/catalog-requests?status=rejected&limit=100', undefined, {
      cookie: admin.cookie,
    });
    expect((rejected.body as Page<RequestBody>).items.map((item) => item.id)).toContain(id);
  });

  it('blanks a removed requester, and deletes what they still had pending', async () => {
    const leaving = await t.seedLoggedIn();
    const decidedRequest = (await file(newSeries(), leaving.cookie)).body as RequestBody;
    const pendingRequest = (await file(newSeries(), leaving.cookie)).body as RequestBody;
    await decide(decidedRequest.id, { decision: 'approve' });
    await removeUser(t.db, leaving.id);

    const list = await t.request('GET', '/api/v1/admin/catalog-requests?limit=100', undefined, { cookie: admin.cookie });
    const items = (list.body as Page<RequestBody>).items;
    expect(items.find((item) => item.id === decidedRequest.id)).toMatchObject({
      requesterId: null,
      requesterUsername: null,
    });
    expect(items.map((item) => item.id)).not.toContain(pendingRequest.id);
  });
});

describe('approving', () => {
  it('creates a new series, its seasons and all their tags in one go', async () => {
    const seriesTagRow = await makeTag();
    const seasonTagRow = await makeTag();
    const title = unique('Approved series');
    const { id } = await filed({
      kind: 'new_series',
      series: { title, altTitles: ['Alt approved'], tagIds: [seriesTagRow.id] },
      seasons: [
        { ordinal: 1, title: 'One', year: 2001, episodeCount: 12, tagIds: [seasonTagRow.id] },
        { ordinal: 2, title: 'Two' },
      ],
    });

    const response = await decide(id, { decision: 'approve' });
    expect(response.status).toBe(200);
    const body = response.body as RequestBody;
    expect(body).toMatchObject({ status: 'approved', reviewedBy: admin.id, seriesTitle: title });

    const detail = await t.request('GET', `/api/v1/series/${body.seriesId ?? ''}`, undefined, { cookie: member.cookie });
    expect(detail.body).toMatchObject({
      title,
      altTitles: ['Alt approved'],
      tags: [{ id: seriesTagRow.id }],
      seasons: [
        { ordinal: 1, episodeCount: 12, year: 2001, ownTags: [{ id: seasonTagRow.id }] },
        { ordinal: 2, episodeCount: null, year: null, ownTags: [] },
      ],
    });
  });

  it('adds a season to an existing series', async () => {
    const target = await makeSeries();
    const { id } = await filed({
      kind: 'add_season',
      seriesId: target.id,
      season: { ordinal: 2, title: 'Added', episodeCount: 5 },
    });
    const response = await decide(id, { decision: 'approve' });
    expect(response.body).toMatchObject({ status: 'approved', seriesId: target.id });
    const rows = await t.db.select().from(season).where(eq(season.seriesId, target.id));
    expect(rows).toMatchObject([{ ordinal: 2, title: 'Added', episodeCount: 5 }]);
  });

  it('applies the admin edit as one unit, and records what was approved', async () => {
    const suggested = await makeTag();
    const editedTitle = unique('Edited title');
    const { id } = await filed(newSeries({ suggestedTags: ['Keep me'] }));
    const proposal = {
      kind: 'new_series',
      series: { title: editedTitle, tagIds: [suggested.id] },
      seasons: [
        { ordinal: 5, title: 'Edited one', episodeCount: 7 },
        { ordinal: 6, title: 'Admin added' },
      ],
      suggestedTags: ['Keep me'],
    };
    const response = await decide(id, { decision: 'approve', proposal });
    expect(response.status).toBe(200);
    expect((response.body as RequestBody).proposal).toMatchObject({ series: { title: editedTitle } });
    const [created] = await t.db.select().from(series).where(eq(series.title, editedTitle));
    const rows = await t.db.select().from(season).where(eq(season.seriesId, created?.id ?? ''));
    expect(rows.map((row) => row.ordinal).sort()).toEqual([5, 6]);
  });

  it('refuses to repoint an add-season at another series', async () => {
    const filedFor = await makeSeries();
    const other = await makeSeries();
    const { id } = await filed({ kind: 'add_season', seriesId: filedFor.id, season: { ordinal: 1, title: 'Stays' } });
    const response = await decide(id, {
      decision: 'approve',
      proposal: { kind: 'add_season', seriesId: other.id, season: { ordinal: 1, title: 'Stays' } },
    });
    expectError(response, 400, 'proposal_series_mismatch');
    expect(await t.db.select().from(season).where(eq(season.seriesId, other.id))).toEqual([]);
    const [row] = await t.db.select().from(catalogRequest).where(eq(catalogRequest.id, id));
    expect(row?.status).toBe('pending');
    expect((await decide(id, { decision: 'reject' })).status).toBe(200);
  });

  it('can still edit an add-season for the same series', async () => {
    const target = await makeSeries();
    const { id } = await filed({ kind: 'add_season', seriesId: target.id, season: { ordinal: 1, title: 'Filed' } });
    const response = await decide(id, {
      decision: 'approve',
      proposal: { kind: 'add_season', seriesId: target.id, season: { ordinal: 3, title: 'Edited' } },
    });
    expect(response.status).toBe(200);
    expect((response.body as RequestBody).proposal).toMatchObject({ season: { ordinal: 3, title: 'Edited' } });
    expect(await t.db.select().from(season).where(eq(season.seriesId, target.id))).toMatchObject([
      { ordinal: 3, title: 'Edited' },
    ]);
  });

  it('refuses an edit of another kind', async () => {
    const target = await makeSeries();
    const { id } = await filed(newSeries());
    const response = await decide(id, {
      decision: 'approve',
      proposal: { kind: 'add_season', seriesId: target.id, season: { ordinal: 1, title: 'x' } },
    });
    expectError(response, 400, 'proposal_kind_mismatch');
    expect(await t.db.select().from(season).where(eq(season.seriesId, target.id))).toEqual([]);
  });

  it('creates nothing when any part fails: a taken ordinal found at approval', async () => {
    const target = await makeSeries();
    const { id } = await filed({ kind: 'add_season', seriesId: target.id, season: { ordinal: 1, title: 'Late' } });
    await t.db.insert(season).values({ seriesId: target.id, ordinal: 1, title: 'Got there first' });
    expectError(await decide(id, { decision: 'approve' }), 409, 'ordinal_taken');
    const [row] = await t.db.select().from(catalogRequest).where(eq(catalogRequest.id, id));
    expect(row?.status).toBe('pending');
    const rows = await t.db.select().from(season).where(eq(season.seriesId, target.id));
    expect(rows.map((entry) => entry.title)).toEqual(['Got there first']);
  });

  it('creates nothing when an edit names an unknown tag on a later season', async () => {
    const title = unique('Rolled back');
    const { id } = await filed(newSeries());
    const response = await decide(id, {
      decision: 'approve',
      proposal: {
        kind: 'new_series',
        series: { title },
        seasons: [
          { ordinal: 1, title: 'Fine' },
          { ordinal: 2, title: 'Bad', tagIds: [NO_ID] },
        ],
      },
    });
    expectError(response, 400, 'unknown_tag');
    expect(await t.db.select().from(series).where(eq(series.title, title))).toEqual([]);
  });

  it('refuses an edit repeating an ordinal', async () => {
    const { id } = await filed(newSeries());
    const seasons = [
      { ordinal: 1, title: 'a' },
      { ordinal: 1, title: 'b' },
    ];
    const response = await decide(id, {
      decision: 'approve',
      proposal: { kind: 'new_series', series: { title: 'x' }, seasons },
    });
    expectError(response, 400, 'validation_error');
  });

  it('rolls back rows already inserted when a later insert fails', async () => {
    const title = unique('Half created');
    const { id } = await filed({
      kind: 'new_series',
      series: { title },
      seasons: [
        { ordinal: 1, title: 'Fine' },
        { ordinal: 2, title: 'Explode' },
      ],
    });
    await t.db.execute(sql`
      CREATE FUNCTION test_refuse_season() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.title = 'Explode' THEN RAISE EXCEPTION 'refused by the test'; END IF;
        RETURN NEW;
      END;
      $$
    `);
    await t.db.execute(
      sql`CREATE TRIGGER test_refuse_season BEFORE INSERT ON season FOR EACH ROW EXECUTE FUNCTION test_refuse_season()`,
    );
    const originalError = console.error;
    console.error = () => undefined;
    try {
      expect((await decide(id, { decision: 'approve' })).status).toBe(500);
    } finally {
      console.error = originalError;
      await t.db.execute(sql`DROP TRIGGER test_refuse_season ON season`);
      await t.db.execute(sql`DROP FUNCTION test_refuse_season`);
    }
    expect(await t.db.select().from(series).where(eq(series.title, title))).toEqual([]);
    const [row] = await t.db.select().from(catalogRequest).where(eq(catalogRequest.id, id));
    expect(row?.status).toBe('pending');
  });

  it('applies once when approved twice at the same moment', async () => {
    const title = unique('Raced');
    const { id } = await filed(newSeries({ series: { title } }));
    const responses = await Promise.all([decide(id, { decision: 'approve' }), decide(id, { decision: 'approve' })]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(await t.db.select().from(series).where(eq(series.title, title))).toHaveLength(1);
  });

  it('refuses a request already decided, and a missing one', async () => {
    const { id } = await filed();
    await decide(id, { decision: 'approve' });
    expectError(await decide(id, { decision: 'approve' }), 409, 'catalog_request_not_pending');
    expectError(await decide(id, { decision: 'reject', decisionNote: 'Late' }), 409, 'catalog_request_not_pending');
    expectError(await decide(NO_ID, { decision: 'approve' }), 404, 'catalog_request_not_found');
  });
});

describe('rejecting', () => {
  it('records the note and creates nothing; the member sees the note', async () => {
    const title = unique('Rejected series');
    const { id } = await filed(newSeries({ series: { title } }));
    const response = await decide(id, { decision: 'reject', decisionNote: '  Already in the catalog.  ' });
    expect(response.body).toMatchObject({
      status: 'rejected',
      decisionNote: 'Already in the catalog.',
      reviewedBy: admin.id,
    });
    expect(await t.db.select().from(series).where(eq(series.title, title))).toEqual([]);

    const mine = await t.request('GET', '/api/v1/catalog-requests?limit=100', undefined, { cookie: member.cookie });
    const row = (mine.body as Page<RequestBody>).items.find((item) => item.id === id);
    expect(row).toMatchObject({ status: 'rejected', decisionNote: 'Already in the catalog.' });
    expect(row).not.toHaveProperty('reviewedBy');
  });

  it.each([
    ['a blank note', { decision: 'reject', decisionNote: '   ' }],
    ['an unknown decision', { decision: 'maybe' }],
  ])('refuses %s', async (_label, body) => {
    const { id } = await filed();
    expectError(await decide(id, body), 400, 'validation_error');
  });
});

describe('rejecting with no note', () => {
  it('needs no note', async () => {
    const { id } = await filed();
    const response = await decide(id, { decision: 'reject' });
    expect(response.body).toMatchObject({ status: 'rejected', decisionNote: null });
  });
});

describe('suggested tags at review', () => {
  const tagsNamed = (name: string) =>
    t.db.select().from(tag).where(sql`lower(${tag.name}) = lower(${name})`);

  it('are not created or attached unless accepted', async () => {
    const name = unique('Not accepted');
    const { id } = await filed(newSeries({ suggestedTags: [name] }));
    const response = await decide(id, { decision: 'approve' });
    expect(response.status).toBe(200);
    expect(await tagsNamed(name)).toEqual([]);
    expect((response.body as RequestBody).proposal).toMatchObject({ suggestedTags: [name] });
  });

  it('create the tag on acceptance and attach it to a new series', async () => {
    const name = unique('Brand New Tag');
    const other = unique('Declined Tag');
    const title = unique('Accepting series');
    const { id } = await filed(
      newSeries({
        series: { title },
        seasons: [{ ordinal: 1, title: 'One' }],
        suggestedTags: [name, other],
      }),
    );
    const response = await decide(id, { decision: 'approve', acceptSuggestedTags: [name.toUpperCase()] });
    expect(response.status).toBe(200);
    const [created] = await tagsNamed(name);
    expect(created?.name).toBe(name);
    expect(await tagsNamed(other)).toEqual([]);
    const detail = await t.request('GET', `/api/v1/series/${(response.body as RequestBody).seriesId ?? ''}`, undefined, {
      cookie: member.cookie,
    });
    expect(detail.body).toMatchObject({
      title,
      tags: [{ id: created?.id, name }],
      seasons: [{ ownTags: [] }],
    });
  });

  it('attach the existing tag matching ignoring case, keeping its spelling', async () => {
    const existing = await makeTag(unique('Existing Spelling'));
    const { id } = await filed(newSeries({ suggestedTags: [existing.name.toLowerCase()] }));
    const response = await decide(id, { decision: 'approve', acceptSuggestedTags: [existing.name.toLowerCase()] });
    const detail = await t.request('GET', `/api/v1/series/${(response.body as RequestBody).seriesId ?? ''}`, undefined, {
      cookie: member.cookie,
    });
    expect(detail.body).toMatchObject({ tags: [{ id: existing.id, name: existing.name }] });
    expect(await tagsNamed(existing.name)).toHaveLength(1);
  });

  it('attach to the added season, leaving the series and its other seasons alone', async () => {
    const name = unique('Season Suggestion');
    const target = await makeSeries();
    const earlier = await t.request(
      'POST',
      '/api/v1/seasons',
      { seriesId: target.id, ordinal: 1, title: 'Earlier' },
      { cookie: admin.cookie },
    );
    expect(earlier.status).toBe(201);
    const { id } = await filed({
      kind: 'add_season',
      seriesId: target.id,
      season: { ordinal: 2, title: 'x' },
      suggestedTags: [name],
    });
    await decide(id, { decision: 'approve', acceptSuggestedTags: [name] });
    const detail = await t.request('GET', `/api/v1/series/${target.id}`, undefined, { cookie: member.cookie });
    expect(detail.body).toMatchObject({
      tags: [],
      seasons: [
        { ordinal: 1, ownTags: [] },
        { ordinal: 2, ownTags: [{ name }] },
      ],
    });
  });

  it('go alongside tags chosen by hand in an edit, with no repeat', async () => {
    const chosen = await makeTag();
    const name = unique('Alongside');
    const { id } = await filed(newSeries({ suggestedTags: [name, chosen.name] }));
    const response = await decide(id, {
      decision: 'approve',
      acceptSuggestedTags: [name, chosen.name],
      proposal: {
        kind: 'new_series',
        series: { title: unique('Alongside series'), tagIds: [chosen.id] },
      },
    });
    expect(response.status).toBe(200);
    const proposal = (response.body as RequestBody).proposal as { series: { tagIds: string[] } };
    expect(proposal.series.tagIds).toHaveLength(2);
  });

  it('refuse a name the member did not suggest, creating nothing', async () => {
    const name = unique('Never suggested');
    const { id } = await filed(newSeries({ suggestedTags: ['Something else'] }));
    expectError(await decide(id, { decision: 'approve', acceptSuggestedTags: [name] }), 400, 'unknown_suggestion');
    expect(await tagsNamed(name)).toEqual([]);
    const [row] = await t.db.select().from(catalogRequest).where(eq(catalogRequest.id, id));
    expect(row?.status).toBe('pending');
  });

  it('create no tag if the approval fails', async () => {
    const name = unique('Rolled back tag');
    const target = await makeSeries();
    const { id } = await filed({
      kind: 'add_season',
      seriesId: target.id,
      season: { ordinal: 1, title: 'Late' },
      suggestedTags: [name],
    });
    await t.db.insert(season).values({ seriesId: target.id, ordinal: 1, title: 'First' });
    expectError(await decide(id, { decision: 'approve', acceptSuggestedTags: [name] }), 409, 'ordinal_taken');
    expect(await tagsNamed(name)).toEqual([]);
  });

  it('refuse an entry pushed past the tag limit by accepting', async () => {
    const chosen = await Promise.all(Array.from({ length: 50 }, () => makeTag()));
    const name = unique('One too many');
    const { id } = await filed(
      newSeries({ series: { title: 'x', tagIds: chosen.map((row) => row.id) }, suggestedTags: [name] }),
    );
    expectError(await decide(id, { decision: 'approve', acceptSuggestedTags: [name] }), 400, 'too_many_tags');
    expect(await tagsNamed(name)).toEqual([]);
  });

  it('cannot be accepted on a rejection', async () => {
    const name = unique('Rejected suggestion');
    const { id } = await filed(newSeries({ suggestedTags: [name] }));
    await decide(id, { decision: 'reject', acceptSuggestedTags: [name] });
    expect(await tagsNamed(name)).toEqual([]);
  });
});

describe('a series deleted with a request pending', () => {
  it('leaves the request rejected with a note, which can no longer be approved', async () => {
    const target = await makeSeries();
    const { id } = await filed({ kind: 'add_season', seriesId: target.id, season: { ordinal: 1, title: 'x' } });
    const response = await t.request('DELETE', `/api/v1/series/${target.id}`, undefined, { cookie: admin.cookie });
    expect(response.status).toBe(204);
    expectError(await decide(id, { decision: 'approve' }), 409, 'catalog_request_not_pending');
    const mine = await t.request('GET', '/api/v1/catalog-requests?limit=100', undefined, { cookie: member.cookie });
    const row = (mine.body as Page<RequestBody>).items.find((item) => item.id === id);
    expect(row).toMatchObject({ status: 'rejected', seriesId: null, seriesTitle: null });
    expect(row?.decisionNote).toContain(target.title);
  });
});

// Each test holds the catalog lock while making an uncommitted change, proving the request waits
// and then sees it. Without the lock it would pass its check against the old state.
describe('the catalog lock', () => {
  async function callWhileLocked(
    change: (tx: Parameters<Parameters<TestApp['db']['transaction']>[0]>[0]) => Promise<unknown>,
    call: () => Promise<TestResponse>,
  ): Promise<TestResponse> {
    let pending: Promise<TestResponse> | undefined;
    await t.db.transaction(async (tx) => {
      await lockCatalog(tx);
      await change(tx);
      pending = call();
      await new Promise((resolve) => setTimeout(resolve, 150));
    });
    if (!pending) throw new Error('the call did not start');
    return pending;
  }

  it('makes a request for a series wait for that series being deleted', async () => {
    const target = await makeSeries();
    const response = await callWhileLocked(
      (tx) => tx.delete(series).where(eq(series.id, target.id)),
      () => file({ kind: 'add_season', seriesId: target.id, season: { ordinal: 1, title: 'x' } }),
    );
    expectError(response, 404, 'series_not_found');
  });

  it('makes a request naming a tag wait for that tag being deleted', async () => {
    const doomed = await makeTag();
    const response = await callWhileLocked(
      (tx) => tx.delete(tag).where(eq(tag.id, doomed.id)),
      () => file(newSeries({ series: { title: 'x', tagIds: [doomed.id] } })),
    );
    expectError(response, 400, 'unknown_tag');
  });

  it('makes an approval wait for a taken ordinal, and refuses it', async () => {
    const target = await makeSeries();
    const { id } = await filed({ kind: 'add_season', seriesId: target.id, season: { ordinal: 1, title: 'x' } });
    const response = await callWhileLocked(
      (tx) => tx.insert(season).values({ seriesId: target.id, ordinal: 1, title: 'First' }),
      () => decide(id, { decision: 'approve' }),
    );
    expectError(response, 409, 'ordinal_taken');
  });
});
