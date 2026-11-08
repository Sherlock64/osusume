# Osusume: instructions for AI agents

Osusume is an anime watch tracker with friends, list compare and a "Constellations" recommendation map. It is a pnpm monorepo: `apps/api` (Hono, Drizzle, Better Auth), `apps/web` (React, TanStack, Tailwind, React Flow), `packages/shared` (Zod schemas), `e2e` (Playwright).

Read these documents when the task needs them:

- `docs/development.md`: setup, the three environments, checks, the validation run.
- `docs/architecture.md`: the parts, the data model and the rules that the code keeps.
- `docs/design-guide.md`: the tokens, components and layout rules for the web app. Obey it for each UI change.
- `CONTRIBUTING.md`: branches, commits, pull requests and the writing rules.
- `TODO.md`: open items from the most recent review.
- `PRD/`: product documents. Git ignores this folder, so it is only on the owner's computer. `PRD/V1_DECISIONS.md` has the owner's binding decisions.

## Rules

- **Scope.** Build only what the PRD or the owner asks for. Ask the owner about feature and scope questions. Put all questions in one message at the start. Decide small technical questions yourself and report them.
- **Small changes.** Use the code that exists. Do not add an abstraction, an option or a dependency that nobody asked for. The owner wants less code, not more.
- **No CI.** Do not add or propose CI pipelines. Run `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` on this computer.
- **"Push".** When the owner says "push" about the site, it can mean "deploy to minikube". Run `git push` only when the owner says "git push", or asks for a pull request.
- **Pull requests.** `gh pr edit` fails on this repository. Use `gh api -X PATCH repos/Sherlock64/osusume/pulls/<number>`.
- **Do not reintroduce** OpenAPI generation or response-timing defenses. The owner removed them.
- **Documents** use ASD-STE100 Simplified Technical English. The rules are in `CONTRIBUTING.md`.
- **Secrets.** Do not print passwords or tokens. Keep test logins in files in your scratch folder.

## Validation

Screenshots and browser checks use the most tokens in this project. Use the cheapest step that answers the question:

1. Unit tests and `pnpm typecheck` for logic.
2. `pnpm validate <page words>` for the look of pages. Read `e2e/.results/validate/report.txt` first. Then open only the screenshots that you need.
3. A Playwright script of your own only for an interaction that `pnpm validate` does not do (drag, hover, keyboard). Use the login from `validate.ts`: log in one time through the api and reuse the `storageState`.

## Skills

The project skills are in `.claude/skills/`:

| Skill | Use it to |
| --- | --- |
| `local-dev` | Start the fast local environment and make a change. |
| `compose-validate` | Build the images and check the full site in Podman Compose. |
| `minikube-deploy` | Deploy to minikube so that the owner can review the change. |
| `validate-ui` | Take screenshots of pages and read the report. |
| `ui-council` | Get a five-member review of a UI change. |
| `organizer-flow` | Build a feature from a PRD with developer agents, review and deployment. |
| `api-route` | Add or change an api route, with its schema and tests. |
| `db-migration` | Change the database schema. |
| `write-docs` | Write or change a document in Simplified Technical English. |
