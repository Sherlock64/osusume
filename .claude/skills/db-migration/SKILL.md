---
name: db-migration
description: Change the Osusume Postgres schema with Drizzle - edit schema.ts, generate and commit the migration, apply it locally and test it. Use for any new table, column, index or constraint.
---

# Change the database schema

1. Change `apps/api/src/db/schema.ts`.
2. Make the migration file:

   ```sh
   pnpm db:generate
   ```

3. Read the new SQL file in `apps/api/drizzle/`. Make sure that it does not delete data that users need. A new `NOT NULL` column on a table with rows needs a default.
4. Apply it to the local database: `pnpm db:migrate`.
5. Run `pnpm --filter @osusume/api test migrations` and the tests of the area.
6. Commit `schema.ts`, the SQL file and the `meta/` changes in the same commit.

Do not edit a migration that is already on `main`. Make a new one.

The api never applies migrations when it starts. Compose runs a `migrate` step, and Helm runs an init container. Both run before the api starts.
