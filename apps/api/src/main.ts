import { serve } from '@hono/node-server';
import { sql } from 'drizzle-orm';
import { createApp } from './app.ts';
import { createAuth } from './auth/auth.ts';
import { EnvValidationError, loadEnv } from './config/env.ts';
import { createDatabase } from './db/client.ts';
import { createVolumeImageStorage } from './lib/image-storage.ts';
import { createSmtpMailer } from './lib/mailer.ts';

let env;
try {
  env = loadEnv();
} catch (error) {
  console.error(error instanceof EnvValidationError ? error.message : error);
  process.exit(1);
}

const { db, pool } = createDatabase(env.DATABASE_URL);

const mailer = createSmtpMailer(env);
const auth = createAuth({
  db,
  secret: env.AUTH_SECRET,
  publicBaseUrl: env.PUBLIC_BASE_URL,
  mailer,
});

const app = createApp({
  checkDatabase: async () => {
    await db.execute(sql`select 1`);
  },
  db,
  auth,
  mailer,
  imageStorage: createVolumeImageStorage(env.IMAGE_STORAGE_PATH),
  publicBaseUrl: env.PUBLIC_BASE_URL,
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
