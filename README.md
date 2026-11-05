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

That limiter counts per client IP on `/api/auth`. Other routes that check a password
(`POST /me/email`, `DELETE /me`) use `requireSessionForPasswordCheck`, which allows 3 attempts per
10 seconds per user. Both keep their counts in memory: they reset on restart, and each api process
counts separately, so running N instances allows N times the attempts.

Answers about an address give nothing away. A non-admin always gets the same success from
`POST /invite-requests`, including for an address with an account, on the blacklist or with an open
invite: a refused address creates no row and sends nothing, and only the admin queue,
`GET /admin/invite-requests`, shows requests. Members have no record of who they invited.
`POST /me/email`, once the password is correct, and `POST /me/email/verify` always answer a
non-admin "Request completed", whatever happened. So that timing or a failed send does not tell the
two apart, a non-admin's link is sent after the response; a send failure is logged and drops the
link. Admins get the specific reason, including `email_failed`. Malformed input, a wrong password
and rate limiting are still reported to everyone.

Any invite link that cannot be used gets one identical answer from `GET /invites/{token}` and
`POST /invites/{token}/accept`, for every caller, admins included.

Routes that need a login use `requireSession` or `requireAdmin` from
`apps/api/src/middleware/auth.ts` as their `middleware`, then read `c.var.currentUser`.

## Catalog

Members read the catalog and file requests; only admins write to it. `GET /series` lists newest
first by each series' earliest dated season, with blank dates last, or best match first when
searching. Catalog reads carry `Cache-Control: private, no-cache` and an ETag, so the browser asks
again each time, which rechecks the session, and an unchanged response costs a 304.

Writes that span rows take `lockCatalog` from `apps/api/src/lib/locks.ts`, before any row lock.

## Images

Uploads are validated by content, resized with sharp and served as WebP. Everything kept is
re-encoded, which drops metadata such as EXIF location, including the original, which is stored so
sizes can be regenerated and is never served. Files live under `IMAGE_STORAGE_PATH` through the
`ImageStorage` interface in `apps/api/src/lib/image-storage.ts`; the volume is the only backend.
The upload limit and named sizes are set in `packages/shared/src/catalog.ts`, the accepted formats
in `apps/api/src/lib/image-processing.ts`. An image's URL never changes content, so reads are
cached privately for a week.

An admin uploads and attaches in one call, a multipart `POST /series/{id}/images` with the image in
the `file` field, so an image is always in a catalog. If adding it fails after its files are written,
the files are removed. The first image becomes the primary. Series and seasons return a
resolved `cover`: the season's own choice, else the series primary, else null for a placeholder.

Files are removed after the transaction commits, so a rollback never loses one. If removal fails,
the api logs the storage key and still answers with success: the rows are gone, so nothing points
at the leftover files, which stay on the volume until removed by hand.

## Database

- Change `apps/api/src/db/schema.ts`, then run `pnpm db:generate` and commit the new
  file in `apps/api/drizzle/`.
- `pnpm db:migrate` applies migrations. It is a separate step and the api never runs it on
  startup. In a build, the same entry point is `node apps/api/dist/db/migrate.js`.
