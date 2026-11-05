import { type AnyColumn, type SQL, asc, desc, sql } from 'drizzle-orm';
import { z } from 'zod';
import { ApiError } from './errors.ts';

export type SortDirection = 'asc' | 'desc';

/** A position in a list: the value of the sort column, then the id tie-break. */
export interface Cursor<Sort> {
  sort: Sort;
  id: string;
}

export function encodeCursor(cursor: Cursor<string | number | Date>): string {
  const sort = cursor.sort instanceof Date ? cursor.sort.toISOString() : cursor.sort;
  return Buffer.from(JSON.stringify([sort, cursor.id]), 'utf8').toString('base64url');
}

/**
 * Decodes a client-supplied cursor. `sortSchema` states the sort column's type,
 * for example `z.coerce.date()` for a timestamp or `z.string()` for a title.
 * Throws a 400 ApiError for anything this api did not issue.
 */
export function decodeCursor<Sort>(raw: string, sortSchema: z.ZodType<Sort>): Cursor<Sort> {
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw invalidCursor();
  }
  const parsed = z.tuple([sortSchema, z.uuid()]).safeParse(decoded);
  if (!parsed.success) throw invalidCursor();
  return { sort: parsed.data[0], id: parsed.data[1] };
}

function invalidCursor(): ApiError {
  return new ApiError(400, 'invalid_cursor', 'The pagination cursor is not valid.');
}

/**
 * The WHERE condition and ORDER BY for keyset pagination over a non-null sort
 * column with an id tie-break. Returns `where: undefined` for the first page.
 *
 * Query `limit + 1` rows and pass them to `toPage`, which uses the extra row to
 * tell whether another page exists. Timestamp columns must have millisecond
 * precision (see `timestamps` in the schema): a Date cannot hold anything finer,
 * so a coarser cursor would skip or repeat rows.
 */
export function keyset<Sort>(options: {
  sortColumn: AnyColumn;
  idColumn: AnyColumn;
  direction?: SortDirection;
  cursor?: Cursor<Sort> | undefined;
}): { where: SQL | undefined; orderBy: [SQL, SQL] } {
  const { sortColumn, idColumn, direction = 'asc', cursor } = options;
  const order = direction === 'asc' ? asc : desc;
  const comparison = direction === 'asc' ? sql.raw('>') : sql.raw('<');
  return {
    where: cursor
      ? sql`(${sortColumn}, ${idColumn}) ${comparison} (${sql.param(cursor.sort, sortColumn)}, ${sql.param(cursor.id, idColumn)})`
      : undefined,
    orderBy: [order(sortColumn), order(idColumn)],
  };
}

/** Turns `limit + 1` fetched rows into the response envelope. */
export function toPage<Row>(
  rows: readonly Row[],
  limit: number,
  cursorOf: (row: Row) => Cursor<string | number | Date>,
): { items: Row[]; nextCursor: string | null } {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor: rows.length > limit && last !== undefined ? encodeCursor(cursorOf(last)) : null,
  };
}
