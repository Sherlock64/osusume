# Development environment

This document tells you how to set up your computer, how to run Osusume, and how to check a change.

## Three environments

Use the correct environment for each step. Each environment is slower than the one before it, but it is more similar to the real site.

| Environment | Use it to | Speed | Address |
| --- | --- | --- | --- |
| Local development | Write code and see the change immediately | Seconds | http://localhost:5173 |
| Podman Compose | Make sure that the container images build and run together | Minutes | http://localhost:8090 |
| minikube | Let the owner review the change on a real cluster before the merge | Minutes | http://localhost:8080 |

Do most of the work in local development. Use Podman Compose before you ask for a review. Use minikube only when the owner must examine the change.

## Tools

Install these tools:

- **Node 26.** The version is in `.nvmrc`. With nvm, run `nvm use`.
- **pnpm.** The version is in the `packageManager` field of `package.json`. Run `corepack enable` to get the correct version.
- **Podman**, and a compose provider for `podman compose` (for example `podman-compose`).
- **For minikube only:** minikube, kubectl and Helm.

## Local development

### First time

1. Install the dependencies:

   ```sh
   pnpm install
   ```

2. Make your environment file. The values in it agree with `infra/compose.dev.yaml`.

   ```sh
   cp .env.example .env
   ```

3. Start Postgres and Mailpit in containers:

   ```sh
   pnpm dev:services
   ```

   Postgres listens on 127.0.0.1:54329. Mailpit gets email on 127.0.0.1:1025 and shows it at http://localhost:8025.

4. Apply the database migrations:

   ```sh
   pnpm db:migrate
   ```

### Each day

Start the api and the web app in two terminals:

```sh
pnpm dev:api    # http://localhost:3000/api/v1/health
pnpm dev:web    # http://localhost:5173
```

Both restart or reload when you save a file. The web app sends `/api/*` to the api, so the browser sees one address.

On a new database, open http://localhost:5173/setup and make the first admin. Find the setup link in Mailpit.

To stop the containers, run `pnpm dev:services:down`. The data stays in a volume.

### Other ports

`PUBLIC_BASE_URL` in `.env` must be the address that the browser uses. If it is different, Better Auth refuses the login, and the links in emails go to the wrong address.

To use other ports, run:

```sh
PORT=3460 PUBLIC_BASE_URL=http://localhost:5180 pnpm dev:api
API_PROXY_TARGET=http://localhost:3460 pnpm dev:web --port 5180
```

### Without a compose provider

If `podman compose` does not work, start the same containers directly:

```sh
podman run -d --name osusume-dev-pg -p 127.0.0.1:54329:5432 \
  -e POSTGRES_USER=osusume -e POSTGRES_PASSWORD=osusume_dev -e POSTGRES_DB=osusume \
  -v osusume-dev-pg:/var/lib/postgresql docker.io/library/postgres:18-alpine
podman run -d --name osusume-dev-mailpit -p 127.0.0.1:1025:1025 -p 127.0.0.1:8025:8025 \
  docker.io/axllent/mailpit:v1.33
```

## Database changes

1. Change `apps/api/src/db/schema.ts`.
2. Make the migration file:

   ```sh
   pnpm db:generate
   ```

3. Commit the new SQL file and the `meta/` changes in `apps/api/drizzle/`.
4. Apply it with `pnpm db:migrate`.

The api never applies migrations when it starts. In a built image, the migration command is `node apps/api/dist/db/migrate.js`. Compose and Helm run it before the api starts.

## Checks

Run all four checks before you commit:

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

There is no CI. These local checks are the only checks.

`pnpm test` needs the local development Postgres and Mailpit. Each database test makes its own scratch database and deletes it after the test. To use a different Postgres server, set `TEST_DATABASE_URL`. Its role must have permission to make databases. Account tests send email to Mailpit and read it back. To use a different Mailpit, set `TEST_SMTP_HOST`, `TEST_SMTP_PORT` and `TEST_MAILPIT_URL`.

## Validation run

The validation run takes screenshots of the main pages, in the light and dark themes, at 1440 px and 390 px width. It writes one short report. Read the report first. Then open only the screenshots that the report marks, or the pages that your change affects. This uses fewer tokens than an agent that writes its own browser script.

The first time, install the browser:

```sh
pnpm --filter @osusume/e2e exec playwright install chromium-headless-shell
```

Run it against a site that has an account:

```sh
VALIDATE_BASE_URL=http://localhost:8090 VALIDATE_USER=name VALIDATE_PASSWORD=secret pnpm validate
```

On a new install with an open setup, give the Mailpit address instead of a login. The script makes an admin, adds 12 series to the list and the map, and saves the login in `e2e/.results/validate-credentials.env`.

```sh
VALIDATE_BASE_URL=http://localhost:5173 VALIDATE_MAILPIT_URL=http://localhost:8025 pnpm validate
```

To take only some screenshots, add words. The script takes only the pages whose names contain one of the words:

```sh
pnpm validate constellations admin-
```

| Variable | Default | Meaning |
| --- | --- | --- |
| `VALIDATE_BASE_URL` | `http://localhost:5173` | The site to check. |
| `VALIDATE_USER`, `VALIDATE_PASSWORD` | none | The account to log in with. An admin account shows all pages. |
| `VALIDATE_MAILPIT_URL` | none | Mailpit for a new install. The script uses it only when setup is open. |
| `VALIDATE_THEMES` | `light,dark` | The themes, separated by commas. |
| `VALIDATE_WIDTHS` | `1440,390` | The widths in pixels. A width less than 768 is a phone with touch. |

The output is in `e2e/.results/validate/`:

- `report.txt`: one line for each screenshot. A line starts with `ok` or `FAIL`. A `FAIL` line tells you the problem: a console error, a response of 400 or more, a horizontal overflow, or a page that went to a different address.
- `<page>-<theme>-<width>.png`: the screenshots.

The command exits with code 1 if a line has a problem. On the owner's computer, a full run of 76 screenshots takes approximately 20 seconds.

The script logs in one time through the api. All pages then use that session. The pages are in `routes()` in `e2e/validate.ts`. Add a page there when you add a route.

## Smoke tests

The smoke tests in `e2e/smoke.spec.ts` are a small set of Playwright tests. They do a real flow: setup, login, and a series that they add and then delete.

```sh
SMOKE_BASE_URL=http://localhost:8090 SMOKE_MAILPIT_URL=http://localhost:8026 pnpm smoke
```

`SMOKE_BASE_URL` is `http://localhost:8080` by default. On a new install with `SMOKE_MAILPIT_URL`, the tests do first-run setup and make an admin. Do not use this on a site that you want to set up yourself. On a site that has an admin, set `SMOKE_ADMIN_USERNAME` and `SMOKE_ADMIN_PASSWORD`. Without these values, the tests that need a login do not run.

## Podman Compose

Use Podman Compose to make sure that the production images build and work together. It runs the proxy, web, api, Postgres, Mailpit and a migration step. All email goes to Mailpit.

1. Make the secrets one time. The script writes them to `infra/.env`.

   ```sh
   infra/init-compose-env.sh
   ```

2. Build and start:

   ```sh
   podman compose -f infra/compose.yaml up -d --build
   ```

3. Open http://localhost:8090/setup to make the first admin. Find the link in Mailpit at http://localhost:8026.

To use other ports, set `OSUSUME_PORT` and `MAILPIT_PORT` in `infra/.env`. Both ports listen only on 127.0.0.1. The proxy replaces the `X-Forwarded-For` header, so all users share one login rate limit.

The migration step runs on each `up`. `down` keeps the data. `down -v` deletes the data.

## minikube

Use minikube when the owner must review a change on a real cluster. This install sends real email.

### First time

1. Start minikube and enable the ingress addon:

   ```sh
   minikube start
   minikube addons enable ingress
   ```

2. Make the namespace and the SMTP Secret. The Secret has the keys `SMTP_USER` and `SMTP_PASSWORD`. Gmail needs an app password. This command reads the password from the terminal, so it does not go into the shell history:

   ```sh
   kubectl create namespace osusume
   kubectl -n osusume create secret generic osusume-smtp \
     --from-literal=SMTP_USER=you@example.com --from-file=SMTP_PASSWORD=/dev/stdin
   ```

   Type the password. Then press Ctrl+D two times. Do not press Enter, or the password gets a line break at the end. The terminal shows the password while you type, so make sure that nobody can see your screen.

3. Copy the local values file and set `smtp.from` in it:

   ```sh
   cp infra/helm/values.local.yaml.example infra/helm/values.local.yaml
   ```

The chart is in `infra/helm/osusume`. Its `values.yaml` has all the settings and notes.

### Each deployment

Each build needs a new tag. If the tag does not change, the Deployments do not change. `minikube image load` cannot find Podman images by name, so the images go through a file.

```sh
TAG=$(git rev-parse --short HEAD)-<topic><n>     # for example 9411672-search1
for target in api web; do
  podman build --target $target -t localhost/osusume-$target:$TAG -f Containerfile .
  podman save -o /tmp/osusume-$target.tar localhost/osusume-$target:$TAG
  minikube image load /tmp/osusume-$target.tar
  rm /tmp/osusume-$target.tar
done
helm upgrade --install osusume infra/helm/osusume -n osusume -f infra/helm/values.local.yaml \
  --set image.api.tag=$TAG --set image.web.tag=$TAG --wait --timeout 5m
```

Increase the number at the end of `TAG` when you build again from the same commit.

In a second terminal, start the port-forward. It continues to run until you stop it:

```sh
kubectl -n ingress-nginx port-forward svc/ingress-nginx-controller 8080:80
```

Then open http://localhost:8080. On a new install, open http://localhost:8080/setup to make the first admin. The site answers only at the address in `publicBaseUrl` and the host in `ingress.host`.

The api runs as one replica, because each process counts its rate limits separately. The chart makes `AUTH_SECRET` and the Postgres password on the first install. It uses them again on each upgrade. `helm uninstall` keeps them and the two volumes. To start again with no data, also delete the namespace.

## Problems

**Approximately one request in three stops and does not answer (minikube).** Look in the ingress controller log for `pthread_create() failed`. On a computer with many cores, ingress-nginx starts one worker for each core. Each worker has 33 threads. This can be more than the process limit of the pod. Set fewer workers:

```sh
kubectl -n ingress-nginx patch configmap ingress-nginx-controller --type merge \
  -p '{"data":{"worker-processes":"2"}}'
```

**"Too many attempts" on the login page.** The auth routes allow 3 logins in 10 seconds from one client address. A restart of the api clears the count. In local development, scripts can send a different `X-Forwarded-For` header for each call. The validation run does this.

**The api does not start.** The api validates each variable in `.env` when it starts. The error message names the incorrect variable.

**Login fails, or email links go to the wrong address.** `PUBLIC_BASE_URL` must be the address in the browser address bar.
