import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seriesMatchingSearch } from '../catalog/search.ts';
import { catalogRequest, listEntry, seasonTag, series, seriesTag, tag } from '../db/schema.ts';
import { type TestApp, createTestApp, expectError } from '../test-support/test-app.ts';

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

interface TagBody {
  id: string;
  name: string;
}
interface SeasonBody {
  id: string;
  seriesId: string;
  ordinal: number;
  year: number | null;
  seasonOfYear: string | null;
  ownTags: TagBody[];
  effectiveTags: TagBody[];
  series?: { id: string; title: string };
}
interface SeriesBody {
  id: string;
  title: string;
  tags: TagBody[];
  seasonCount: number;
  firstYear: number | null;
  firstSeasonOfYear: string | null;
  seasons: SeasonBody[];
}
interface Page<Item> {
  items: Item[];
  nextCursor: string | null;
}

const NO_ID = '00000000-0000-4000-8000-000000000000';

const asAdmin = (method: string, path: string, body?: unknown) =>
  t.request(method, `/api/v1${path}`, body, { cookie: admin.cookie });
const asMember = (method: string, path: string, body?: unknown) =>
  t.request(method, `/api/v1${path}`, body, { cookie: member.cookie });

let counter = 0;
/** A title no other test has used, so searches and filters see only their own rows. */
function uniqueTitle(label: string): string {
  counter += 1;
  return `${label} ${String(counter)}`;
}

async function createTag(name = uniqueTitle('Tag')) {
  const response = await asAdmin('POST', '/tags', { name });
  expect(response.status).toBe(201);
  return response.body as TagBody;
}

async function createSeries(values: Record<string, unknown> = {}) {
  const response = await asAdmin('POST', '/series', { title: uniqueTitle('Series'), ...values });
  expect(response.status).toBe(201);
  return response.body as SeriesBody;
}

async function createSeason(seriesId: string, values: Record<string, unknown> = {}) {
  const response = await asAdmin('POST', '/seasons', {
    seriesId,
    ordinal: 1,
    title: uniqueTitle('Season'),
    ...values,
  });
  expect(response.status).toBe(201);
  return response.body as SeasonBody;
}

async function listSeries(query: string) {
  const response = await asMember('GET', `/series?${query}`);
  expect(response.status).toBe(200);
  return response.body as Page<SeriesBody>;
}

async function titlesFor(query: string) {
  return (await listSeries(query)).items.map((item) => item.title);
}

describe('authorization', () => {
  const reads: [string, string][] = [
    ['GET', '/series'],
    ['GET', `/series/${NO_ID}`],
    ['GET', `/seasons/${NO_ID}`],
    ['GET', '/tags'],
  ];
  const writes: [string, string, unknown][] = [
    ['POST', '/series', { title: 'x' }],
    ['PATCH', `/series/${NO_ID}`, { title: 'x' }],
    ['DELETE', `/series/${NO_ID}`, undefined],
    ['POST', '/seasons', { seriesId: NO_ID, ordinal: 1, title: 'x' }],
    ['PATCH', `/seasons/${NO_ID}`, { title: 'x' }],
    ['DELETE', `/seasons/${NO_ID}`, undefined],
    ['POST', '/tags', { name: 'x' }],
    ['PATCH', `/tags/${NO_ID}`, { name: 'x' }],
    ['DELETE', `/tags/${NO_ID}`, undefined],
  ];

  it.each(reads)('%s %s needs a session', async (method, path) => {
    const response = await t.request(method, `/api/v1${path}`);
    expectError(response, 401, 'unauthenticated');
    expect(response.headers.get('cache-control')).toBeNull();
  });

  it.each(writes)('%s %s needs a session', async (method, path, body) => {
    expectError(await t.request(method, `/api/v1${path}`, body), 401, 'unauthenticated');
  });

  it.each(writes)('%s %s refuses a member', async (method, path, body) => {
    expectError(await asMember(method, path, body), 403, 'admin_required');
  });

  it('leaves the catalog untouched after every refused member write', async () => {
    const before = await t.db.select().from(series);
    await asMember('POST', '/series', { title: 'Member made this' });
    expect(await t.db.select().from(series)).toEqual(before);
  });
});

describe('series', () => {
  it('creates with only a title and leaves the rest blank', async () => {
    const response = await asAdmin('POST', '/series', { title: '  Mushishi  ' });
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      title: 'Mushishi',
      altTitles: [],
      synopsis: null,
      coverImageId: null,
      tags: [],
      seasonCount: 0,
      firstYear: null,
      firstSeasonOfYear: null,
      seasons: [],
    });
    expect(response.body).not.toHaveProperty('source');
  });

  it.each([
    ['no title', {}],
    ['a blank title', { title: '   ' }],
  ])('refuses %s', async (_label, body) => {
    expectError(await asAdmin('POST', '/series', body), 400, 'validation_error');
  });

  it('refuses a tag outside the vocabulary and a cover that does not exist', async () => {
    expectError(await asAdmin('POST', '/series', { title: 'x', tagIds: [NO_ID] }), 400, 'unknown_tag');
    expectError(
      await asAdmin('POST', '/series', { title: 'x', coverImageId: NO_ID }),
      400,
      'unknown_image',
    );
  });

  it('edits only what is sent; null clears and tags are replaced', async () => {
    const first = await createTag();
    const second = await createTag();
    const created = await createSeries({ synopsis: 'Words', altTitles: ['Alt'], tagIds: [first.id] });
    const response = await asAdmin('PATCH', `/series/${created.id}`, { tagIds: [second.id] });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      title: created.title,
      synopsis: 'Words',
      altTitles: ['Alt'],
      tags: [second],
    });
    const cleared = await asAdmin('PATCH', `/series/${created.id}`, { synopsis: null });
    expect(cleared.body).toMatchObject({ synopsis: null, altTitles: ['Alt'], tags: [second] });
  });

  it('refuses an empty edit and a null title', async () => {
    const created = await createSeries();
    expectError(await asAdmin('PATCH', `/series/${created.id}`, {}), 400, 'validation_error');
    expectError(await asAdmin('PATCH', `/series/${created.id}`, { title: null }), 400, 'validation_error');
  });

  it('answers 404 for a missing series on read, edit and delete', async () => {
    expectError(await asMember('GET', `/series/${NO_ID}`), 404, 'series_not_found');
    expectError(await asAdmin('PATCH', `/series/${NO_ID}`, { title: 'x' }), 404, 'series_not_found');
    expectError(await asAdmin('DELETE', `/series/${NO_ID}`), 404, 'series_not_found');
  });

  it('refuses a malformed id', async () => {
    expectError(await asMember('GET', '/series/not-a-uuid'), 400, 'validation_error');
  });

  it('lists seasons in ordinal order whatever order they were added', async () => {
    const created = await createSeries();
    await createSeason(created.id, { ordinal: 3 });
    await createSeason(created.id, { ordinal: 1 });
    await createSeason(created.id, { ordinal: 2 });
    const detail = (await asMember('GET', `/series/${created.id}`)).body as SeriesBody;
    expect(detail.seasons.map((entry) => entry.ordinal)).toEqual([1, 2, 3]);
    expect(detail.seasonCount).toBe(3);
  });
});

describe('deleting a series', () => {
  it('refuses while it has seasons and changes nothing', async () => {
    const created = await createSeries();
    await createSeason(created.id);
    const [request] = await t.db
      .insert(catalogRequest)
      .values({
        requesterId: member.id,
        kind: 'add_season',
        seriesId: created.id,
        payload: {
          kind: 'add_season',
          seriesId: created.id,
          season: { ordinal: 2, title: 'Second' },
        },
      })
      .returning();
    expectError(await asAdmin('DELETE', `/series/${created.id}`), 409, 'series_has_seasons');
    expect((await asMember('GET', `/series/${created.id}`)).status).toBe(200);
    const [after] = await t.db
      .select()
      .from(catalogRequest)
      .where(eq(catalogRequest.id, request?.id ?? ''));
    expect(after?.status).toBe('pending');
  });

  it('rejects its pending add-season requests, and leaves decided ones alone', async () => {
    const created = await createSeries();
    const payload = { kind: 'add_season', seriesId: created.id, season: { ordinal: 1, title: 'One' } };
    const rows = await t.db
      .insert(catalogRequest)
      .values([
        { requesterId: member.id, kind: 'add_season' as const, seriesId: created.id, payload },
        {
          requesterId: member.id,
          kind: 'add_season' as const,
          seriesId: created.id,
          payload,
          status: 'rejected' as const,
          decisionNote: 'Earlier note',
        },
      ])
      .returning();

    const response = await asAdmin('DELETE', `/series/${created.id}`);
    expect(response.status).toBe(204);
    expectError(await asMember('GET', `/series/${created.id}`), 404, 'series_not_found');

    const [pending] = await t.db
      .select()
      .from(catalogRequest)
      .where(eq(catalogRequest.id, rows[0]?.id ?? ''));
    expect(pending).toMatchObject({ status: 'rejected', reviewedBy: admin.id, seriesId: null });
    expect(pending?.decisionNote).toContain(created.title);
    const [decided] = await t.db
      .select()
      .from(catalogRequest)
      .where(eq(catalogRequest.id, rows[1]?.id ?? ''));
    expect(decided?.decisionNote).toBe('Earlier note');
  });
});

describe('seasons', () => {
  it('creates with only an ordinal and a title, leaving date and episodes blank', async () => {
    const created = await createSeries();
    const body = await createSeason(created.id, { ordinal: 0 });
    expect(body).toMatchObject({
      seriesId: created.id,
      ordinal: 0,
      year: null,
      seasonOfYear: null,
      episodeCount: null,
      synopsis: null,
      series: { id: created.id, title: created.title },
    });
  });

  it('carries episode count and date through create, edit and read', async () => {
    const created = await createSeries();
    const body = await createSeason(created.id, { year: 2005, seasonOfYear: 'fall', episodeCount: 26 });
    expect(body).toMatchObject({ year: 2005, seasonOfYear: 'fall', episodeCount: 26 });
    const edited = await asAdmin('PATCH', `/seasons/${body.id}`, { episodeCount: null, year: null });
    expect(edited.body).toMatchObject({ year: null, seasonOfYear: 'fall', episodeCount: null });
    expect((await asMember('GET', `/seasons/${body.id}`)).body).toMatchObject({ episodeCount: null });
  });

  it.each([
    ['no ordinal', { ordinal: undefined }],
    ['a fractional ordinal', { ordinal: 1.5 }],
    ['a negative episode count', { episodeCount: -1 }],
    ['an unknown season of year', { seasonOfYear: 'monsoon' }],
    ['a year out of range', { year: 12 }],
  ])('refuses %s', async (_label, values) => {
    const created = await createSeries();
    expectError(
      await asAdmin('POST', '/seasons', { seriesId: created.id, ordinal: 1, title: 'x', ...values }),
      400,
      'validation_error',
    );
  });

  it('refuses a missing series', async () => {
    expectError(
      await asAdmin('POST', '/seasons', { seriesId: NO_ID, ordinal: 1, title: 'x' }),
      404,
      'series_not_found',
    );
  });

  it('refuses a taken ordinal on create and edit, within one series only', async () => {
    const created = await createSeries();
    const first = await createSeason(created.id, { ordinal: 1 });
    const second = await createSeason(created.id, { ordinal: 2 });
    expectError(
      await asAdmin('POST', '/seasons', { seriesId: created.id, ordinal: 1, title: 'x' }),
      409,
      'ordinal_taken',
    );
    expectError(await asAdmin('PATCH', `/seasons/${second.id}`, { ordinal: 1 }), 409, 'ordinal_taken');
    const edited = await asAdmin('PATCH', `/seasons/${first.id}`, { ordinal: 1, title: 'Same ordinal' });
    expect(edited.status).toBe(200);
    const other = await createSeries();
    await createSeason(other.id, { ordinal: 1 });
  });

  it('answers 404 for a missing season on read, edit and delete', async () => {
    expectError(await asMember('GET', `/seasons/${NO_ID}`), 404, 'season_not_found');
    expectError(await asAdmin('PATCH', `/seasons/${NO_ID}`, { title: 'x' }), 404, 'season_not_found');
    expectError(await asAdmin('DELETE', `/seasons/${NO_ID}`), 404, 'season_not_found');
  });

  it('deletes a season on no list, and refuses one on anyone\'s list', async () => {
    const created = await createSeries();
    const free = await createSeason(created.id, { ordinal: 1 });
    const listed = await createSeason(created.id, { ordinal: 2 });
    await t.db.insert(listEntry).values({ userId: member.id, seasonId: listed.id, status: 'watching' });

    expect((await asAdmin('DELETE', `/seasons/${free.id}`)).status).toBe(204);
    expectError(await asMember('GET', `/seasons/${free.id}`), 404, 'season_not_found');

    expectError(await asAdmin('DELETE', `/seasons/${listed.id}`), 409, 'season_on_list');
    expect((await asMember('GET', `/seasons/${listed.id}`)).status).toBe(200);
  });
});

describe('effective tags', () => {
  it('are the union of series and season tags, with the own tags shown apart', async () => {
    const shared = await createTag('Shared effective');
    const seriesOnly = await createTag('A series tag');
    const seasonOnly = await createTag('Z season tag');
    const created = await createSeries({ tagIds: [seriesOnly.id, shared.id] });
    const entry = await createSeason(created.id, { tagIds: [seasonOnly.id, shared.id, shared.id] });

    expect(entry.ownTags.map((row) => row.name)).toEqual(['Shared effective', 'Z season tag']);
    expect(entry.effectiveTags.map((row) => row.name)).toEqual([
      'A series tag',
      'Shared effective',
      'Z season tag',
    ]);
    const viaSeries = (await asMember('GET', `/series/${created.id}`)).body as SeriesBody;
    expect(viaSeries.tags.map((row) => row.name)).toEqual(['A series tag', 'Shared effective']);
    expect(viaSeries.seasons[0]?.effectiveTags).toEqual(entry.effectiveTags);
  });

  it('follow a change to the series tags', async () => {
    const added = await createTag();
    const created = await createSeries();
    const entry = await createSeason(created.id);
    expect(entry.effectiveTags).toEqual([]);
    await asAdmin('PATCH', `/series/${created.id}`, { tagIds: [added.id] });
    expect((await asMember('GET', `/seasons/${entry.id}`)).body).toMatchObject({
      ownTags: [],
      effectiveTags: [added],
    });
  });
});

describe('the tag filter', () => {
  it('matches a tag on the series or on any of its seasons, once each', async () => {
    const wanted = await createTag();
    const viaSeries = await createSeries({ tagIds: [wanted.id] });
    const viaSeason = await createSeries();
    await createSeason(viaSeason.id, { tagIds: [wanted.id] });
    const viaBoth = await createSeries({ tagIds: [wanted.id] });
    await createSeason(viaBoth.id, { ordinal: 1, tagIds: [wanted.id] });
    await createSeason(viaBoth.id, { ordinal: 2, tagIds: [wanted.id] });
    await createSeries();

    const titles = await titlesFor(`tag=${wanted.id}`);
    expect(titles.sort()).toEqual([viaSeries.title, viaSeason.title, viaBoth.title].sort());
  });

  it('finds nothing for an unknown tag and refuses a malformed one', async () => {
    expect(await titlesFor(`tag=${NO_ID}`)).toEqual([]);
    expectError(await asMember('GET', '/series?tag=nope'), 400, 'validation_error');
  });

  it('combines with search', async () => {
    const wanted = await createTag();
    const both = await createSeries({ title: 'Quokka combined one', tagIds: [wanted.id] });
    await createSeries({ title: 'Quokka combined two' });
    await createSeries({ title: 'Unrelated', tagIds: [wanted.id] });
    expect(await titlesFor(`q=quokka+combined&tag=${wanted.id}`)).toEqual([both.title]);
  });
});

describe('search', () => {
  let attack: SeriesBody;
  let viaSeasonAlt: SeriesBody;

  beforeAll(async () => {
    attack = await createSeries({
      title: 'Shingeki no Kyojin',
      altTitles: ['Attack on Titan', '進撃の巨人'],
    });
    await createSeason(attack.id, { title: 'First Stage' });
    viaSeasonAlt = await createSeries({ title: 'Plain Parent Title' });
    await createSeason(viaSeasonAlt.id, {
      title: 'Ordinary Season Name',
      altTitles: ['Xylophone Chronicles'],
    });
  });

  it.each([
    ['a series title', 'Shingeki'],
    ['a series alternate title, ignoring case', 'attack ON titan'],
    ['part of a word', 'ngeki no'],
    ['a misspelling', 'Atack on Titan'],
    ['words in another order', 'titan attack'],
    ['a Japanese alternate title', '進撃'],
    ['a season title', 'First Stage'],
  ])('finds a series by %s', async (_label, q) => {
    expect(await titlesFor(`q=${encodeURIComponent(q)}`)).toContain(attack.title);
  });

  it('finds a series through an alternate title of its season', async () => {
    expect(await titlesFor('q=Xylophone')).toEqual([viaSeasonAlt.title]);
  });

  it('finds nothing for an unrelated query', async () => {
    expect(await titlesFor('q=zzzzqqqqvvvv')).toEqual([]);
  });

  it('treats LIKE wildcards literally', async () => {
    const percent = await createSeries({ title: 'Wild 100% Card' });
    expect(await titlesFor('q=100%25')).toEqual([percent.title]);
    expect(await titlesFor('q=W_ld')).toEqual([]);
    expect(await titlesFor('q=%25%25%25%25')).toEqual([]);
  });

  it('treats a blank query as no search', async () => {
    const all = await listSeries('limit=100');
    expect((await listSeries('limit=100&q=%20%20')).items.length).toBe(all.items.length);
  });

  it('puts the closest match first', async () => {
    const loose = await createSeries({ title: 'Marmoset Cafe Stories of the Long Afternoon' });
    const close = await createSeries({ title: 'Marmoset Cafe' });
    expect(await titlesFor('q=marmoset+cafe')).toEqual([close.title, loose.title]);
  });

  it('refuses a query over the limit', async () => {
    expectError(await asMember('GET', `/series?q=${'a'.repeat(201)}`), 400, 'validation_error');
  });

  it('uses the trigram and full-text indexes of both tables', async () => {
    const plan = await t.db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL enable_seqscan = off`);
      const result = await tx.execute(
        sql`EXPLAIN SELECT ${series.id} FROM ${series} WHERE ${seriesMatchingSearch('attack')}`,
      );
      return result.rows.map((row) => String(row['QUERY PLAN'])).join('\n');
    });
    for (const index of [
      'series_title_trgm_idx',
      'series_title_fts_idx',
      'season_title_trgm_idx',
      'season_title_fts_idx',
    ]) {
      expect(plan).toContain(index);
    }
  });
});

describe('sorting and blank dates', () => {
  // A tag fences off this test's rows from the rest of the file.
  it('orders newest first with blanks last, with no skips or repeats across pages', async () => {
    const fence = await createTag();
    const make = async (title: string, ...seasons: Record<string, unknown>[]) => {
      const created = await createSeries({ title, tagIds: [fence.id] });
      for (const [index, values] of seasons.entries()) {
        await createSeason(created.id, { ordinal: index + 1, ...values });
      }
    };
    await make('Blank B no seasons');
    await make('blank A', { year: null, seasonOfYear: 'spring' });
    await make('Year only 2020', { year: 2020 });
    await make('Fall 2020', { year: 2020, seasonOfYear: 'fall' });
    await make('Winter 2020', { year: 2020, seasonOfYear: 'winter' });
    await make('Same date M', { year: 2021, seasonOfYear: 'spring' });
    await make('same date a', { year: 2021, seasonOfYear: 'spring' });
    // Dated by its earliest dated season; the blank and the later one do not count.
    await make('Earliest 2010', { year: null }, { year: 2022 }, { year: 2010, seasonOfYear: 'summer' });

    const expected = [
      'same date a',
      'Same date M',
      'Fall 2020',
      'Winter 2020',
      'Year only 2020',
      'Earliest 2010',
      'blank A',
      'Blank B no seasons',
    ];
    const everything = await listSeries(`tag=${fence.id}`);
    expect(everything.items.map((item) => item.title)).toEqual(expected);
    expect(everything.nextCursor).toBeNull();

    const paged: string[] = [];
    let cursor: string | null = null;
    do {
      const query: string = `tag=${fence.id}&limit=3${cursor === null ? '' : `&cursor=${cursor}`}`;
      const page: Page<SeriesBody> = await listSeries(query);
      expect(page.items.length).toBeLessThanOrEqual(3);
      paged.push(...page.items.map((item) => item.title));
      cursor = page.nextCursor;
    } while (cursor !== null);
    expect(paged).toEqual(expected);

    const earliest = everything.items.find((item) => item.title === 'Earliest 2010');
    expect(earliest).toMatchObject({ firstYear: 2010, firstSeasonOfYear: 'summer', seasonCount: 3 });
    const blank = everything.items.find((item) => item.title === 'blank A');
    expect(blank).toMatchObject({ firstYear: null, firstSeasonOfYear: null });
  });

  it('pages through search results without skips or repeats', async () => {
    const titles = await Promise.all(
      [1, 2, 3, 4, 5].map(async (n) => {
        const created = await createSeries({ title: `Capybara paging ${String(n)}` });
        return created.title;
      }),
    );
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const query: string = `q=capybara+paging&limit=2${cursor === null ? '' : `&cursor=${cursor}`}`;
      const page: Page<SeriesBody> = await listSeries(query);
      seen.push(...page.items.map((item) => item.title));
      cursor = page.nextCursor;
    } while (cursor !== null);
    expect(seen.sort()).toEqual(titles.sort());
  });

  it('refuses a cursor it did not issue', async () => {
    expectError(await asMember('GET', '/series?cursor=nope'), 400, 'invalid_cursor');
  });
});

describe('tags', () => {
  it('keeps the entered capitalization and ignores case for uniqueness', async () => {
    const created = await createTag('Slice Of Life Unique');
    expect(created.name).toBe('Slice Of Life Unique');
    expectError(await asAdmin('POST', '/tags', { name: 'slice of life unique' }), 409, 'tag_name_taken');
    expectError(await asAdmin('POST', '/tags', { name: '  SLICE OF LIFE UNIQUE ' }), 409, 'tag_name_taken');
  });

  it('renames, refusing a name another tag has, but allowing a change of capitalization', async () => {
    const taken = await createTag('Taken Rename Name');
    const created = await createTag('Before Rename');
    expectError(await asAdmin('PATCH', `/tags/${created.id}`, { name: 'taken rename name' }), 409, 'tag_name_taken');
    const recased = await asAdmin('PATCH', `/tags/${created.id}`, { name: 'BEFORE rename' });
    expect(recased.body).toEqual({ id: created.id, name: 'BEFORE rename' });
    expect(taken.name).toBe('Taken Rename Name');
    expectError(await asAdmin('PATCH', `/tags/${NO_ID}`, { name: 'Nobody' }), 404, 'tag_not_found');
  });

  it('refuses a blank name', async () => {
    expectError(await asAdmin('POST', '/tags', { name: '  ' }), 400, 'validation_error');
  });

  it('lists the vocabulary in name order, ignoring case, across pages', async () => {
    await createTag('aardvark listing');
    await createTag('Aardwolf listing');
    await createTag('abacus listing');
    const names: string[] = [];
    let cursor: string | null = null;
    do {
      const path: string = `/tags?limit=2${cursor === null ? '' : `&cursor=${cursor}`}`;
      const response = await asMember('GET', path);
      expect(response.status).toBe(200);
      const page = response.body as Page<TagBody>;
      names.push(...page.items.map((item) => item.name));
      cursor = page.nextCursor;
    } while (cursor !== null);
    expect(names.indexOf('aardvark listing')).toBeLessThan(names.indexOf('Aardwolf listing'));
    expect(names.indexOf('Aardwolf listing')).toBeLessThan(names.indexOf('abacus listing'));
    expect(new Set(names).size).toBe(names.length);
  });

  it('deleting detaches it from series, seasons and pending requests, and only pending ones', async () => {
    const doomed = await createTag();
    const kept = await createTag();
    const created = await createSeries({ tagIds: [doomed.id, kept.id] });
    const entry = await createSeason(created.id, { tagIds: [doomed.id] });
    const pending = await asMember('POST', '/catalog-requests', {
      kind: 'new_series',
      series: { title: 'Requested with doomed tag', tagIds: [doomed.id, kept.id] },
      seasons: [{ ordinal: 1, title: 'One', tagIds: [doomed.id] }],
    });
    expect(pending.status).toBe(201);
    const requestId = (pending.body as { id: string }).id;

    expect((await asAdmin('DELETE', `/tags/${doomed.id}`)).status).toBe(204);

    expect((await asMember('GET', `/seasons/${entry.id}`)).body).toMatchObject({
      ownTags: [],
      effectiveTags: [kept],
    });
    expect(await t.db.select().from(tag).where(eq(tag.id, doomed.id))).toEqual([]);
    expect(await t.db.select().from(seriesTag).where(eq(seriesTag.tagId, doomed.id))).toEqual([]);
    expect(await t.db.select().from(seasonTag).where(eq(seasonTag.tagId, doomed.id))).toEqual([]);
    expect(await titlesFor(`tag=${doomed.id}`)).toEqual([]);

    const approved = await asAdmin('POST', `/admin/catalog-requests/${requestId}/decision`, {
      decision: 'approve',
    });
    expect(approved.status).toBe(200);
    expect(approved.body).toMatchObject({
      status: 'approved',
      proposal: { series: { tagIds: [kept.id] }, seasons: [{ tagIds: [] }] },
    });

    expectError(await asAdmin('DELETE', `/tags/${NO_ID}`), 404, 'tag_not_found');
  });
});

describe('cache headers', () => {
  it.each(['/series', '/tags'])('%s is private, revalidated and answers 304', async (path) => {
    const first = await asMember('GET', path);
    expect(first.status).toBe(200);
    expect(first.headers.get('cache-control')).toBe('private, no-cache');
    expect(first.headers.get('vary')).toBe('Cookie');
    const etag = first.headers.get('etag');
    expect(etag).toBeTruthy();

    const response = await t.app.request(`http://osusume.test/api/v1${path}`, {
      headers: { cookie: member.cookie, 'if-none-match': etag ?? '' },
    });
    expect(response.status).toBe(304);
    expect(response.headers.get('cache-control')).toBe('private, no-cache');
    expect(await response.text()).toBe('');
  });

  it('is private on a series and season detail, and a change gives a new ETag', async () => {
    const created = await createSeries();
    const entry = await createSeason(created.id);
    const before = await asMember('GET', `/series/${created.id}`);
    const seasonRead = await asMember('GET', `/seasons/${entry.id}`);
    expect(before.headers.get('cache-control')).toBe('private, no-cache');
    expect(seasonRead.headers.get('cache-control')).toBe('private, no-cache');
    await asAdmin('PATCH', `/series/${created.id}`, { synopsis: 'New words' });
    const after = await asMember('GET', `/series/${created.id}`);
    expect(after.headers.get('etag')).not.toBe(before.headers.get('etag'));
  });

  it('still refuses a logged-out request that carries an ETag', async () => {
    const first = await asMember('GET', '/series');
    const response = await t.app.request('http://osusume.test/api/v1/series', {
      headers: { 'if-none-match': first.headers.get('etag') ?? '' },
    });
    expect(response.status).toBe(401);
  });

  it('marks a 404 as nothing to cache', async () => {
    const response = await asMember('GET', `/series/${NO_ID}`);
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBeNull();
  });
});

describe('the OpenAPI document', () => {
  it('describes the catalog routes with their shared schemas', async () => {
    const response = await t.request('GET', '/api/v1/openapi.json');
    const document = response.body as { paths: Record<string, Record<string, unknown>> };
    expect(Object.keys(document.paths['/series'] ?? {}).sort()).toEqual(['get', 'post']);
    expect(Object.keys(document.paths['/series/{id}'] ?? {}).sort()).toEqual(['delete', 'get', 'patch']);
    expect(Object.keys(document.paths['/seasons/{id}'] ?? {}).sort()).toEqual(['delete', 'get', 'patch']);
    expect(Object.keys(document.paths['/tags/{id}'] ?? {}).sort()).toEqual(['delete', 'patch']);
    expect(JSON.stringify(document)).not.toContain('sourceId');
  });
});
