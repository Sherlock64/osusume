import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_IMAGE_UPLOAD_BYTES, imageSizeEdges, imageSizes } from '@osusume/shared';
import { removeUser } from '../auth/accounts.ts';
import { image } from '../db/schema.ts';
import { createVolumeImageStorage } from '../lib/image-storage.ts';
import { type TestApp, createTestApp, expectError } from '../test-support/test-app.ts';

let t: TestApp;
let admin: Awaited<ReturnType<TestApp['seedLoggedIn']>>;
let member: Awaited<ReturnType<TestApp['seedLoggedIn']>>;
let png: Buffer;

const NO_ID = '00000000-0000-4000-8000-000000000000';

const solid = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 200, g: 40, b: 90 } } });

beforeAll(async () => {
  t = await createTestApp();
  admin = await t.seedLoggedIn({ role: 'admin', isFirstAdmin: true });
  member = await t.seedLoggedIn();
  png = await solid(800, 1200).png().toBuffer();
});

afterAll(async () => {
  await t.cleanup();
});

interface ImageBody {
  id: string;
  mime: string;
  width: number;
  height: number;
}

async function uploaded(bytes: Uint8Array = png) {
  const response = await t.upload(bytes, { cookie: admin.cookie });
  expect(response.status).toBe(201);
  return response.body as ImageBody;
}

async function fetchImage(id: string, size: string, headers: Record<string, string> = {}, cookie = member.cookie) {
  return t.app.request(`http://osusume.test/api/v1/images/${id}/${size}`, {
    headers: { cookie, ...headers },
  });
}

describe('authorization', () => {
  it('uploading refuses the anonymous and members', async () => {
    expectError(await t.upload(png), 401, 'unauthenticated');
    expectError(await t.upload(png, { cookie: member.cookie }), 403, 'admin_required');
  });

  it('reading needs a session', async () => {
    const { id } = await uploaded();
    const response = await t.app.request(`http://osusume.test/api/v1/images/${id}/small`);
    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBeNull();
  });
});

describe('uploading', () => {
  it.each([
    ['JPEG', () => solid(100, 100).jpeg().toBuffer()],
    ['PNG', () => solid(100, 100).png().toBuffer()],
    ['WebP', () => solid(100, 100).webp().toBuffer()],
  ])('accepts a real %s', async (_label, make) => {
    const body = await uploaded(await make());
    expect(body).toMatchObject({ mime: 'image/webp', width: 100, height: 100 });
  });

  it('records the uploader and the large size, and writes every size to storage', async () => {
    const body = await uploaded();
    expect(body).toMatchObject({ width: 427, height: 640 });
    const [row] = await t.db.select().from(image).where(eq(image.id, body.id));
    expect(row?.uploadedBy).toBe(admin.id);
    const files = await readdir(join(t.imageDirectory, row?.storageKey ?? ''));
    expect(files.sort()).toEqual(imageSizes.map((size) => `${size}.webp`).sort());
  });

  it('goes by the content, not the declared type or name', async () => {
    const response = await t.upload(png, { cookie: admin.cookie, type: 'text/plain', name: 'notes.txt' });
    expect(response.status).toBe(201);
  });

  it.each([
    ['text declared as a PNG', Buffer.from('this is not an image at all, only words')],
    ['HTML declared as a PNG', Buffer.from('<!doctype html><script>alert(1)</script>')],
    ['an SVG declared as a PNG', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="9" height="9"/>')],
    ['an empty file', Buffer.alloc(0)],
  ])('refuses %s', async (_label, bytes) => {
    const response = await t.upload(bytes, { cookie: admin.cookie, type: 'image/png', name: 'cover.png' });
    expectError(response, 415, 'unsupported_image_format');
  });

  it('refuses a real image in a format it does not accept', async () => {
    const gif = await solid(10, 10).gif().toBuffer();
    expectError(await t.upload(gif, { cookie: admin.cookie, type: 'image/png' }), 415, 'unsupported_image_format');
    const tiff = await solid(10, 10).tiff().toBuffer();
    expectError(await t.upload(tiff, { cookie: admin.cookie, type: 'image/png' }), 415, 'unsupported_image_format');
  });

  it('refuses a truncated image with a valid signature', async () => {
    const whole = await solid(400, 400).jpeg().toBuffer();
    const cut = whole.subarray(0, Math.floor(whole.length / 2));
    expectError(await t.upload(cut, { cookie: admin.cookie, type: 'image/jpeg' }), 400, 'invalid_image');
  });

  it('refuses garbage behind a valid signature', async () => {
    const fake = Buffer.concat([png.subarray(0, 8), Buffer.alloc(500, 7)]);
    expectError(await t.upload(fake, { cookie: admin.cookie }), 400, 'invalid_image');
  });

  it('refuses a small file that decodes to a huge image', async () => {
    const bomb = await solid(8000, 8000).png({ compressionLevel: 9 }).toBuffer();
    expect(bomb.length).toBeLessThan(MAX_IMAGE_UPLOAD_BYTES);
    expectError(await t.upload(bomb, { cookie: admin.cookie }), 400, 'invalid_image');
  });

  it('refuses a file over the limit', async () => {
    const big = Buffer.alloc(MAX_IMAGE_UPLOAD_BYTES + 1, 0);
    expectError(await t.upload(big, { cookie: admin.cookie }), 413, 'image_too_large');
    const far = Buffer.alloc(MAX_IMAGE_UPLOAD_BYTES + 1024 * 1024, 0);
    expectError(await t.upload(far, { cookie: admin.cookie }), 413, 'image_too_large');
  });

  it('refuses a body with no file field', async () => {
    expectError(await t.upload(png, { cookie: admin.cookie, field: 'other' }), 400, 'validation_error');
  });

  it('refuses a body that is not multipart', async () => {
    const response = await t.request('POST', '/api/v1/images', { file: 'nope' }, { cookie: admin.cookie });
    expectError(response, 415, 'bad_request');
  });

  it('drops metadata such as location from what it stores', async () => {
    const tagged = await solid(50, 50)
      .jpeg()
      .withExif({ IFD0: { Copyright: 'Private person', Artist: 'Private person' } })
      .toBuffer();
    expect((await sharp(tagged).metadata()).exif).toBeDefined();
    const { id } = await uploaded(tagged);
    const stored = Buffer.from(await (await fetchImage(id, 'large')).arrayBuffer());
    const metadata = await sharp(stored).metadata();
    expect(metadata.exif).toBeUndefined();
    expect(stored.includes('Private person')).toBe(false);
  });

  it('applies EXIF orientation before storing', async () => {
    const rotated = await solid(40, 20).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    expect(await uploaded(rotated)).toMatchObject({ width: 20, height: 40 });
  });

  it('removes its files if the database write fails', async () => {
    const before = await readdir(join(t.imageDirectory, 'images'));
    const original = t.db.insert.bind(t.db);
    t.db.insert = () => {
      throw new Error('database is down');
    };
    const originalError = console.error;
    console.error = () => undefined;
    try {
      const response = await t.upload(png, { cookie: admin.cookie });
      expect(response.status).toBe(500);
    } finally {
      t.db.insert = original;
      console.error = originalError;
    }
    expect((await readdir(join(t.imageDirectory, 'images'))).sort()).toEqual(before.sort());
  });
});

describe('reading', () => {
  it.each(imageSizes)('serves %s as WebP, fitted inside its edge and not cropped', async (size) => {
    const { id } = await uploaded();
    const response = await fetchImage(id, size);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/webp');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    const metadata = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
    expect(metadata.format).toBe('webp');
    expect(metadata.height).toBe(imageSizeEdges[size]);
    expect(metadata.width).toBe(Math.round((imageSizeEdges[size] * 800) / 1200));
  });

  it('never enlarges a small image', async () => {
    const { id } = await uploaded(await solid(30, 20).png().toBuffer());
    const metadata = await sharp(Buffer.from(await (await fetchImage(id, 'large')).arrayBuffer())).metadata();
    expect(metadata).toMatchObject({ width: 30, height: 20 });
  });

  it('is private, long-lived and revalidates with a 304', async () => {
    const { id } = await uploaded();
    const first = await fetchImage(id, 'small');
    expect(first.headers.get('cache-control')).toBe('private, max-age=604800, immutable');
    expect(first.headers.get('vary')).toBe('Cookie');
    const etag = first.headers.get('etag') ?? '';
    const second = await fetchImage(id, 'small', { 'if-none-match': etag });
    expect(second.status).toBe(304);
    expect(second.headers.get('cache-control')).toBe('private, max-age=604800, immutable');
    expect(await second.text()).toBe('');
  });

  it('refuses an unknown size, a missing image and a malformed id', async () => {
    const { id } = await uploaded();
    expect((await fetchImage(id, 'original')).status).toBe(400);
    expect((await fetchImage(NO_ID, 'small')).status).toBe(404);
    expect((await fetchImage('../../etc', 'small')).status).toBe(404);
    expect((await fetchImage('not-a-uuid', 'small')).status).toBe(400);
  });

  it('answers 404 if the stored file is gone', async () => {
    const { id } = await uploaded();
    await t.imageStorage.remove(`images/${id}`);
    const originalError = console.error;
    console.error = () => undefined;
    try {
      expect((await fetchImage(id, 'small')).status).toBe(404);
    } finally {
      console.error = originalError;
    }
  });
});

describe('use as a cover', () => {
  it('can be set on a series and a season, and cleared', async () => {
    const { id } = await uploaded();
    const series = await t.request('POST', '/api/v1/series', { title: 'Covered', coverImageId: id }, { cookie: admin.cookie });
    expect(series.body).toMatchObject({ coverImageId: id });
    const seriesId = (series.body as { id: string }).id;
    const season = await t.request(
      'POST',
      '/api/v1/seasons',
      { seriesId, ordinal: 1, title: 'One', coverImageId: id },
      { cookie: admin.cookie },
    );
    expect(season.body).toMatchObject({ coverImageId: id });
    const cleared = await t.request('PATCH', `/api/v1/series/${seriesId}`, { coverImageId: null }, { cookie: admin.cookie });
    expect(cleared.body).toMatchObject({ coverImageId: null });
  });

  it('stays when the uploader is removed, with their identity blanked', async () => {
    const leaving = await t.seedLoggedIn({ role: 'admin' });
    const response = await t.upload(png, { cookie: leaving.cookie });
    const { id } = response.body as ImageBody;
    await removeUser(t.db, leaving.id);
    const [row] = await t.db.select().from(image).where(eq(image.id, id));
    expect(row?.uploadedBy).toBeNull();
    expect((await fetchImage(id, 'small')).status).toBe(200);
  });
});

describe('the volume storage', () => {
  it('stores, reads, removes, and refuses a key that leaves the volume', async () => {
    const storage = createVolumeImageStorage(join(t.imageDirectory, 'unit'));
    const bytes = new Uint8Array([1, 2, 3]);
    await storage.put('a/b/c.bin', bytes);
    expect(new Uint8Array((await storage.get('a/b/c.bin')) ?? [])).toEqual(bytes);
    expect(await storage.get('a/b/missing.bin')).toBeNull();
    await storage.remove('a');
    expect(await storage.get('a/b/c.bin')).toBeNull();
    await expect(storage.get('../outside.bin')).rejects.toThrow('leaves the volume');
    await expect(storage.put('../outside.bin', bytes)).rejects.toThrow('leaves the volume');
  });
});
