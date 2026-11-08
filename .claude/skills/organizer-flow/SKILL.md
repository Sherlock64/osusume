---
name: organizer-flow
description: Build an Osusume feature from a PRD as an organizer - interview the owner, write contracts, run developer sub-agents, validate against the PRD, run the UI council and deploy to minikube. Use when the owner asks for a new feature or version.
---

# Organizer flow

The organizer does not write most of the code. It plans, gives work to sub-agents, and checks the results.

## 1. Interview

Read the PRD and `PRD/V1_DECISIONS.md`. The `PRD/` folder is only on the owner's computer. Find the gaps. Ask the owner all the feature and scope questions in one message. Decide small technical questions yourself. Save the answers in `PRD/V1_DECISIONS.md`.

## 2. Contracts

Write the spec for the feature in `PRD/`, for example `PRD/V2_4_SEARCH.md`. For UI work, `docs/design-guide.md` is the visual contract.

Before the developers start, read each contract again:

- Each callback and api answer carries all the data that its caller needs.
- Write each rule as an invariant with a test, for example "no two series ever overlap". Then a fallback cannot break the rule.

## 3. Developers

- Give one problem to one agent, also if the problem touches many files.
- Two agents must not change the same file at the same time.
- Put the contract excerpt in the prompt. Do not tell the agent to read a long document for one paragraph.
- Each agent uses `local-dev` and runs the checks before it reports.
- Make one commit for each task, on the feature branch.

## 4. Validation

1. A PRD validation agent compares the result with the spec and lists the gaps.
2. Run `compose-validate`.
3. For visible changes, run `ui-council`. The pass rule is 5 of 5.

## 5. Owner review

Deploy with `minikube-deploy`. Open a draft pull request. Tell the owner the tag and what to look at. Do not merge.

## Token budget

- The owner's Claude plan has a 5-hour limit and a weekly limit. Look at the usage before each phase. If the 5-hour or weekly limit is near, stop at the end of a phase and wait.
- Send one status message for each phase, not one for each agent.
- Use `pnpm validate` before custom browser scripts.
- In council round 2 and later, review only the open items and regressions.
