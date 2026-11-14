---
name: setup-pstack
description: Configure the Botlake seat and reasoning effort pstack uses per role, then write the project's role table. Use for /setup-pstack, "configure pstack models", "pstack budget", or changing pstack's agent choices.
---

# Setup pstack

Write `.botlake/pstack-roles.md`, the project's pstack role table. Every pstack skill reads it before it starts an agent run. It is a project-local document, not lake configuration: seats come from the lake's catalog, and each run passes `--seat` and an optional `--effort`.

Read [`../poteto-mode/references/botlake-tools.md`](../poteto-mode/references/botlake-tools.md) first. It owns the seat and run mechanics this skill configures.

## Steps

### 1. Detect available seats

Run `bl agent catalog`. That is the dependable source. It lists each available seat with its provider, model, effort, and purpose. `bl agent catalog SEAT` explains one seat's candidates and selection reasons. If the command fails or lists no seats, stop and report the lake error rather than writing a table with invented seats.

### 2. Load current state

The preferred `large` role table is the shape shown in step 5. It is valid for the catalog used to author this port, but the live catalog still wins. If `.botlake/pstack-roles.md` already exists, read it and treat its `# budget` line and role values as the current choices. Otherwise start from the preferred table, then mark every absent seat or mismatched effort for replacement before writing. A line whose role is not in step 5, such as `how critics`, is from a retired role. Drop it.

### 3. Budget, map, and confirm

**(a) Ask for a budget.** Prefer a plain numbered question in chat over free text. Offer these four options with these exact labels, and name the current budget when the table records one. With no table, say that `large` matches the skill defaults.

- `unlimited — max reasoning`
- `large — xhigh reasoning`
- `medium — high reasoning`
- `small — medium reasoning`

**(b) Apply it.** Build the working table from the preferred defaults, and on a re-run keep any role the user changed. Treat `unlimited`, `large`, `medium`, and `small` as maximum configured effort bands of `max`, `xhigh`, `high`, and `medium`. Use the exact configured effort reported by `bl agent catalog SEAT`; the catalog does not promise that arbitrary lower overrides are supported. If a seat is above the chosen band, propose another catalog-listed seat whose purpose fits the role and whose configured effort is within the band. When no such seat is clear, mark the role as needing a choice. Never change a seat's purpose merely to force the budget. Botlake runs always start from a seat, so the table names a catalog-listed seat for every role. There is no parent-model alias and no model slug to write.

**(c) Show the roles and confirm.** Show every role with its seat and configured effort, marking any absent seat, effort mismatch, or budget mismatch as needing a choice. Also list each line step 2 dropped. Ask whether to accept as-is or change specific roles, offering only the live catalog's seats. For panel roles (arena runners, architect runners, interrogate reviewers) the value is a list, and one run starts per entry, so the list length sets the count. `arena cross-judge pool` is also a list, but Arena starts one judge. It tries entries in list order and prefers a different model family when the catalog exposes that distinction, so order it by preference. `swarm workers` is the default seat for every worker unless a race or comparison assigns another catalog-listed seat per arm.

### 4. Validate

Every seat written must appear in `bl agent catalog`, and every parenthesized effort must equal the configured effort the expanded seat reports. If either check fails, stop and ask again. Do not write a seat name or effort from memory, and do not derive either from a model slug.

### 5. Write the table

Write `.botlake/pstack-roles.md`, overwriting the whole file so re-runs stay idempotent. Write the comment lines and one role line each, exactly in this shape:

```text
# pstack roles. One line per role: seat, then an optional effort in parentheses.
# Seats come from `bl agent catalog`; each run passes --seat and --effort.
# Delete a line to force a live catalog lookup by role purpose.
# budget: large (xhigh)
```

Then one line per role, copied from this list:

- `feature, refactoring: luna (xhigh)`
- `bug-fix: sol (low)`
- `perf-issue: sol (low)`
- `hillclimb: sol (low)`
- `judgment and prose: oracle (high)`
- `hardest tasks: oracle (high)`
- `how explorer: luna (xhigh)`
- `how explainer: oracle (high)`
- `why investigators: luna (xhigh)`
- `why synthesizer: oracle (high)`
- `reflect tooling: luna (xhigh)`
- `reflect judgment, divergent, synthesizer: oracle (high)`
- `arena runners: oracle (high), sol (low)`
- `arena cross-judge pool: sol (low), oracle (high)`
- `swarm workers: luna (xhigh)`
- `architect runners: oracle (high), sol (low)`
- `interrogate reviewers: oracle (high), sol (low)`
- `verification: terra (high)`

### 6. Confirm

Tell the user the table was written, that it applies to new agent runs, and that re-running this skill updates it. Name the chosen seats and configured efforts. There are no unresolved roles after step 4.

### 7. Offer a verification skill (optional)

Check whether the project has a way to drive the real app for proof (a `verify-*` skill under `.agents/skills/`, or an existing harness). If not, offer once: "want a project-local verification skill, so agents can drive the app the way a user does and prove changes work? I can generate one with /create-verification-skill." On yes, invoke `/create-verification-skill` (resolves wherever pstack is installed). On no, move on without pushing.

### 8. Offer a formal verification skill (optional)

Check whether the project already has a formal verification skill (a project skill that runs a model checker, a proof, or another verifier against the code). If not, offer once: "want a formal verification skill, so agents can prove a key property of your code holds in every case in scope, not only the cases tests reach? I can generate one with /create-formal-verification-skill." On yes, invoke `/create-formal-verification-skill` (resolves wherever pstack is installed). On no, move on without pushing.
