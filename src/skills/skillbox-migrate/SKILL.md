---
name: skillbox-migrate
description: Move unmanaged repository-local skills into authored Skillbox bundles before the first managed installation.
---

# Migrate existing local skills

This is a manual cutover, not a `skillbox migrate` command. Keep global installations outside scope unless separately authorized. Use `skillbox skills get skillbox-author` for bundle conventions and `skillbox skills get skillbox-configure` for add/sync diagnostics.

1. Inspect `.agents/skills`, `.claude/skills` (including dangling symlinks), Git status/tracking, `skillbox/config.json`, and `skillbox/lock.json`. If either tracking file exists, stop this first-install procedure and diagnose the managed installation instead; retain both files and any separate root `skills-lock.json`.
2. Agree on the owned source repository and bundle, then back up every existing skill/resource and the Claude directory or link outside the installation paths. Record file hashes, executable permissions, and symlink targets. Reconcile differing copies or duplicate names explicitly. Preserve unrelated edits and application-owned files.
3. Copy approved locally owned skills into `<source-repo>/skillbox/<bundle>/<skill-name>/`, preserving frontmatter, supporting files, and permissions. For identifiable upstream skills, prefer `add skills` or `add skillbox` contributions with exact selectors rather than making an owned copy; preserve existing customizations through the prepare/capture workflow and per-file intent. Load `skillbox-patch` for that workflow. Sources must contain real files/directories, not symlinks. Review relative links and helper scripts that depend on directory depth or checkout paths; make only the required, agreed path fixes.
4. Before cutover, create an empty disposable client and run `skillbox --workspace <client-dir> add skillbox <absolute-source-repo> <destination-id> --bundle <bundle>`. Require `success: true`, the expected skill count, matching installed files/permissions, and `.claude/skills -> ../.agents/skills`. Remove only that client's generated skills directory and Claude link, then run `skillbox --workspace <client-dir> sync` twice: restore first, unchanged second. Keep its config and lock throughout. Remove the client after verification.
5. Move the original `.agents/skills` directory out of the workspace. Unlink `.claude/skills` only if it is a symlink; move a real directory to backup instead. **Both paths must be absent for first add**: even an empty skills directory or an already-correct Claude link causes `MIGRATION_REQUIRED`. From the consuming workspace, add the verified source and bundle. For a source bundle in that same repository:

    ```sh
    skillbox add skillbox . project --bundle local
    ```

    Here `project` is the composed destination installed by add; `local` is the native source bundle. The native bundle is already publishable and must not contribute to itself merely to register it. For another source repository, pass its absolute root path instead of `.`. On failure, inspect the structured error and any retained recovery directory; preserve backups and partial output before deciding how to restore. Do not overwrite newly published state blindly.

6. Verify every installed skill/resource and executable permission against the approved source, the Claude link, and the new config/lock selections. In the workspace's `.gitignore`, ignore `/.agents/skills/` and `/.claude/skills` (no trailing slash on the symlink rule). For each generated path still tracked by Git, use `git rm -r --cached -- <path>` to untrack it without deleting the installation. Stage the source bundle, config, lock, ignore rules, and removal of old tracked copies together. Run sync again and require unchanged; check unrelated files against the backup before removing it.

Report migrated names, destination ids, verification results, and any untested harness discovery or helper behavior. Check `install` separately from publishable contributions: installation choices do not hide exports. Edit owned sources afterward, not generated installations. Local filesystem sources remain live; Git imports retain immutable pins until a staged update is reviewed and captured. This is a manual unmanaged-skill migration, not compatibility guidance for obsolete Skillbox config or patch descriptors.
