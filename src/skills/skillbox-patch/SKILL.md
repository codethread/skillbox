---
name: skillbox-patch
description: Import and maintain an adapted Skillbox bundle with pinned upstream source, editable workspaces, per-file diffs, and explicit patch intent.
---

# Maintain adapted bundles

Adapt an upstream Git skills subtree without editing generated installations. Use command `--help` for syntax and inspect every JSON result before continuing.

Keep the patch command surface deliberately minimal. Use Git and worktrees to review, select, revert, and reorganize changes before committing. Do not introduce parallel patch-management commands such as `apply`, `rollback`, `adjust`, or `pick`; Git owns that history and selection workflow. Skillbox prepares editable source, records diffs, and reproduces the recorded bundle through sync.

## Start or reopen an edit

For a new bundle, run `skillbox patch init <bundle> ...`. Init pins and registers the source, then creates an editing workspace; it does not install skills. `--output` is optional and defaults to `.skillbox-prepare-<bundle>`. Record `data.workspace` and `data.editable` from the result.

For an existing bundle, run `skillbox patch prepare <bundle>`. It recreates the workspace from the recorded bundle, including a draft captured earlier. The same optional output default applies.

Paths have distinct ownership:

- Edit only `<workspace>/edited/<skills-root>/**` (`skills/` by default).
- Keep `<workspace>/pristine/` and its manifest as CLI-managed preparation state.
- Commit `skillbox/config.json`, `skillbox/lock.json`, and `skillbox/patches/<bundle>/`.
- Treat `.agents/skills/` and `.claude/skills` as generated installation output.

## Capture and annotate

Run `skillbox patch capture <bundle> --from <workspace>`. Capture appends incremental per-file diffs against the last captured output, verifies strict replay, writes the bundle pack, and refreshes the workspace manifest atomically. A later edit or deliberate revert adds another ordered patch rather than rewriting earlier artifacts. Capture never installs skills.

Intent belongs to the file, independently of its ordered patch records. Capture preserves a manually edited file intent and gives a newly targeted file a blank one in `skillbox/patches/<bundle>/<skill>/patch.toml`:

```toml
schema = 1

[files."./references/tools.md"]
intent = "Explain why, the required outcome, and constraints."

[[patches]]
target = "./references/tools.md"
patch = "changes/0001-captured.patch"
```

The bundle's `lock.json` pins the upstream revision. File records hold intent; ordered patch records contain only the target and diff path.

Use the result's `pendingIntents` count and workspace-relative `intentFiles` paths to find manifests requiring annotation. For every blank intent, edit `patch.toml` directly and state:

- **Why:** the upstream behavior or runtime assumption that requires adaptation.
- **Outcome:** the behavior the adapted file must retain.
- **Constraints:** compatibility, policy, or scope that future regeneration must preserve.

Intent is explanatory: changing it does not invalidate the patch hash. Patch targets and paths, diff payloads, and the bundle's source identity remain integrity-protected.

The prepared workspace is reusable. After capture or manual intent annotation, make further edits in the same `edited/skills/` tree and capture again. Existing reasons remain attached and shared by every patch for that target; only new targets need annotation. The user owns the continuing accuracy of those notes as the file evolves—capture does not rewrite or guess intent.

## Install

Run `skillbox sync` only after every intent is nonblank. Otherwise sync returns `INTENT_REQUIRED` without changing the installation. A valid sync verifies the recorded bundle source and patches. Runtime capture has already verified that replay reproduces the edited tree. Sync still rejects native source content that differs from its locked hash.

## Update from upstream

An upstream update requires more than a successful patch replay. Compare the old and candidate pins in Git, read the upstream-authored changes, and judge the candidate against each file intent. Check broad changes, including new files, renames, deletions, scripts, executable modes, and runtime assumptions.

Before updating, run `skillbox skills file skillbox-patch references/updating.md`. The reference explains which Git revisions and trees to compare, how to review file intent, and how to capture the candidate and sync.
