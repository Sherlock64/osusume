import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type ScratchDatabase,
  createScratchDatabase,
} from '../test-support/scratch-database.ts';
import { createDatabase } from './client.ts';
import { applyMigrations } from './migrations.ts';
import { series, titleSearchText, titleSearchVector } from './schema.ts';

describe('migrations on a real Postgres', () => {
  let scratch: ScratchDatabase;
  let client: pg.Client;

  async function rows<Row extends pg.QueryResultRow>(text: string): Promise<Row[]> {
    return (await client.query<Row>(text)).rows;
  }

  beforeAll(async () => {
    scratch = await createScratchDatabase();
    await applyMigrations(scratch.url);
    client = new pg.Client({ connectionString: scratch.url });
    await client.connect();
  });

  afterAll(async () => {
    await client.end();
    await scratch.drop();
  });

  it('creates every table', async () => {
    const tables = await rows<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' ORDER BY table_name`,
    );
    expect(tables.map((t) => t.table_name)).toEqual([
      'account',
      'catalog_request',
      'email_blacklist',
      'email_change_request',
      'friendship',
      'image',
      'invite_request',
      'list_entry',
      'list_settings',
      'season',
      'season_tag',
      'series',
      'series_tag',
      'session',
      'tag',
      'user',
      'username_change_request',
      'verification',
    ]);
  });

  it('applies again without changing anything', async () => {
    await expect(applyMigrations(scratch.url)).resolves.toBeUndefined();
  });

  it('uses UUID primary keys', async () => {
    const ids = await rows<{ table_name: string; data_type: string }>(
      `SELECT table_name, data_type FROM information_schema.columns
       WHERE table_schema = 'public' AND column_name = 'id'`,
    );
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.filter((c) => c.data_type !== 'uuid')).toEqual([]);
  });

  it('installs pg_trgm', async () => {
    expect(await rows(`SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'`)).toHaveLength(1);
  });

  it.each([
    ['series_title_trgm_idx', 'gin'],
    ['series_title_fts_idx', 'gin'],
    ['season_title_trgm_idx', 'gin'],
    ['season_title_fts_idx', 'gin'],
  ])('creates search index %s', async (name, method) => {
    const [row] = await rows<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE indexname = '${name}'`,
    );
    expect(row?.indexdef).toContain(`USING ${method}`);
  });

  it('serves title searches from the search indexes, including alternate titles', async () => {
    const { db, pool } = createDatabase(scratch.url);
    try {
      await db.insert(series).values({ title: 'Mushishi', altTitles: ['Bug Master'] });

      const fts = titleSearchVector(series.title, series.altTitles);
      const trigram = titleSearchText(series.title, series.altTitles);
      expect(
        await db
          .select({ title: series.title })
          .from(series)
          .where(sql`${fts} @@ plainto_tsquery('simple', 'master')`),
      ).toEqual([{ title: 'Mushishi' }]);
      expect(
        await db
          .select({ title: series.title })
          .from(series)
          .where(sql`${trigram} ILIKE ${'%bug mas%'}`),
      ).toEqual([{ title: 'Mushishi' }]);

      // Seq scans are off so a small table still shows whether the index can serve the query.
      const planClient = await pool.connect();
      try {
        await planClient.query('SET enable_seqscan = off');
        const plan = async (where: string) =>
          (await planClient.query<{ 'QUERY PLAN': string }>(`EXPLAIN SELECT * FROM series WHERE ${where}`))
            .rows.map((r) => r['QUERY PLAN'])
            .join('\n');
        expect(
          await plan(
            `to_tsvector('simple'::regconfig, osusume_title_search_text(title, alt_titles)) @@ plainto_tsquery('simple', 'master')`,
          ),
        ).toContain('series_title_fts_idx');
        expect(await plan(`osusume_title_search_text(title, alt_titles) ILIKE '%bug mas%'`)).toContain(
          'series_title_trgm_idx',
        );
      } finally {
        planClient.release();
      }
    } finally {
      await pool.end();
    }
  });
});

describe('migration 0007', () => {
  it('removes images in no catalog, keeps the rest, and makes the columns required', async () => {
    const before = await mkdtemp(join(tmpdir(), 'osusume-migrations-'));
    const scratch = await createScratchDatabase();
    const client = new pg.Client({ connectionString: scratch.url });
    await client.connect();
    try {
      // The migrations as they stood before this one.
      await cp(fileURLToPath(new URL('../../drizzle', import.meta.url)), before, { recursive: true });
      const journalPath = join(before, 'meta', '_journal.json');
      const journal = JSON.parse(await readFile(journalPath, 'utf8')) as { entries: { idx: number }[] };
      journal.entries = journal.entries.filter((entry) => entry.idx < 7);
      await writeFile(journalPath, JSON.stringify(journal));
      await migrate(drizzle({ client }), { migrationsFolder: before });

      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO series (title) VALUES ('Kept') RETURNING id`,
      );
      await client.query(
        `INSERT INTO image (storage_key, mime, width, height) VALUES ('images/unattached', 'image/webp', 1, 1)`,
      );
      await client.query(
        `INSERT INTO image (storage_key, mime, width, height, series_id, is_primary, added_at)
         VALUES ('images/attached', 'image/webp', 1, 1, $1, true, now())`,
        [rows[0]?.id],
      );

      await applyMigrations(scratch.url);

      const left = await client.query(`SELECT storage_key FROM image`);
      expect(left.rows).toEqual([{ storage_key: 'images/attached' }]);
      const columns = await client.query(
        `SELECT column_name, is_nullable FROM information_schema.columns
         WHERE table_name = 'image' AND column_name IN ('series_id', 'added_at')`,
      );
      expect(columns.rows.map((column: { is_nullable: string }) => column.is_nullable)).toEqual(['NO', 'NO']);
    } finally {
      await client.end();
      await scratch.drop();
      await rm(before, { recursive: true, force: true });
    }
  });
});
