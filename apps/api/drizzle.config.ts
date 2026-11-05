import { defineConfig } from 'drizzle-kit';

// Used by `drizzle-kit generate`, which reads the schema only and needs no
// database connection. Migrations are applied by src/db/migrate.ts.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  casing: 'snake_case',
});
