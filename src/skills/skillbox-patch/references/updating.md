# Review and capture an upstream update

Use this workflow when the user asks to update a composed bundle. Skillbox stages a candidate; you review upstream changes against the user's intent before accepting it.

## Stage, do not install

```sh
skillbox update <id>
```

The destination can contain several contributions. Each direct Git contribution has its own configured ref and locked revision. Use command help for ref overrides; do not assume all sources share a branch or tag. Local filesystem sources use current worktree content rather than immutable Git pins. Update another local bundle's Git sources by addressing that bundle explicitly; updating its consumer does not advance them.

Update creates a candidate under `skillbox/.prepare/<id>/` for shared config or `skillbox/.prepare.local/<id>/` for personal config. Keep the same config active through capture. Use the returned paths rather than guessing the generated name:

- `pristine/skills/` holds the candidate composition before your local patches.
- `edited/skills/` holds the candidate with replayed local changes; conflicts may leave a partial result requiring repair.
- `manifest.json` is CLI-managed candidate state, not a file to edit.

Update does not install or accept tracked pins. A later upstream push must not silently replace the staged Git candidate. On a conflict, retain the returned workspace and read the affected skill/target and error. Do not discard old intent or treat a nonzero result as an accepted update.

For a Skillbox producer contribution, the baseline includes that producer's patches and locked dependencies. Your patches apply on top. Updating the producer does not independently update its dependencies.

## Review what upstream authored

Do not equate clean patch replay with a correct update.

1. Identify each changed contribution and compare its old and candidate Git revisions in a source checkout:

    ```sh
    git log --oneline <old-revision>..<candidate-revision> -- <source-path>
    git diff --stat <old-revision> <candidate-revision> -- <source-path>
    git diff --find-renames <old-revision> <candidate-revision> -- <source-path>
    ```

    For raw skills, inspect their configured directory. For a Skillbox producer, inspect its native members, config, root lock, and patches, then compare materialized output. Do not pass a local worktree marker or content digest to Git as a revision.

2. Review broad upstream changes, not only patched files: new files, renames, deletions, scripts, executable modes, and runtime assumptions.
3. Read every affected file intent in `<id>/<skill>/patch.toml` under the active patch directory. Compare that intent with the candidate under `edited/skills/`.
4. If useful, prepare the currently recorded bundle in a separate fresh directory before capturing the candidate:

    ```sh
    skillbox patch prepare <id> --output <fresh-directory>
    git diff --no-index <old-workspace>/edited <candidate-workspace>/edited
    ```

    This compares recorded Git pins, but cannot recover old live local worktree content; retain backups or use the source's history for that case.

Look for changes that replay cannot judge: upstream absorbed your customization, a renamed target needs its intent transferred, a new reference or script needs adaptation, or a clean textual result no longer meets the required outcome. Report meaningful findings and unresolved product/policy choices, not a summary of every changed line.

## Edit, capture, then sync

Edit only distributed skill files under `<workspace>/edited/skills/`. Resolve replay conflicts and semantic issues, then accept the staged candidate with:

```sh
skillbox patch capture <id> --from <workspace>
```

Candidate capture accepts its staged source pins and regenerates your diffs against its pristine baseline. Producer-owned diffs and intent remain with the producer. Preserve existing file intent; when upstream renamed a target and its reason still applies, transfer it explicitly:

```sh
skillbox patch capture <id> --from <workspace> \
  --map 'skill-directory/old-path=skill-directory/new-path'
```

Capture rejects unresolved replay conflicts rather than dropping their patches. Repair every reported target. If a customization is no longer wanted, deliberately remove its obsolete patch records, payloads, and intent, then stage a fresh candidate.

New targets receive blank intent. Fill the reported `patch.toml` entries with the reason, required outcome, and constraints. Further ordinary captures append ordered changes as usual.

Proceed with authorized routine changes; ask about unresolved product or policy decisions. Run `skillbox sync` only after intent and review findings are addressed. Verify the installed result and repeat sync for unchanged contents. Commit shared lock and patch changes together; keep personal lock and patches private.
