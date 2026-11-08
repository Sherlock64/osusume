# Osusume

Osusume (オススメ, "recommendation") is an anime watch tracker. You keep a list of the anime that you watch. You compare your list with the lists of your friends. On the Constellations page, you put your series on a map and draw lines between them. A line shows that two series go together, or that they do not go together.

Osusume is a small, private site. An admin invites each member. Everything runs on one server or on one small Kubernetes cluster.

## Features

- **My List**: add the seasons that you watch, set a status and a star rating, and search your list.
- **Catalog**: the series and seasons that the site knows. Members read it and send requests. Admins change it.
- **Friends and compare**: send friend requests and compare the lists of two or more people.
- **Constellations**: a map of your series, with lines and named groups. Other people can look at your map, but they cannot change it.
- **Public list**: you can share a read-only link to your list.
- **Admin pages**: invites, catalog requests, users, tags and username changes.

## Quick start

You need Node 26, pnpm and Podman. Read [docs/development.md](docs/development.md) for the full procedure.

```sh
pnpm install
cp .env.example .env
pnpm dev:services
pnpm db:migrate
pnpm dev:api
pnpm dev:web
```

Then open http://localhost:5173/setup to make the first admin. The setup email is in Mailpit at http://localhost:8025.

## Documentation

| Document | Contents |
| --- | --- |
| [docs/development.md](docs/development.md) | Set up your computer. Run the site in the three environments. Run the checks and the validation run. |
| [docs/architecture.md](docs/architecture.md) | How the parts of the project connect. The data model and the rules that the code keeps. |
| [docs/design-guide.md](docs/design-guide.md) | The "star atlas" look. The tokens, components and layout rules for the web app. |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Branches, commits, checks, pull requests and the writing rules for documents. |
| [CLAUDE.md](CLAUDE.md) | Instructions for AI agents. The project skills are in `.claude/skills/`. |
| [TODO.md](TODO.md) | Open items from the most recent review. |

## Technology

- **API**: Node 26, Hono, Better Auth, Drizzle ORM, PostgreSQL 18, sharp, nodemailer.
- **Web app**: React 19, Vite, TanStack Router and Query, Tailwind CSS 4, shadcn/ui (Radix), React Flow.
- **Shared code**: `packages/shared` holds the Zod schemas and the types that the API and the web app both use.
- **Deployment**: one container image file (`Containerfile`), Podman Compose, and a Helm chart for minikube.

## Known issues in v1

None of these issues stop the site for all users. They stay here until a later session fixes them.

Deployment:

- If you delete the `osusume` namespace, you delete the data permanently. The volumes use the `Delete` reclaim policy. `helm uninstall` keeps the data.
- The ingress addon starts 12 nginx workers by default. On the owner's computer, this is more than the pod process limit, and requests stop. The fix is `worker-processes: "2"` in the `ingress-nginx-controller` ConfigMap. If you enable the addon again, it can reset this value.
- The image tag comes from the commit hash. If you build again without a new commit, the old pods continue to run.
- `pnpm smoke` uses port 8080 by default, which is the real install. It can use all of the login attempts in the rate limit. A restart of the api clears the limit.
- All users that come through the port-forward share one login rate-limit bucket.
- You cannot change the volume sizes after the install.
- Postgres starts as root. No container sets a seccomp profile or a read-only root filesystem.
- Upgrades use the Recreate strategy. Expect short 503 errors during an upgrade.

Security, to review again before production:

- CSRF protection on `/api/v1` uses only `SameSite=Lax`. There is no Origin check.
- The setup page and the email-change page send their token when they open. A mail scanner that runs JavaScript can use a link before the user. A Confirm button would prevent this.
- Friend requests have no rate limit. A person can use them to find which usernames exist.
- `POST /api/auth/reset-password` gives a 500 error for a NUL byte in the token, because `/api/auth` is outside the `/api/v1` input check. It also does not get the default `Cache-Control`.
- The site uses plain HTTP. At that address, the session cookies are not `Secure`.

App:

- The limit of 10 invites per hour also applies to admins, and its message is not clear. If you invite a large group at one time, you get "Too many attempts".
- The login rate-limit message does not show the wait time.
- The largest possible catalog request can be more than the 1 MiB JSON body limit.
- Setup and invite pages for a link that is not valid have no link to other pages.
- A friend's list heading uses the letter case from the URL. For example, `/users/ben` shows "ben's list". "Friend request sent to" shows the letter case that you typed.
- After an email change, "Request completed" does not tell you to look in your inbox.
- A series detail page loads the full list of the user (`GET /me/list`) to find one series. A `GET /me/list/{seasonId}` endpoint or a series filter would prevent this.
- The web build gives a warning about a JavaScript chunk that is larger than 500 kB. It needs code splitting.
- A short search such as `a` finds too many matches, because the typo threshold is 0.35. The threshold was tested only on a catalog of approximately 40 series.

Not tested yet:

- Expired links, and an email-change link that you open when you are logged out.
- Email changes that the site refuses (the address is in use or on the blacklist).
- Moving a season to a different series, season covers, and image removal in the UI.
- Rejecting a username change in the admin page, and declining a friend request.
- Keyboard and screen-reader use, and browsers other than Chromium.
- A real `helm upgrade` or `helm uninstall` on the live install. Both were tested on a test install.
