import { serve } from '@hono/node-server';
import { sql } from 'drizzle-orm';
import { createApp } from './app.ts';
import { EnvValidationError, loadEnv } from './config/env.ts';
import { createDatabase } from './db/client.ts';

let env;
try {
  env = loadEnv();
} catch (error) {
  console.error(error instanceof EnvValidationError ? error.message : error);
  process.exit(1);
}

const { db, pool } = createDatabase(env.DATABASE_URL);

const app = createApp({
  checkDatabase: async () => {
    await db.execute(sql`select 1`);
  },
});

const server = serve({ fetch: app.fetch, hostname: env.HOST, port: env.PORT }, (info) => {
  console.log(`Osusume api listening on ${info.address}:${String(info.port)}`);
});

function shutdown(): void {
  server.close(() => {
    void pool.end().then(() => process.exit(0));
  });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
