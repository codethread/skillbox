---
name: pstack-migration
description: Adapt or review this repository's PSTACK patches for CT-configured Botlake agents while preserving upstream workflows and minimizing the diff.
---

# Maintain the local PSTACK adaptation

The audience is agents running with this lake's CT configuration. Preserve PSTACK's engineering intent and voice; change the assumptions that prevent those agents from using it. This policy belongs to the local bundle. Each changed file still needs its own specific intent in the patch pack.

## Establish the audience

Read [the CT context evidence](references/ct-context.md) before the first review, and recheck it when the lake configuration changes. Distinguish instructions already supplied to agents from guidance available on demand. The agent's existing task, delegation, and tool-discovery instructions remain the authority for mechanics.

Load `skillbox skills get skillbox-patch` for capture mechanics and its update reference when changing the source revision. In this checkout, run the CLI with `bun run src/cli.ts`. Keep this skill focused on adaptation decisions.

## Make the smallest useful adaptation

Compare the pinned pristine source with the edited candidate, not just the previous port. For each difference, identify the Cursor dependency or concrete conflict it resolves. Restore upstream text when that reason no longer exists.

- Preserve the workflow's purpose, evidence requirements, role distinctions, write scopes, and completion criteria. Retain its prose and structure where they work unchanged.
- Prefer ordinary concepts: a task list, a delegated agent, an independent reviewer, a worktree. For example, removing the Cursor tool name from a task-list instruction is usually enough; CT context already routes task tracking to Work.
- Add runtime detail only when ordinary language leaves a consequential ambiguity. A distinction between an active wait and persistent scheduling may matter; a copied command catalog does not.
- Let the configured agent catalog and existing instructions supply model selection and lifecycle mechanics. Preserve a requirement for independent or diverse judgment without maintaining a second roster or configuration system.
- Keep the useful supporting scripts, references, and attribution. Adapt or remove a resource only when its actual assumptions conflict with the audience, and repair its callers. Copied upstream documents need a traceable origin because a clean replay cannot detect drift in their originals.
- Route skill authoring through the project's available guidance. Skillbox's own guidance is retrieved through `skills get`; it is not automatically an installed workspace skill.

Use `writing-for-agents` and `agent-docs-hotpath` when available to review our added instructions. Apply them to the adaptation, without turning this task into a rewrite of upstream PSTACK style.

## Review and record

1. Edit the prepared skill tree through the patch workflow. Keep unrelated skills unchanged and leave generated installations to sync.
2. Review entry points with the references and scripts they call. Remove obsolete commands, broken links, and contradictory policy. A grep result is a lead, not proof that a mention of Cursor or another tool needs deleting; provenance and historical examples can remain.
3. Capture through the product CLI and update file intent to explain the remaining adaptation's reason and required outcome. Keep intent accurate as edits accumulate; capture preserves notes rather than interpreting them. Use Git for selection, history, and reverts.
4. Have a fresh agent review the combined bundle against the pristine source and this audience. Exercise representative changed workflows or bounded read-only decisions, and run affected helper checks. Reproducible installation alone does not prove the instructions work.
5. Sync and inspect the installed skills and supporting resources. Commit the local policy, file intents, source lock, and concrete diffs together with any required tracking changes.

Done means every retained difference has a concrete adaptation reason, PSTACK's intended workflow survives, callers agree with their resources, and the combined bundle works with CT context without repeating its operating manual.
