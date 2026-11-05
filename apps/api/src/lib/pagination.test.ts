import { z } from 'zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, gte, sql } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { tag } from '../db/schema.ts';
import { createMigratedDatabase } from '../test-support/scratch-database.ts';
import { ApiError } from './errors.ts';
import { decodeCursor, encodeCursor, keyset, keysetBy, toPage } from './pagination.ts';

const id = '3f2b8c1e-8a55-4a57-9a10-0c8d7f6e5d4c';

describe('cursor encoding', () => {
  it('round-trips each sort type', () => {
    const date = new Date('2026-01-02T03:04:05.678Z');
    expect(decodeCursor(encodeCursor({ sort: date, id }), z.coerce.date())).toEqual({ sort: date, id });
    expect(decodeCursor(encodeCursor({ sort: 'Mushishi', id }), z.string())).toEqual({
      sort: 'Mushishi',
      id,
    });
    expect(decodeCursor(encodeCursor({ sort: 3, id }), z.number())).toEqual({ sort: 3, id });
  });

  it('is safe to put in a URL', () => {
    expect(encodeCursor({ sort: '日本語 ?&=/+', id })).toMatch(/^[\w-]+$/);
  });

  it.each([
    ['not base64 JSON', '%%%'],
    ['the wrong shape', Buffer.from('{"a":1}').toString('base64url')],
    ['a non-uuid id', encodeCursor({ sort: 'x', id: 'nope' })],
    ['the wrong sort type', encodeCursor({ sort: 'x', id })],
  ])('rejects %s with a 400', (_label, raw) => {
    let caught: unknown;
    try {
      decodeCursor(raw, z.number());
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ApiError);
    expect(caught).toMatchObject({ status: 400, code: 'invalid_cursor' });
  });
});

describe('toPage', () => {
  const cursorOf = (row: { id: string }) => ({ sort: row.id, id });

  it('has no next cursor when the rows fit', () => {
    expect(toPage([{ id: 'a' }], 1, cursorOf)).toEqual({ items: [{ id: 'a' }], nextCursor: null });
    expect(toPage([], 1, cursorOf)).toEqual({ items: [], nextCursor: null });
  });

  it('drops the extra row and points the cursor at the last returned row', () => {
    const page = toPage([{ id: 'a' }, { id: 'b' }], 1, cursorOf);
    expect(page.items).toEqual([{ id: 'a' }]);
    expect(page.nextCursor).toBe(encodeCursor({ sort: 'a', id }));
  });
});

describe('keyset on a real Postgres', () => {
  let db: Database;
  let cleanup: () => Promise<void>;
  const since = new Date('2020-01-01T00:00:00.000Z');

  beforeAll(async () => {
    const migrated = await createMigratedDatabase();
    db = migrated.db;
    cleanup = migrated.cleanup;
    // Several rows share a timestamp, so the id tie-break must keep pages stable.
    await db.insert(tag).values(
      Array.from({ length: 7 }, (_, i) => ({
        name: `tag-${String(i)}`,
        createdAt: new Date(since.getTime() + Math.floor(i / 3) * 1000),
      })),
    );
  });

  afterAll(async () => {
    await cleanup();
  });

  async function walk<Sort>(
    sortColumn: typeof tag.createdAt | typeof tag.name,
    sortSchema: z.ZodType<Sort>,
    sortOf: (row: typeof tag.$inferSelect) => string | Date,
    direction: 'asc' | 'desc',
  ) {
    const seen: string[] = [];
    const sizes: number[] = [];
    let cursor: string | undefined;
    const limit = 3;
    do {
      const { where, orderBy } = keyset({
        sortColumn,
        idColumn: tag.id,
        direction,
        cursor: cursor === undefined ? undefined : decodeCursor(cursor, sortSchema),
      });
      const rows = await db
        .select()
        .from(tag)
        .where(and(gte(tag.createdAt, since), where))
        .orderBy(...orderBy)
        .limit(limit + 1);
      const page = toPage(rows, limit, (row) => ({ sort: sortOf(row), id: row.id }));
      seen.push(...page.items.map((row) => row.name));
      sizes.push(page.items.length);
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined);
    return { seen, sizes };
  }

  it('walks computed terms in mixed directions without gaps or repeats', async () => {
    // Two groups of a computed, non-null key: names ending in an even digit, then odd.
    const group = sql<number>`(right(${tag.name}, 1)::int % 2)`;
    const seen: string[] = [];
    let values: unknown[] | undefined;
    do {
      const page = keysetBy(
        [
          { expression: group, type: 'integer', direction: 'asc' },
          { expression: tag.name, type: 'text', direction: 'desc' },
          { expression: tag.id, type: 'uuid', direction: 'asc' },
        ],
        values,
      );
      const rows = await db
        .select({ id: tag.id, name: tag.name, group: sql<number>`${group}` })
        .from(tag)
        .where(and(gte(tag.createdAt, since), page.where))
        .orderBy(...page.orderBy)
        .limit(3);
      seen.push(...rows.map((row) => row.name));
      const last = rows.at(-1);
      values = last && rows.length === 3 ? [last.group, last.name, last.id] : undefined;
    } while (values !== undefined);
    expect(seen).toEqual(['tag-6', 'tag-4', 'tag-2', 'tag-0', 'tag-5', 'tag-3', 'tag-1']);
  });

  it.each(['asc', 'desc'] as const)('walks a timestamp column %s without gaps or repeats', async (direction) => {
    const { seen, sizes } = await walk(tag.createdAt, z.coerce.date(), (row) => row.createdAt, direction);
    expect(sizes).toEqual([3, 3, 1]);
    expect([...seen].sort()).toEqual(Array.from({ length: 7 }, (_, i) => `tag-${String(i)}`));
    expect(new Set(seen).size).toBe(7);
  });

  it.each(['asc', 'desc'] as const)('walks a text column %s in order', async (direction) => {
    const { seen } = await walk(tag.name, z.string(), (row) => row.name, direction);
    const expected = Array.from({ length: 7 }, (_, i) => `tag-${String(i)}`);
    expect(seen).toEqual(direction === 'asc' ? expected : expected.reverse());
  });
});
