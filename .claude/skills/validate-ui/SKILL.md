---
name: validate-ui
description: Take standard screenshots of Osusume pages in light and dark at desktop and phone width with one command, and read a short report of console errors, failed requests and overflow. Use after any UI change instead of writing a new Playwright script.
---

# Validate the UI

`pnpm validate` replaces the browser scripts that each agent wrote before. It saves many tokens. Full details are in `docs/development.md`, section "Validation run".

1. Pick the site: local development `http://localhost:5173`, Compose `http://localhost:8090`, or minikube `http://localhost:8080`.
2. Get a login. Use `e2e/.results/validate-credentials.env` if it exists for that site. On a new install, give `VALIDATE_MAILPIT_URL` instead.
3. Run only the pages that your change affects. The words select pages by name:

   ```sh
   set -a; . e2e/.results/validate-credentials.env; set +a
   VALIDATE_BASE_URL=http://localhost:5173 pnpm validate constellations home
   ```

   Page names: `login`, `forgot-password`, `home`, `home-search`, `catalog`, `series`, `constellations`, `friends`, `compare`, `requests`, `requests-new`, `invites`, `settings`, `admin-catalog`, `admin-requests`, `admin-invites`, `admin-users`, `admin-tags`, `admin-username-changes`.

4. Read `e2e/.results/validate/report.txt`. Each `FAIL` line names the problem.
5. Open only the screenshots that you must see. Each file is `<page>-<theme>-<width>.png`. To use fewer tokens, look at one theme and one width first.

Note: each run empties `e2e/.results/validate/`, but it keeps `e2e/.results/validate-credentials.env`. That file is for one site only. For a different site, set `VALIDATE_USER` and `VALIDATE_PASSWORD` yourself.

## When `pnpm validate` is not sufficient

For drag, hover, right-click or keyboard focus, write a short Playwright script in your scratch folder. Copy the login part from `e2e/validate.ts`: log in one time with `request.newContext`, then give its `storageState` to `browser.newContext`. Load Playwright from the e2e package:

```js
import { createRequire } from 'node:module';
const { chromium, request } = createRequire(process.cwd() + '/e2e/package.json')('@playwright/test');
```

When you add a route to the web app, add it to `routes()` in `e2e/validate.ts`.
