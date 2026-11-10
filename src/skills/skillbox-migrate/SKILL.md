---
name: skillbox-migrate
description: Manually migrate existing repository-local skills into a Skillbox source bundle, or resolve MIGRATION_REQUIRED during first add.
---

# Migrate existing local skills

This is a manual cutover, not a `skillbox migrate` command. Keep global installations outside scope unless separately authorized. Use `skillbox skills get skillbox-author` for bundle conventions and `skillbox skills get skillbox-configure` for add/sync diagnostics.

1. Inspect `.agents/skills`, `.claude/skills` (including dangling symlinks), Git status/tracking, `skillbox/config.json`, and `skillbox/lock.json`. If either tracking file exists, stop this first-install procedure and diagnose the managed installation instead; retain both files and any separate root `skills-lock.json`.
2. Agree on the owned source repository and bundle, then back up every existing skill/resource and the Claude directory or link outside the installation paths. Record file hashes, executable permissions, and symlink targets. Reconcile differing copies or duplicate names explicitly. Preserve unrelated edits and application-owned files.
3. Copy the approved skills into `<source-repo>/skillbox/<bundle>/<skill-name>/`, preserving frontmatter, supporting files, and permissions. Sources must contain real files/directories, not symlinks. Review relative links and helper scripts that depend on directory depth or checkout paths; make only the required, agreed path fixes.
4. Before cutover, create an empty disposable client and run `skillbox --workspace <client-dir> add <absolute-source-repo> <bundle>`. Require `success: true`, the expected skill count, matching installed files/permissions, and `.claude/skills -> ../.agents/skills`. Remove only that client's generated skills directory and Claude link, then run `skillbox --workspace <client-dir> sync` twice: restore first, unchanged second. Keep its config and lock throughout. Remove the client after verification.
5. Move the original `.agents/skills` directory out of the workspace. Unlink `.claude/skills` only if it is a symlink; move a real directory to backup instead. **Both paths must be absent for first add**: even an empty skills directory or an already-correct Claude link causes `MIGRATION_REQUIRED`. From the consuming workspace, add the verified source and bundle. For a source bundle in that same repository:

    ```sh
    skillbox add . local
    ```

    Here `local` is the bundle name. For another source repository, pass its absolute root path instead of `.`. On failure, inspect the structured error and any retained recovery directory; preserve backups and partial output before deciding how to restore. Do not overwrite newly published state blindly.

6. Verify every installed skill/resource and executable permission against the approved source, the Claude link, and the new config/lock selections. In the workspace's `.gitignore`, ignore `/.agents/skills/` and `/.claude/skills` (no trailing slash on the symlink rule). For each generated path still tracked by Git, use `git rm -r --cached -- <path>` to untrack it without deleting the installation. Stage the source bundle, config, lock, ignore rules, and removal of old tracked copies together. Run sync again and require unchanged; check unrelated files against the backup before removing it.

Report the migrated names, verification results, and any untested harness discovery or helper behavior. Edit owned sources afterward, not generated installations; source updates need an agreed process because repeated add is a no-op and sync rejects hash drift.
