import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

// Resolves the same way from src/db and dist/db.
const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

export async function applyMigrations(connectionString: string): Promise<void> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await migrate(drizzle({ client }), { migrationsFolder });
  } finally {
    await client.end();
  }
}

/** Postgres' "no such table" and "no such schema": migrations have never run here. */
const NOT_MIGRATED_YET = new Set(['42P01', '3F000']);

/**
 * Whether this build has migrations the database lacks. Compares timestamps as Drizzle's own
 * migrator does: it applies whatever is newer than the last migration recorded.
 */
export async function pendingMigrations(connectionString: string): Promise<boolean> {
  const journal = JSON.parse(await readFile(`${migrationsFolder}/meta/_journal.json`, 'utf8')) as {
    entries: { when: number }[];
  };
  const latest = Math.max(...journal.entries.map((entry) => entry.when));
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const { rows } = await client.query<{ applied: string | null }>(
      'select max(created_at) as applied from drizzle.__drizzle_migrations',
    );
    return Number(rows[0]?.applied ?? 0) < latest;
  } catch (error) {
    if (NOT_MIGRATED_YET.has((error as { code?: string }).code ?? '')) return true;
    throw error;
  } finally {
    await client.end();
  }
}
