# Contributing

Osusume has one owner and developer. AI agents do a large part of the work. These rules apply to people and to agents.

## Before you start

1. Read [docs/development.md](docs/development.md) and set up your computer.
2. Read [docs/architecture.md](docs/architecture.md) before you change the api or the database.
3. Read [docs/design-guide.md](docs/design-guide.md) before you change the web app.

Do not add a feature that the product documents do not ask for. If a requirement is not clear, ask the owner. Make small technical decisions yourself, and write them in the pull request.

## Branches

- `main` is the released code.
- Make one branch for each feature, from `main`. Use the name `feat/v<major>-<number>-<topic>`, for example `feat/v2-4-search`.
- Use `fix/<topic>` for a fix that is not part of a feature.

## Commits

- Make one commit for each task or fix. Do not mix two tasks in one commit.
- Use the Conventional Commits form: `<type>(<scope>): <summary>`.
  - Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`.
  - Scopes: `api`, `web`, `shared`, `e2e`, `infra`. If the commit changes many parts, do not write a scope.
- Write the summary in the present tense, in lower case, without a full stop. Example: `fix(api): lock both groups when a series moves between groups`.
- A schema change and its migration file go in the same commit.

## Checks

There is no CI. Run these checks on your computer before each commit:

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

For a change to the web app, also do a validation run of the pages that you changed (see [Validation run](docs/development.md#validation-run)).

Add a test for new logic. Put the test file next to the source file: `name.ts` and `name.test.ts`.

## Pull requests

1. Push the branch with `git push -u origin <branch>`.
2. Open a draft pull request to `main`. Tell what changed, why, and how you checked it. Give the minikube image tag if there is one.
3. The owner reviews the change on minikube. Then the owner marks the pull request as ready and merges it.

`gh pr edit` does not work on this repository. To change the title or the description of a pull request, use the API:

```sh
gh api -X PATCH repos/Sherlock64/osusume/pulls/<number> -f body="$(cat body.md)"
```

## Writing rules for documents

Write all documents in ASD-STE100 Simplified Technical English. Readers whose first language is not English must understand each sentence the first time that they read it.

- Write short sentences. A sentence in a procedure has 20 words or less. A sentence in a description has 25 words or less.
- Write one instruction in each sentence. Use the imperative: "Run the checks." Not: "The checks should be run."
- Use the active voice. Say who or what does the action.
- Use one word for one meaning. Do not use synonyms for the same thing. For example, always write "series", not sometimes "show".
- Use "do not", not "don't". Do not use other contractions.
- Write steps as a numbered list. Write a warning before the step that it applies to.
- Use simple words: "use", not "utilize". "Start", not "kick off". "Make", not "spin up".
- Write commands, file names, variables and code in `code` format.
- Do not put a paragraph of more than six sentences in a document.

Comments in code are short. They tell why, not what.
