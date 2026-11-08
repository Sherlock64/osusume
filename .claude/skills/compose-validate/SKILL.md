---
name: compose-validate
description: Build the Osusume production images and run the full site with Podman Compose to prove that the build, migrations, proxy and api work together. Use before a review or before a minikube deploy.
---

# Build validation with Podman Compose

This proves that the real images build and work together. It does not replace the owner's check on minikube.

1. One time only, make the secrets:

   ```sh
   infra/init-compose-env.sh
   ```

2. Build and start. Run it in the background, because the build takes some minutes:

   ```sh
   podman compose -f infra/compose.yaml up -d --build
   ```

3. Wait until the site answers:

   ```sh
   until curl -fs -o /dev/null http://localhost:8090/api/v1/health/ready; do sleep 2; done
   ```

4. Check the site:

   - On a new install: `VALIDATE_BASE_URL=http://localhost:8090 VALIDATE_MAILPIT_URL=http://localhost:8026 pnpm validate`
   - With an account: set `VALIDATE_USER` and `VALIDATE_PASSWORD` from a credentials file, then `VALIDATE_BASE_URL=http://localhost:8090 pnpm validate`
   - For the real flows, also run the smoke tests: `SMOKE_BASE_URL=http://localhost:8090 SMOKE_MAILPIT_URL=http://localhost:8026 pnpm smoke`

5. Read `e2e/.results/validate/report.txt`. Open only the screenshots that you need.

## If it fails

- Build error: read the output of step 2. The usual cause is a type error that `pnpm build` also shows.
- The api does not start: `podman compose -f infra/compose.yaml logs api migrate`.
- Email: Mailpit is at http://localhost:8026.

The proxy replaces `X-Forwarded-For`, so all clients share one login rate limit. If you get "Too many attempts", restart the api: `podman compose -f infra/compose.yaml restart api`.

`down` keeps the data. `down -v` deletes it. Do not run `down -v` if other agents or the owner use the accounts on this install.
