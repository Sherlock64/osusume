---
name: ui-council
description: Run a five-member review council of sub-agents on an Osusume UI or UX change, with a pass rule, before a minikube deploy. Use after a feature with visible changes is built and passes its checks.
---

# UI review council

Five sub-agents each review the running site from one role. The owner set the pass rule: **all 5 must pass** before a deploy to minikube.

## Roles

| Role | Looks at |
| --- | --- |
| UI design | Obeys `docs/design-guide.md`. Spacing, alignment, the two themes, phone width. |
| User experience | The real task is quick and safe. Keyboard focus after each action. Screen-reader names. |
| Animations | Motion where it helps, smooth, and off with "reduce motion". The reviewer triggers it, not only stills. |
| Cleanliness | Visual order, density, no clutter, the same pattern in each place. |
| Code review | The diff: bugs, edge cases, contracts between components, tests. |

## Procedure

1. Start the site in Compose (`compose-validate`). Make one test account with data. Put the login in a file in your scratch folder. Do not put the password in a prompt.
2. Run `pnpm validate` one time and keep the shots. The council members read these shots first, so they do not each take the same screenshots.
3. Write the brief to a file in its own step. Then read the file back to make sure that it is complete. Do not join the brief to other commands with `&&`. In v2-4, a failed command before `&&` stopped the brief, and the council got an empty file.
4. Start the five agents in parallel. Give each agent its role, the brief file path, and the PRD excerpt that applies. Tell them:
   - Do not edit repository files or change git state.
   - Do not delete data that another member made.
   - Use YAGNI. Do not ask for features that the PRD does not have.
5. Collect the verdicts. Send the owner one message for the round, not one message for each member.

## Brief template

```text
You are the <ROLE> member of a 5-member review council for Osusume.
Judge with YAGNI in mind: do not ask for features beyond the PRD.
What changed: <list>. Diff: git diff origin/main...HEAD. Spec: <PRD file and section>.
Site: http://localhost:8090. Login: source <credentials file> (never print the password).
Screenshots already taken: <validate output folder>; report.txt lists problems.
For interactions, write a Playwright script in <scratch>/council-<role>/ (see the validate-ui skill).
Verdict rules: any suggestion means FAIL. PASS has no suggestions.
Reply format, nothing else:
VERDICT: PASS|FAIL
ROLE: <role>
SUGGESTIONS: (ranked, concrete, file or page, max 8)
EVIDENCE: <what you exercised, screenshot paths>
```

## Later rounds

- Give each member only its own round-1 items, and ask it to look for regressions.
- If a member passed and its area did not change, do not run it again.
- If round 2 fails, stop and ask the owner what to do. One possible answer: write the open items to `TODO.md` at the repository root, then deploy.
