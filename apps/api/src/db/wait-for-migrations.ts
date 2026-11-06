// Blocks until this build's migrations have been applied, then exits. Run before the api starts
// wherever the migrate step is separate and runs alongside it, such as the Helm chart's Job.
import { EnvValidationError, loadDatabaseEnv } from '../config/env.ts';
import { pendingMigrations } from './migrations.ts';

const POLL_MS = 2000;

try {
  const env = loadDatabaseEnv();
  for (;;) {
    const state = await pendingMigrations(env.DATABASE_URL).catch((error: unknown) =>
      error instanceof Error ? error.message : String(error),
    );
    if (state === false) break;
    console.log(`Waiting for migrations: ${state === true ? 'not applied yet' : state}`);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  console.log('Migrations are in place.');
} catch (error) {
  console.error(error instanceof EnvValidationError ? error.message : error);
  process.exit(1);
}
