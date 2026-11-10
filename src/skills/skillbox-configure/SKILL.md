---
name: skillbox-configure
description: Configure repository-local Skillbox sources and bundles, select a workspace, restore installed skills, or diagnose add/sync failures.
---

# Configure Skillbox

Use `skillbox --help` and the selected command's `--help` for current syntax. All operational results are JSON with `success`, `data`, and `errors`; a nonzero exit means failure. Inspect structured errors before retrying.

For existing unmanaged skills or `MIGRATION_REQUIRED` during first add, use `skillbox skills get skillbox-migrate` before changing installation paths.

## Choose the operation

```text
START
  |
  v
[Adding a source or bundle?] -- yes --> skillbox add
  |
  no
  v
[Restoring skills or applying config edits?] -- yes --> skillbox sync
  |
  no
  v
Inspect config and errors before changing state
```

1. Select an existing workspace directory. `--workspace <dir>` defaults to the invocation directory; it selects a directory, not a config file. Separate workspaces have separate installations and tracking files.
2. Inspect `skillbox/config.json`, `skillbox/lock.json`, `.agents/skills/`, and `.claude/skills` in that workspace before modifying it. Preserve unmanaged skills and existing tracking files.
3. For a new source or bundle, use `skillbox --workspace <dir> add <source> [bundles...]`. Local paths are resolved from the invocation directory, even when selecting another workspace. Prefer a repository URL or GitHub shorthand with explicit bundle names. Reuse the exact configured Git source string to group additional bundles in the same entry. A GitHub tree URL ending in `skillbox/<bundle>` can imply the bundle, but is retained as supplied: different bundle URLs create separate source entries, even for the same repository and ref. Do not substitute a different Git ref merely to group entries; load the configuration reference before consolidating existing tree-URL entries.
4. To restore an installation or apply direct source/bundle edits in its config, use `skillbox --workspace <dir> sync`. It needs both tracking files, locks newly selected skills, and removes deselected managed skills and lock entries. Retained skill contents must match their saved hashes; this is not an update command. Config local paths resolve from the selected workspace root. An empty `sources` array removes all managed skills. Repeating an add with the same source string and already-configured bundles is a no-op, not a repair or update command.
5. Confirm `success: true` and inspect the reported status/counts. Check the installed `SKILL.md` and any required supporting files under `.agents/skills/`; `.claude/skills` should link to that directory. Add `/.agents/skills/` and `/.claude/skills` to the workspace's `.gitignore`; omit the trailing slash on the Claude rule to ignore the symlink itself. If either generated path is already tracked, untrack it with `git rm -r --cached -- <path>` without deleting the installation. Commit the config, Skillbox lock, ignore rules, and any removal of tracked generated paths together. The CLI does not configure ignores automatically.

For configuration fields, source examples, or a failed command, load:

```sh
skillbox skills file skillbox-configure references/configuration.md
```

Treat managed installed files as generated output: sync can replace edits within managed skill directories. Change an owned source instead. Immutable revision replay, shared/offline caching, explicit updates, automatic migration, and intent-backed patches are not implemented; do not invent commands or promise those guarantees.
