import { type AnyColumn, type SQL, asc, desc, sql } from 'drizzle-orm';
import { z } from 'zod';
import { ApiError } from './errors.ts';
import { jsonHasNul } from './nul-bytes.ts';

export type SortDirection = 'asc' | 'desc';

/** A position in a list: the value of the sort column, then the id tie-break. */
export interface Cursor<Sort> {
  sort: Sort;
  id: string;
}

type CursorSort = string | number | Date | readonly (string | number)[];

export function encodeCursor(cursor: Cursor<CursorSort>): string {
  const sort = cursor.sort instanceof Date ? cursor.sort.toISOString() : cursor.sort;
  return Buffer.from(JSON.stringify([sort, cursor.id]), 'utf8').toString('base64url');
}

/**
 * Decodes a client-supplied cursor. `sortSchema` states the sort column's type,
 * for example `z.coerce.date()` for a timestamp or `z.string()` for a title.
 * Throws a 400 ApiError for anything this api did not issue.
 */
export function decodeCursor<Sort>(raw: string, sortSchema: z.ZodType<Sort>): Cursor<Sort> {
  const json = Buffer.from(raw, 'base64url').toString('utf8');
  if (jsonHasNul(json)) throw invalidCursor();
  let decoded: unknown;
  try {
    decoded = JSON.parse(json);
  } catch {
    throw invalidCursor();
  }
  const parsed = z.tuple([sortSchema, z.uuid()]).safeParse(decoded);
  if (!parsed.success) throw invalidCursor();
  const sort = parsed.data[0];
  if (sort instanceof Date && (sort.getUTCFullYear() < 1 || sort.getUTCFullYear() > 9999)) {
    // A valid Date, but not one Postgres can read back.
    throw invalidCursor();
  }
  return { sort, id: parsed.data[1] };
}

function invalidCursor(): ApiError {
  return new ApiError(400, 'invalid_cursor', 'The pagination cursor is not valid.');
}

/** One sort position of `keysetBy`: an expression that is never null, and its Postgres type. */
export interface SortTerm {
  expression: AnyColumn | SQL;
  /** Needed for a computed expression. A column already knows how to encode its value. */
  type?: 'integer' | 'text' | 'uuid';
  direction: SortDirection;
}

/**
 * Keyset pagination over several sort terms with their own directions, for computed sort keys.
 * The last term must be unique, normally the id. `values` holds the cursor's value for each term.
 * A nullable value cannot be compared this way, so turn it into a key with a place for blanks,
 * for example coalesce(year, 0) to sort blank years last in a descending list.
 */
export function keysetBy(
  terms: readonly SortTerm[],
  values?: readonly unknown[],
): { where: SQL | undefined; orderBy: SQL[] } {
  const orderBy = terms.map((term) =>
    term.direction === 'asc' ? asc(term.expression) : desc(term.expression),
  );
  if (values === undefined) return { where: undefined, orderBy };

  const param = (index: number, term: SortTerm) =>
    term.type === undefined
      ? sql.param(values[index], term.expression as AnyColumn)
      : sql`${values[index]}::${sql.raw(term.type)}`;
  // (a after x) OR (a = x AND b after y) OR (a = x AND b = y AND c after z)
  const branches = terms.map((term, index) => {
    const comparison = term.direction === 'asc' ? sql.raw('>') : sql.raw('<');
    const equalBefore = terms
      .slice(0, index)
      .map((earlier, earlierIndex) => sql`${earlier.expression} = ${param(earlierIndex, earlier)} AND `);
    return sql`(${sql.join(equalBefore)}${term.expression} ${comparison} ${param(index, term)})`;
  });
  return { where: sql`(${sql.join(branches, sql` OR `)})`, orderBy };
}

/**
 * `keysetBy` for the common case: a sort column that is never null, then the id. Query `limit + 1`
 * rows and pass them to `toPage`. Timestamp columns must have millisecond precision (see
 * `timestampMs` in the schema): a Date cannot hold anything finer, so a coarser cursor would skip
 * or repeat rows.
 */
export function keyset<Sort>(options: {
  sortColumn: AnyColumn;
  idColumn: AnyColumn;
  direction?: SortDirection;
  cursor?: Cursor<Sort> | undefined;
}): { where: SQL | undefined; orderBy: SQL[] } {
  const { sortColumn, idColumn, direction = 'asc', cursor } = options;
  return keysetBy(
    [
      { expression: sortColumn, direction },
      { expression: idColumn, direction },
    ],
    cursor && [cursor.sort, cursor.id],
  );
}

/** Turns `limit + 1` fetched rows into the response envelope. */
export function toPage<Row>(
  rows: readonly Row[],
  limit: number,
  cursorOf: (row: Row) => Cursor<CursorSort>,
): { items: Row[]; nextCursor: string | null } {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor: rows.length > limit && last !== undefined ? encodeCursor(cursorOf(last)) : null,
  };
}
