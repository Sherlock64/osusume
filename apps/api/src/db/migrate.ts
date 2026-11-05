// The explicit migrate step: `pnpm db:migrate`. The api never runs this on
// startup. It reads only DATABASE_URL so it can run as a one-shot job.
import { EnvValidationError, loadDatabaseEnv } from '../config/env.ts';
import { applyMigrations } from './migrations.ts';

try {
  const env = loadDatabaseEnv();
  await applyMigrations(env.DATABASE_URL);
  console.log('Migrations applied.');
} catch (error) {
  if (error instanceof EnvValidationError) console.error(error.message);
  else console.error('Migration failed:', error);
  process.exit(1);
}
