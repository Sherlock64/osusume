# Architecture

This document tells you how the parts of Osusume connect, and which rules the code keeps. Read it before you change the api, the database or the deployment.

## Parts

```text
browser
   |
   v
proxy (nginx in Compose, ingress-nginx in minikube)
   |-- /api/*, /robots.txt --> api  (Node, Hono)  --> PostgreSQL
   |                                              --> image volume
   |                                              --> SMTP (Mailpit or real)
   `-- everything else -----> web  (nginx, static files of the React app)
```

In local development, Vite serves the web app and sends `/api/*` to the api. Thus, in all environments the browser sees one address.

## Folders

| Folder | Contents |
| --- | --- |
| `apps/api` | The HTTP api. Hono routes, Better Auth, Drizzle schema and migrations. |
| `apps/web` | The React single-page app. |
| `packages/shared` | Zod schemas, enums and types that the api and the web app both use. |
| `e2e` | Playwright smoke tests and the validation run. |
| `infra` | Compose files, nginx configuration and the Helm chart. |
| `Containerfile` | One file for the two images: target `api` and target `web`. |
| `PRD` | Product documents. Git ignores this folder. It is only on the owner's computer, so other contributors do not have it. |

## API

`apps/api/src/app.ts` makes the Hono app. It mounts all routes under `/api/v1`, and Better Auth under `/api/auth`. It exports the type `AppType`.

| Folder | Contents |
| --- | --- |
| `routes/` | One file for each area, for example `catalog.ts`, `lists.ts` and `canvas.ts`. Most route files have a test file next to them. |
| `auth/` | Better Auth setup. `exposedAuthEndpoints` lists the only auth endpoints that the api makes available. |
| `middleware/` | `requireSession` and `requireAdmin`. A route puts one of them first. Then it reads `c.var.currentUser`. |
| `social/` | `canView`, the one visibility check for lists and maps. |
| `catalog/` | Catalog search, entries and change requests. |
| `db/` | `schema.ts`, the database client and the migration command. |
| `lib/` | Errors, rate limits, locks, images, mail, pagination and HTTP cache helpers. |
| `config/` | Reads and validates the environment variables when the api starts. |
| `test-support/` | Scratch databases and Mailpit helpers for the tests. |

### Request rules

- The api validates all input with Zod schemas, most of them from `packages/shared`.
- A request body can be 1 MiB or less (`limitRequestBody` in `lib/body-size.ts`). Only image uploads can be larger. They have their own limit.
- An error answer has a stable code, for example `friend_request_self`, and a message. The web app reads it into an `ApiError` (`apps/web/src/lib/api-request.ts`) and uses the code to make decisions.
- Answers for one user have `Cache-Control: private, no-store`. Catalog reads have `private, no-cache` and an ETag, so the browser asks again each time and gets a 304 if nothing changed.

## Web app

`apps/web/src/router.tsx` builds the routes. The route files are in `apps/web/src/routes`. Pages that need a login are children of `appRoute`. `appRoute` checks the session and draws the shell. The menu is in `apps/web/src/app/nav.ts`.

The web app calls the api through `api` in `apps/web/src/lib/api.ts`. This is a Hono client of type `AppType`, so TypeScript checks each call against the api routes. TanStack Query keeps the server data.

The Constellations map is in `apps/web/src/components/canvas/`. It uses React Flow. The layout rules (positions, free spots, groups) are in `apps/web/src/lib/canvas-layout.ts` and have unit tests.

The look is in [design-guide.md](design-guide.md).

## Data model

The tables are in `apps/api/src/db/schema.ts`.

| Area | Tables |
| --- | --- |
| Accounts (Better Auth) | `user`, `session`, `account`, `verification` |
| Account requests | `invite_request`, `username_change_request`, `email_change_request`, `email_blacklist` |
| Catalog | `series`, `season`, `tag`, `series_tag`, `season_tag`, `image`, `catalog_request` |
| Lists | `list_entry` (one row for each user and season), `list_settings`, `series_rating` |
| Social | `friendship` (one row for each pair, in one of the two directions) |
| Constellations | `canvas_position`, `canvas_link`, `canvas_group`, `canvas_group_member` |

A series is on a user's map if one or more of its seasons has a status other than `plan_to_watch`. The map always agrees with the list. You cannot hide a series from the map.

## Rules that the code keeps

### Accounts

- A new install has no accounts. First-run setup (`POST /api/v1/setup`) emails a link. The link makes the first admin and closes setup permanently. Nobody can demote, disable or remove the first admin.
- After setup, each new member comes in through an invite that an admin approved.
- Answers about an email address give no information. For example, a member that asks for an invite always gets the same success, also for an address that has an account. Only the admin queue shows the requests. Admins get the specific reason.
- Each invite link that is not valid gets the same answer, for all callers.

### Rate limits

- The Better Auth limiter counts for each client IP on `/api/auth`. It uses the `X-Forwarded-For` header only if the header has one value. Thus, a proxy in front of the api must replace the header, not add to it.
- Routes that check a password (`POST /me/email`, `DELETE /me`) allow 3 attempts in 10 seconds for each user.
- `POST /invite-requests` allows 10 requests in one hour for each user. `POST /invites/{token}/accept` allows 10 attempts in one minute for each client IP.
- All counts are in memory. A restart clears them. Each api process counts separately, so the api runs as one replica.

### Visibility

- `canView` in `apps/api/src/social/lists.ts` is the only visibility check. It controls the member view, the public view, compare and the map. Roles have no effect, so an admin sees the same as a member.
- A list without a `list_settings` row is private.
- A missing user, a disabled user and a hidden list all get the same 404.
- `GET /lists/{slug}` needs no login. It shows titles and status only. The slug exists only while the list is public. When the list becomes public again, it gets a new slug.

### Catalog and locks

- Members read the catalog and send requests. Only admins change it.
- A write that changes more than one row takes `lockCatalog` from `apps/api/src/lib/locks.ts` before it locks a row.
- When a series moves from one group to a different group on the map, the api locks the two groups.

### Images

- The api validates the content of each upload, resizes it with sharp, and keeps it as WebP. This removes metadata such as the EXIF location.
- The files are on a volume, behind the `ImageStorage` interface in `apps/api/src/lib/image-storage.ts`.
- The api removes files only after the transaction commits. If the removal fails, the api logs the storage key and the file stays on the volume.
- An image URL always shows the same content, so the browser keeps the image for one week.

### Database

- Each schema change has a migration file (SQL and `meta/` changes) in `apps/api/drizzle/`.
- The api never applies migrations when it starts. A separate step applies them.

## Deployment

- `Containerfile` builds the two images. `api` runs Node. `web` is nginx with the built static files.
- `infra/compose.dev.yaml` has only Postgres and Mailpit, for local development.
- `infra/compose.yaml` runs the full site: proxy, web, api, a migration step, Postgres and Mailpit.
- `infra/helm/osusume` is the chart for minikube. An init container applies the migrations before the api starts. The api uses real SMTP.

The procedures are in [development.md](development.md).
