---
name: skillbox-patch
description: Customize composed Skillbox bundles with per-file patches and intent, then review and capture explicit upstream updates.
---

# Customize composed bundles

Use this workflow to change imported instructions without editing generated installations or losing upstream provenance. It works on the destination bundle composed from all its contributions. Use command `--help` for syntax and inspect each JSON result before continuing.

Source registration belongs to `add skills` or `add skillbox`. For source selection or personal setup, load `skillbox skills get skillbox-configure`. An unchanged import has config and a matching lock, but no patch directory.

Check the active config before preparing or capturing. `skillbox/config.local.json` selects personal config when present; otherwise `skillbox/config.json` is active. Mutators report that path. Personal commands use `lock.local.json`, `patches.local/`, and `.prepare.local/` under `skillbox/`, leaving shared state unchanged.

## Prepare an edit

```sh
skillbox patch prepare <id>
```

Record the returned `workspace` and `editable` paths. Shared preparation uses `skillbox/.prepare/<id>/edit/`; personal preparation uses `skillbox/.prepare.local/<id>/edit/`. `--output <directory>` chooses another workspace. Capture with the same config active as when you prepared it.

- Edit distributed skill files under `<workspace>/edited/skills/<original-directory>/`.
- Do not edit `<workspace>/pristine/` or `manifest.json`; these are CLI-managed preparation state.
- Preparation preserves original skill directory names, which can differ from frontmatter names. Selectors and installed names use frontmatter names; a capture `--skill` filter uses the original directory.
- Ignore both preparation directories. Capture wanted edits before deleting or recreating a workspace.
- Treat `.agents/skills/` and `.claude/skills` as generated installations.

The pristine baseline is the composed output before this workspace's patches. For a producer contribution, it already includes producer-owned adaptations. Do not copy producer patch payloads or intent into your own patch files.

Use Git to review, select, revert, and reorganize your repository changes. Skillbox prepares editable content, captures diffs, and reproduces them through sync; do not invent parallel patch-management commands.

## Capture and explain

```sh
skillbox patch capture <id> --from <workspace>
```

Capture records per-file diffs and verifies replay; it does not install skills. Ordinary subsequent captures append ordered changes, including deliberate reverts. Existing file intent is preserved; newly targeted files need a reason in the reported `patch.toml` files under the active patch directory:

```toml
schema = 1

[files."./references/tools.md"]
intent = "Explain why, the required outcome, and constraints."

[[patches]]
target = "./references/tools.md"
patch = "changes/0001-captured.patch"
```

Use the result's `pendingIntents` and `intentFiles` to find missing annotations. For each changed file explain:

- **Why:** which upstream assumption requires the change.
- **Outcome:** the behavior the file must retain.
- **Constraints:** policy, compatibility, or scope future regeneration must preserve.

Intent belongs to the file, independently of its ordered patches. Capture does not infer or rewrite the reason as later edits change that file. Review its continuing accuracy. An optional collection-wide explanation in existing repository prose can give context, but cannot replace file intent or introduce a new metadata schema.

Keep the existing per-skill `patch.toml` and `changes/` format. The active config's lock owns source pins and flattened provenance.

## Sync and commit

After every required intent is nonblank, run `skillbox sync`. Sync replays recorded patches; it does not ask an agent to reinterpret the intent each time. Missing intent blocks sync/export.

For shared changes, commit config, lock, authored sources, and per-skill patch metadata and payloads. Keep personal config, lock, and patches private. Never commit fetched upstream copies, preparation workspaces, or generated installations. Producer changes remain producer-owned; a consumer records only its additional changes against the pinned producer output.

## Review updates

```sh
skillbox update <id>
```

Update stages a candidate for the composed bundle without accepting its pins or installing it. Review upstream changes and every affected intent, edit the candidate, then capture it to accept the reviewed pins. Sync installs the result. A clean textual replay alone is not approval.

For a producer contribution, update adopts the producer's output and locked dependencies, not independently newer versions of those dependencies. Git sources stay pinned during ordinary sync; local filesystem sources are live worktrees.

Before updating, load:

```sh
skillbox skills file skillbox-patch references/updating.md
```
