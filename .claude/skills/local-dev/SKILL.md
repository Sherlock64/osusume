---
name: local-dev
description: Start the fast local Osusume environment (Vite and the api with live reload) and make code changes with quick feedback. Use for most coding work before any container build.
---

# Local development

Use this environment for most work. A saved file shows in the browser in seconds.

## Start

1. Find out if the stack runs already:

   ```sh
   curl -s -o /dev/null -w '%{http_code}\n' http://localhost:5173/ ; curl -s http://localhost:3000/api/v1/health
   ```

2. If it does not run, start the parts that are missing. Run each long command in the background:

   ```sh
   pnpm dev:services          # Postgres 127.0.0.1:54329, Mailpit http://localhost:8025
   pnpm db:migrate
   pnpm dev:api               # background
   pnpm dev:web               # background
   ```

3. If the database has no admin, use the validation run to set one up and add 12 series:

   ```sh
   VALIDATE_MAILPIT_URL=http://localhost:8025 pnpm validate login
   ```

   The login is then in `e2e/.results/validate-credentials.env`. Do not print the password.

## Another agent uses the same ports

Two agents must not share one dev stack if they change the same data. Start a second api and web on other ports, with the same Postgres:

```sh
PORT=3460 PUBLIC_BASE_URL=http://localhost:5180 pnpm dev:api
API_PROXY_TARGET=http://localhost:3460 pnpm dev:web --port 5180
```

## Make a change

1. Change the code. Obey `docs/design-guide.md` for UI and `docs/architecture.md` for the api.
2. Run the tests of the area that you changed, for example `pnpm --filter @osusume/web test canvas-layout`.
3. For UI, use the `validate-ui` skill on the pages that you changed.
4. Before the commit, run `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

Then use `compose-validate` before you ask for a review.
