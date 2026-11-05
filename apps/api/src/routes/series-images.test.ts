import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { catalogRequest, image } from '../db/schema.ts';
import { type TestApp, createTestApp, expectError } from '../test-support/test-app.ts';

let t: TestApp;
let admin: Awaited<ReturnType<TestApp['seedLoggedIn']>>;
let member: Awaited<ReturnType<TestApp['seedLoggedIn']>>;
let png: Buffer;

const NO_ID = '00000000-0000-4000-8000-000000000000';

beforeAll(async () => {
  t = await createTestApp();
  admin = await t.seedLoggedIn({ role: 'admin', isFirstAdmin: true });
  member = await t.seedLoggedIn();
  png = await sharp({ create: { width: 60, height: 90, channels: 3, background: 'teal' } }).png().toBuffer();
});

afterAll(async () => {
  await t.cleanup();
});

interface CatalogImage {
  id: string;
  isPrimary: boolean;
  width: number;
  height: number;
}
interface Cover {
  id: string;
  width: number;
  height: number;
}
interface SeasonBody {
  id: string;
  coverImageId: string | null;
  cover: Cover | null;
}
interface SeriesBody {
  id: string;
  title: string;
  cover: Cover | null;
  seasons: SeasonBody[];
}
interface Page<Item> {
  items: Item[];
  nextCursor: string | null;
}

const asAdmin = (method: string, path: string, body?: unknown) =>
  t.request(method, `/api/v1${path}`, body, { cookie: admin.cookie });
const asMember = (method: string, path: string, body?: unknown) =>
  t.request(method, `/api/v1${path}`, body, { cookie: member.cookie });

async function makeSeries(title = 'Series') {
  const response = await asAdmin('POST', '/series', { title });
  expect(response.status).toBe(201);
  return response.body as SeriesBody;
}

async function makeSeason(seriesId: string, values: Record<string, unknown> = {}) {
  const response = await asAdmin('POST', '/seasons', { seriesId, ordinal: 1, title: 'Season', ...values });
  expect(response.status).toBe(201);
  return response.body as SeasonBody;
}

async function uploadImage() {
  const response = await t.upload(png, { cookie: admin.cookie });
  expect(response.status).toBe(201);
  return (response.body as { id: string }).id;
}

async function addImage(seriesId: string) {
  const imageId = await uploadImage();
  const response = await asAdmin('POST', `/series/${seriesId}/images`, { imageId });
  expect(response.status).toBe(201);
  return response.body as CatalogImage;
}

async function catalogOf(seriesId: string) {
  const response = await asMember('GET', `/series/${seriesId}/images`);
  expect(response.status).toBe(200);
  return (response.body as Page<CatalogImage>).items;
}

async function storageKeyOf(imageId: string) {
  const [row] = await t.db.select().from(image).where(eq(image.id, imageId));
  return row?.storageKey ?? '';
}

const filesOf = async (storageKey: string) => {
  try {
    return (await readdir(join(t.imageDirectory, storageKey))).sort();
  } catch {
    return [];
  }
};

const seasonRead = async (id: string) => (await asMember('GET', `/seasons/${id}`)).body as SeasonBody;
const seriesRead = async (id: string) => (await asMember('GET', `/series/${id}`)).body as SeriesBody;

describe('authorization', () => {
  it('reading needs a session; a member may read', async () => {
    const series = await makeSeries();
    expectError(await t.request('GET', `/api/v1/series/${series.id}/images`), 401, 'unauthenticated');
    expect((await asMember('GET', `/series/${series.id}/images`)).status).toBe(200);
  });

  it.each([
    ['POST', '', { imageId: NO_ID }],
    ['POST', `/${NO_ID}/primary`, undefined],
    ['DELETE', `/${NO_ID}`, undefined],
  ])('%s /series/{id}/images%s refuses the anonymous and members', async (method, suffix, body) => {
    const series = await makeSeries();
    const path = `/series/${series.id}/images${suffix}`;
    expectError(await t.request(method, `/api/v1${path}`, body), 401, 'unauthenticated');
    expectError(await asMember(method, path, body), 403, 'admin_required');
  });
});

describe('adding', () => {
  it('makes the first image primary and later ones not', async () => {
    const series = await makeSeries();
    const first = await addImage(series.id);
    const second = await addImage(series.id);
    expect(first.isPrimary).toBe(true);
    expect(second.isPrimary).toBe(false);
    expect((await catalogOf(series.id)).map((row) => row.id)).toEqual([first.id, second.id]);
  });

  it('refuses a missing series, a missing image, and an image already in a catalog', async () => {
    const series = await makeSeries();
    const other = await makeSeries();
    const imageId = await uploadImage();
    expectError(await asAdmin('POST', `/series/${NO_ID}/images`, { imageId }), 404, 'series_not_found');
    expectError(await asAdmin('POST', `/series/${series.id}/images`, { imageId: NO_ID }), 404, 'image_not_found');
    expect((await asAdmin('POST', `/series/${series.id}/images`, { imageId })).status).toBe(201);
    expectError(await asAdmin('POST', `/series/${series.id}/images`, { imageId }), 409, 'image_in_catalog');
    expectError(await asAdmin('POST', `/series/${other.id}/images`, { imageId }), 409, 'image_in_catalog');
  });

  it('gives one primary when two images are added at the same moment', async () => {
    const series = await makeSeries();
    const [a, b] = [await uploadImage(), await uploadImage()];
    const responses = await Promise.all([
      asAdmin('POST', `/series/${series.id}/images`, { imageId: a }),
      asAdmin('POST', `/series/${series.id}/images`, { imageId: b }),
    ]);
    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    expect((await catalogOf(series.id)).filter((row) => row.isPrimary)).toHaveLength(1);
  });
});

describe('listing', () => {
  it('pages through the catalog, earliest added first', async () => {
    const series = await makeSeries();
    const added = [await addImage(series.id), await addImage(series.id), await addImage(series.id)];
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const path: string = `/series/${series.id}/images?limit=2${cursor === null ? '' : `&cursor=${cursor}`}`;
      const page = (await asMember('GET', path)).body as Page<CatalogImage>;
      seen.push(...page.items.map((row) => row.id));
      cursor = page.nextCursor;
    } while (cursor !== null);
    expect(seen).toEqual(added.map((row) => row.id));
  });

  it('answers 404 for a missing series, and caches privately', async () => {
    expectError(await asMember('GET', `/series/${NO_ID}/images`), 404, 'series_not_found');
    const series = await makeSeries();
    const response = await asMember('GET', `/series/${series.id}/images`);
    expect(response.headers.get('cache-control')).toBe('private, no-cache');
    expect(response.headers.get('etag')).toBeTruthy();
  });
});

describe('setting the primary', () => {
  it('moves it, leaving exactly one, and setting it twice is harmless', async () => {
    const series = await makeSeries();
    const first = await addImage(series.id);
    const second = await addImage(series.id);
    for (let i = 0; i < 2; i += 1) {
      const response = await asAdmin('POST', `/series/${series.id}/images/${second.id}/primary`);
      expect(response.body).toMatchObject({ id: second.id, isPrimary: true });
    }
    const rows = await catalogOf(series.id);
    expect(rows.filter((row) => row.isPrimary).map((row) => row.id)).toEqual([second.id]);
    expect(rows.find((row) => row.id === first.id)?.isPrimary).toBe(false);
    expect((await seriesRead(series.id)).cover?.id).toBe(second.id);
  });

  it("refuses a missing image and one from another series' catalog", async () => {
    const series = await makeSeries();
    const other = await makeSeries();
    const foreign = await addImage(other.id);
    const path = `/series/${series.id}/images`;
    expectError(await asAdmin('POST', `${path}/${NO_ID}/primary`), 404, 'image_not_found');
    expectError(await asAdmin('POST', `${path}/${foreign.id}/primary`), 404, 'image_not_found');
    expectError(await asAdmin('POST', `/series/${NO_ID}/images/${foreign.id}/primary`), 404, 'series_not_found');
  });
});

describe('one primary, enforced by the database', () => {
  it('refuses a second primary in a series', async () => {
    const series = await makeSeries();
    const first = await addImage(series.id);
    const second = await addImage(series.id);
    expect(first.isPrimary).toBe(true);
    await expect(
      t.db.update(image).set({ isPrimary: true }).where(eq(image.id, second.id)),
    ).rejects.toMatchObject({ cause: { constraint: 'image_one_primary_per_series' } });
  });

  it('refuses a primary outside any catalog', async () => {
    const imageId = await uploadImage();
    await expect(
      t.db.update(image).set({ isPrimary: true }).where(eq(image.id, imageId)),
    ).rejects.toMatchObject({ cause: { constraint: 'image_primary_in_catalog' } });
  });
});

describe('removing', () => {
  it('deletes the row and every file, including the original', async () => {
    const series = await makeSeries();
    await addImage(series.id);
    const second = await addImage(series.id);
    const key = await storageKeyOf(second.id);
    expect(await filesOf(key)).toContain('original');
    expect((await asAdmin('DELETE', `/series/${series.id}/images/${second.id}`)).status).toBe(204);
    expect(await filesOf(key)).toEqual([]);
    expect(await t.db.select().from(image).where(eq(image.id, second.id))).toEqual([]);
    expect((await asMember('GET', `/images/${second.id}/small`)).status).toBe(404);
  });

  it('passes the primary to the earliest added remaining image', async () => {
    const series = await makeSeries();
    const first = await addImage(series.id);
    const second = await addImage(series.id);
    const third = await addImage(series.id);
    expect((await asAdmin('POST', `/series/${series.id}/images/${third.id}/primary`)).status).toBe(200);
    await asAdmin('DELETE', `/series/${series.id}/images/${third.id}`);
    const rows = await catalogOf(series.id);
    expect(rows.find((row) => row.isPrimary)?.id).toBe(first.id);
    expect(rows.map((row) => row.id)).toEqual([first.id, second.id]);
  });

  it('leaves the primary alone when another image is removed', async () => {
    const series = await makeSeries();
    const first = await addImage(series.id);
    const second = await addImage(series.id);
    await asAdmin('DELETE', `/series/${series.id}/images/${second.id}`);
    expect((await catalogOf(series.id)).find((row) => row.isPrimary)?.id).toBe(first.id);
  });

  it('leaves no cover after the last image goes', async () => {
    const series = await makeSeries();
    const only = await addImage(series.id);
    const season = await makeSeason(series.id);
    await asAdmin('DELETE', `/series/${series.id}/images/${only.id}`);
    expect((await seriesRead(series.id)).cover).toBeNull();
    expect((await seasonRead(season.id)).cover).toBeNull();
  });

  it("refuses a missing image and one from another series' catalog", async () => {
    const series = await makeSeries();
    const other = await makeSeries();
    const foreign = await addImage(other.id);
    expectError(await asAdmin('DELETE', `/series/${series.id}/images/${NO_ID}`), 404, 'image_not_found');
    expectError(await asAdmin('DELETE', `/series/${series.id}/images/${foreign.id}`), 404, 'image_not_found');
    expect(await filesOf(await storageKeyOf(foreign.id))).toContain('large.webp');
  });
});

describe('files and transactions', () => {
  it('keeps the row and every file when the transaction rolls back', async () => {
    const series = await makeSeries();
    const added = await addImage(series.id);
    const key = await storageKeyOf(added.id);
    const before = await filesOf(key);
    await t.db.execute(sql`
      CREATE FUNCTION test_refuse_image_delete() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'refused by the test'; END;
      $$
    `);
    await t.db.execute(
      sql`CREATE TRIGGER test_refuse_image_delete BEFORE DELETE ON image FOR EACH ROW EXECUTE FUNCTION test_refuse_image_delete()`,
    );
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect((await asAdmin('DELETE', `/series/${series.id}/images/${added.id}`)).status).toBe(500);
    } finally {
      quiet.mockRestore();
      await t.db.execute(sql`DROP TRIGGER test_refuse_image_delete ON image`);
      await t.db.execute(sql`DROP FUNCTION test_refuse_image_delete`);
    }
    expect(await filesOf(key)).toEqual(before);
    expect(await catalogOf(series.id)).toHaveLength(1);
  });

  it('still succeeds, and logs the key, when removing the files fails after commit', async () => {
    const series = await makeSeries();
    const added = await addImage(series.id);
    const key = await storageKeyOf(added.id);
    const original = t.imageStorage.remove;
    t.imageStorage.remove = () => Promise.reject(new Error('volume is read-only'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect((await asAdmin('DELETE', `/series/${series.id}/images/${added.id}`)).status).toBe(204);
      expect(log).toHaveBeenCalledWith(expect.stringContaining(key), expect.any(Error));
    } finally {
      log.mockRestore();
      t.imageStorage.remove = original;
    }
    expect(await catalogOf(series.id)).toEqual([]);
    expect(await filesOf(key)).toContain('original');
    expect((await seriesRead(series.id)).cover).toBeNull();
    await t.imageStorage.remove(key);
  });
});

describe('deleting a series', () => {
  it('deletes its catalog and all files', async () => {
    const series = await makeSeries();
    const keys = [
      await storageKeyOf((await addImage(series.id)).id),
      await storageKeyOf((await addImage(series.id)).id),
    ];
    expect((await asAdmin('DELETE', `/series/${series.id}`)).status).toBe(204);
    for (const key of keys) expect(await filesOf(key)).toEqual([]);
    expect(await t.db.select().from(image).where(eq(image.seriesId, series.id))).toEqual([]);
  });

  it('keeps the catalog and files when refused for having seasons', async () => {
    const series = await makeSeries();
    const added = await addImage(series.id);
    await makeSeason(series.id);
    expectError(await asAdmin('DELETE', `/series/${series.id}`), 409, 'series_has_seasons');
    expect(await filesOf(await storageKeyOf(added.id))).toContain('original');
    expect(await catalogOf(series.id)).toHaveLength(1);
  });

  it('still rejects pending add-season requests when it has a catalog', async () => {
    const series = await makeSeries();
    await addImage(series.id);
    const filed = await asMember('POST', '/catalog-requests', {
      kind: 'add_season',
      seriesId: series.id,
      season: { ordinal: 1, title: 'x' },
    });
    expect((await asAdmin('DELETE', `/series/${series.id}`)).status).toBe(204);
    const [row] = await t.db
      .select()
      .from(catalogRequest)
      .where(eq(catalogRequest.id, (filed.body as { id: string }).id));
    expect(row?.status).toBe('rejected');
  });
});

describe('resolved covers', () => {
  it('are null with no images, on series, seasons and lists', async () => {
    const series = await makeSeries('Coverless listed');
    const season = await makeSeason(series.id);
    expect((await seriesRead(series.id)).cover).toBeNull();
    expect(await seasonRead(season.id)).toMatchObject({ coverImageId: null, cover: null });
    const list = (await asMember('GET', '/series?q=Coverless+listed')).body as Page<SeriesBody>;
    expect(list.items[0]?.cover).toBeNull();
  });

  it('give the primary to a series and, by default, to its seasons', async () => {
    const series = await makeSeries('Covered listed');
    const season = await makeSeason(series.id);
    const first = await addImage(series.id);
    const cover = { id: first.id, width: 60, height: 90 };
    expect((await seriesRead(series.id)).cover).toEqual(cover);
    expect(await seasonRead(season.id)).toMatchObject({ coverImageId: null, cover });
    expect((await seriesRead(series.id)).seasons[0]?.cover).toEqual(cover);
    const list = (await asMember('GET', '/series?q=Covered+listed')).body as Page<SeriesBody>;
    expect(list.items[0]?.cover).toEqual(cover);
    expect((await asMember('GET', `/images/${cover.id}/small`)).status).toBe(200);
  });

  it('follow a change of primary for a season using the default', async () => {
    const series = await makeSeries();
    const season = await makeSeason(series.id);
    await addImage(series.id);
    const second = await addImage(series.id);
    await asAdmin('POST', `/series/${series.id}/images/${second.id}/primary`);
    expect((await seasonRead(season.id)).cover?.id).toBe(second.id);
  });

  it('let a season choose another image from its own catalog, and clear the choice', async () => {
    const series = await makeSeries();
    const primary = await addImage(series.id);
    const chosen = await addImage(series.id);
    const season = await makeSeason(series.id, { coverImageId: chosen.id });
    expect(season).toMatchObject({ coverImageId: chosen.id, cover: { id: chosen.id } });
    expect((await seriesRead(series.id)).seasons[0]?.cover?.id).toBe(chosen.id);
    expect((await seriesRead(series.id)).cover?.id).toBe(primary.id);

    const cleared = await asAdmin('PATCH', `/seasons/${season.id}`, { coverImageId: null });
    expect(cleared.body).toMatchObject({ coverImageId: null, cover: { id: primary.id } });
  });

  it('fall back to the primary when the chosen image is removed', async () => {
    const series = await makeSeries();
    const primary = await addImage(series.id);
    const chosen = await addImage(series.id);
    const season = await makeSeason(series.id, { coverImageId: chosen.id });
    await asAdmin('DELETE', `/series/${series.id}/images/${chosen.id}`);
    expect(await seasonRead(season.id)).toMatchObject({ coverImageId: null, cover: { id: primary.id } });
  });

  it("refuse a season cover from another series' catalog, or outside any catalog", async () => {
    const series = await makeSeries();
    await addImage(series.id);
    const other = await makeSeries();
    const foreign = await addImage(other.id);
    const unattached = await uploadImage();
    expectError(
      await asAdmin('POST', '/seasons', { seriesId: series.id, ordinal: 1, title: 'x', coverImageId: foreign.id }),
      400,
      'image_not_in_series',
    );
    const season = await makeSeason(series.id);
    for (const coverImageId of [foreign.id, unattached, NO_ID]) {
      expectError(await asAdmin('PATCH', `/seasons/${season.id}`, { coverImageId }), 400, 'image_not_in_series');
    }
  });

  it('ignore a cover sent when creating or editing a series', async () => {
    const created = await asAdmin('POST', '/series', { title: 'No direct cover', coverImageId: NO_ID });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ cover: null });
  });
});

describe('moving a season with its own cover', () => {
  it('clears a cover from the old catalog, and uses the new primary', async () => {
    const from = await makeSeries();
    const to = await makeSeries();
    await addImage(from.id);
    const chosen = await addImage(from.id);
    const newPrimary = await addImage(to.id);
    const season = await makeSeason(from.id, { coverImageId: chosen.id });
    const moved = await asAdmin('PATCH', `/seasons/${season.id}`, { seriesId: to.id });
    expect(moved.body).toMatchObject({ seriesId: to.id, coverImageId: null, cover: { id: newPrimary.id } });
    // The image itself stays in the old catalog.
    expect((await catalogOf(from.id)).map((row) => row.id)).toContain(chosen.id);
  });

  it('gives no cover if the new series has no images', async () => {
    const from = await makeSeries();
    const to = await makeSeries();
    const chosen = await addImage(from.id);
    const season = await makeSeason(from.id, { coverImageId: chosen.id });
    const moved = await asAdmin('PATCH', `/seasons/${season.id}`, { seriesId: to.id });
    expect(moved.body).toMatchObject({ coverImageId: null, cover: null });
  });

  it('can choose a cover from the new catalog in the same request, and not from the old', async () => {
    const from = await makeSeries();
    const to = await makeSeries();
    const old = await addImage(from.id);
    await addImage(to.id);
    const fresh = await addImage(to.id);
    const season = await makeSeason(from.id, { coverImageId: old.id });
    expectError(
      await asAdmin('PATCH', `/seasons/${season.id}`, { seriesId: to.id, coverImageId: old.id }),
      400,
      'image_not_in_series',
    );
    const moved = await asAdmin('PATCH', `/seasons/${season.id}`, { seriesId: to.id, coverImageId: fresh.id });
    expect(moved.body).toMatchObject({ coverImageId: fresh.id, cover: { id: fresh.id } });
  });

  it('keeps the cover on an edit that does not move it', async () => {
    const series = await makeSeries();
    const chosen = await addImage(series.id);
    const season = await makeSeason(series.id, { coverImageId: chosen.id });
    const edited = await asAdmin('PATCH', `/seasons/${season.id}`, { title: 'Renamed', seriesId: series.id });
    expect(edited.body).toMatchObject({ coverImageId: chosen.id });
  });
});
