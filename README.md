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

Account tests send real email to Mailpit, each to an address made up for that test, and read it
back through Mailpit's API. Set `TEST_SMTP_HOST`, `TEST_SMTP_PORT` and `TEST_MAILPIT_URL` to use
a different one.

## Accounts

A fresh install has no accounts. Open the site's first-run setup page, or call
`POST /api/v1/setup`; the emailed link creates the permanent first admin and closes setup for
good. Everyone after that arrives by an approved invite. In development the emails are in
Mailpit's UI on port 8025.

Better Auth is mounted at `/api/auth`, exposing only what `exposedAuthEndpoints` in
`apps/api/src/auth/auth.ts` lists. Its rate limiter keys on the client IP from `X-Forwarded-For`
and trusts that header only when it holds a single value, so a proxy in front of the api must
overwrite the header rather than append to it.

Routes that need a login use `requireSession` or `requireAdmin` from
`apps/api/src/middleware/auth.ts` as their `middleware`, then read `c.var.currentUser`.

## Database

- Change `apps/api/src/db/schema.ts`, then run `pnpm db:generate` and commit the new
  file in `apps/api/drizzle/`.
- `pnpm db:migrate` applies migrations. It is a separate step and the api never runs it on
  startup. In a build, the same entry point is `node apps/api/dist/db/migrate.js`.
