# osusume
Anime watch tracker that lets you compare anime you've watched with friends and suggest recommendations.

## Development

Needs Node 26 (`.nvmrc`), pnpm (version pinned in `package.json`) and Podman.

```sh
pnpm install
cp .env.example .env
pnpm dev:services   # Postgres on 127.0.0.1:54329, Mailpit on 127.0.0.1:1025 (UI on :8025)
pnpm db:migrate
pnpm dev:api        # http://localhost:3000/api/v1/health
pnpm dev:web        # http://localhost:5173, proxies /api to the api
```

`pnpm dev:services` uses `podman compose`, which needs a compose provider installed.
Without one, the same services can be started directly:

```sh
podman run -d --name osusume-dev-pg -p 127.0.0.1:54329:5432 \
  -e POSTGRES_USER=osusume -e POSTGRES_PASSWORD=osusume_dev -e POSTGRES_DB=osusume \
  -v osusume-dev-pg:/var/lib/postgresql docker.io/library/postgres:18-alpine
podman run -d --name osusume-dev-mailpit -p 127.0.0.1:1025:1025 -p 127.0.0.1:8025:8025 \
  docker.io/axllent/mailpit:v1.33
```

## Checks

```sh
pnpm typecheck
pnpm lint
pnpm test    # database tests need Postgres running; see TEST_DATABASE_URL below
pnpm build
```

Database tests create and drop their own scratch databases on the dev Postgres. Set
`TEST_DATABASE_URL` to use a different server; its role must be able to create databases.

## Database

- Change `apps/api/src/db/schema.ts`, then run `pnpm db:generate` and commit the new
  file in `apps/api/drizzle/`.
- `pnpm db:migrate` applies migrations. It is a separate step and the api never runs it on
  startup. In a build, the same entry point is `node apps/api/dist/db/migrate.js`.
