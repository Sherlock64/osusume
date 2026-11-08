---
name: api-route
description: Add or change an Osusume api route in apps/api with its Zod schema, auth middleware, error codes, cache headers and tests on a scratch database. Use for any backend endpoint work.
---

# Add or change an api route

Read `docs/architecture.md`, section "Rules that the code keeps", first.

1. **Schema.** Put the request and answer schemas in `packages/shared/src/<area>.ts`, so the web app can use them. Export them from `packages/shared/src/index.ts`.
2. **Route.** Add the route to the file for its area in `apps/api/src/routes/`. Follow the other routes in that file:
   - Put `requireSession` or `requireAdmin` first. Then read `c.var.currentUser`.
   - Validate input with `valid('json' | 'param' | 'query', schema)`.
   - For an error, throw an `ApiError` with a stable code in snake case.
   - Use `canView` from `apps/api/src/social/lists.ts` for each list or map visibility check. Do not write a second check.
   - A write that changes many catalog rows takes `lockCatalog` before it locks a row.
3. **New area only.** Mount the router in `apps/api/src/app.ts`. The web app gets the type through `AppType`.
4. **Tests.** Add tests to `<area>.test.ts` next to the route. Use `createMigratedDatabase` from `test-support/`. Test the refusals too: no login, wrong user, bad input. For a race, use `Promise.all` and assert the result.
5. **Web app.** Call the route through `api` in `apps/web/src/lib/api.ts`. TypeScript checks the call.
6. Run `pnpm --filter @osusume/api test <area>`, then all the checks.

Do not add OpenAPI generation or response-timing defenses. The owner removed them.
