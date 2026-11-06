import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.ts';

/**
 * How close a search must be for `<%` to call it a misspelling (see catalog/search.ts). Postgres's
 * default of 0.6 misses one wrong letter in a short title, such as "Bleech". Lower lets in more
 * loose matches, which sort after the close ones.
 */
const WORD_SIMILARITY_THRESHOLD = 0.35;

export function createDatabase(connectionString: string) {
  const pool = new pg.Pool({
    connectionString,
    options: `-c pg_trgm.word_similarity_threshold=${String(WORD_SIMILARITY_THRESHOLD)}`,
  });
  const db = drizzle({ client: pool, schema, casing: 'snake_case' });
  return { db, pool };
}

export type Database = ReturnType<typeof createDatabase>['db'];
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
