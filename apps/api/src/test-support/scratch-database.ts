import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createDatabase } from '../db/client.ts';
import { applyMigrations } from '../db/migrations.ts';

// Matches infra/compose.dev.yaml. Set TEST_DATABASE_URL to use another server;
// its role must be allowed to create databases.
const serverUrl =
  process.env.TEST_DATABASE_URL ?? 'postgres://osusume:osusume_dev@localhost:54329/osusume';

async function onServer(statement: string): Promise<void> {
  const client = new pg.Client({ connectionString: serverUrl });
  try {
    await client.connect();
  } catch (error) {
    throw new Error(
      'Database tests need a running Postgres. Start one with `pnpm dev:services`, ' +
        'or set TEST_DATABASE_URL.',
      { cause: error },
    );
  }
  try {
    await client.query(statement);
  } finally {
    await client.end();
  }
}

export interface ScratchDatabase {
  url: string;
  drop: () => Promise<void>;
}

/** Creates an empty database with a unique name. */
export async function createScratchDatabase(): Promise<ScratchDatabase> {
  const name = `osusume_test_${randomUUID().replaceAll('-', '')}`;
  await onServer(`CREATE DATABASE ${name}`);
  const url = new URL(serverUrl);
  url.pathname = `/${name}`;
  return {
    url: url.toString(),
    drop: () => onServer(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`),
  };
}

/** A scratch database with all migrations applied and a connected client. */
export async function createMigratedDatabase() {
  const scratch = await createScratchDatabase();
  await applyMigrations(scratch.url);
  const { db, pool } = createDatabase(scratch.url);
  return {
    db,
    pool,
    cleanup: async () => {
      await pool.end();
      await scratch.drop();
    },
  };
}
