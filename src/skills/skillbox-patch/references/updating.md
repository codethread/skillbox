# Review and capture an upstream update

Use this workflow when the user asks to update an adapted bundle. Skillbox stages source and replay results. You inspect upstream changes, judge whether the adaptation still meets each file intent, and report unresolved decisions to the user.

## Stage the exact candidate

Run one of these commands:

```sh
skillbox update <bundle>
skillbox update <bundle> --ref <ref>
```

For a Git source, Skillbox resolves the descriptor's configured update ref unless you supply `--ref`. It resolves that ref once and stages the exact commit. A later upstream push does not change the candidate. For a local producer, update snapshots the current worktree and rejects `--ref`.

For an imported adaptation, the source is the producer. Update materializes the candidate producer's committed adaptation and replays your consumer patches on top. It does not independently advance the original source pinned by the producer.

Update never installs and never changes a tracked pin. It returns a prepared workspace with these trees:

- `pristine` is the candidate baseline: unmodified source for a raw plugin import, or the producer's adapted output for an imported bundle.
- `edited` starts with the candidate source plus every patch that replayed successfully.
- If a target conflicts, `edited` contains the partial result. Skillbox skips later patches for that target.

For a clean replay, expect `data.status` to be `prepared`, `data.conflicts` to be empty, and `data` to include `source`, `from`, `to`, `workspace`, `pristine`, and `editable`. The `editable` field is the path to the edited tree. `from` and `to` are pin objects: Git pins have `type: "git"`, `revision`, and `tree`; local pins have `type: "local"` and `digest`.

For a conflict, expect a nonzero result with `UPDATE_CONFLICT`. The same paths remain in `data`, `data.status` is `conflicted`, and each conflict names the failed `skill`, `target`, `patch`, and `reason`.

## Review what upstream authored

Do not treat a clean replay as proof that the update is correct. Agents are expected to use Git well and make the semantic judgment.

1. For a Git source, use the returned old and candidate revisions in a source checkout. Inspect the descriptor root between them:

    ```sh
    git log --oneline <data.from.revision>..<data.to.revision> -- <descriptor-root>
    git diff --stat <data.from.revision> <data.to.revision> -- <descriptor-root>
    git diff --find-renames <data.from.revision> <data.to.revision> -- <descriptor-root>
    ```

    For an imported adaptation, inspect the producer pack's diffs, intents, and original-source pin changes, then compare the old and candidate materialized trees. Local producer snapshots have content digests rather than Git revisions; compare their trees and use available producer history instead of passing digests to Git.

2. Read the broad upstream change, not only patched files. Include new files, deleted or renamed files, executable-mode changes, scripts, links, and runtime assumptions.
3. Read every affected file intent in `skillbox/patches/<bundle>/<skill>/patch.toml`.
4. Compare the upstream-authored change, the intent, and the candidate's current adapted result under `edited`.
5. When useful, run `skillbox patch prepare <bundle> --output <fresh-directory>` for the current recorded adaptation. Compare its edited tree with the candidate using `git diff --no-index <old-edited> <candidate-edited>`. Do this before capturing the candidate, while the bundle lock still names the old pin.

Look for issues that strict replay cannot decide:

- Upstream changed the behavior around a patch, but the patch still applies.
- Upstream absorbed all or part of the local adaptation.
- Upstream renamed or deleted a target or added its replacement elsewhere.
- A new script, reference, mode, or runtime assumption needs adaptation.
- A clean textual result no longer satisfies the file's intent.
- A conflict needs a product or policy choice rather than a mechanical edit.

Report meaningful findings and choices to the user. Do not manufacture a custom classifier or summarize every changed line.

## Edit and capture the candidate

Edit only distributed skill files under `editable/<skills-root>/`. Do not edit other candidate source files. Resolve conflicts and semantic issues in the skill tree. You can edit and capture repeatedly.

Capture the staged candidate with:

```sh
skillbox patch capture <bundle> --from <workspace>
```

Capture records the exact staged candidate as the new bundle pin and regenerates your diffs against its pristine baseline. For an imported adaptation, the producer's diffs and intents stay in the producer snapshot. Capture retains your existing file intent and verifies that replay reproduces the edited tree.

If upstream renamed a file and its intent still applies, preserve that intent during capture:

```sh
skillbox patch capture <bundle> --from <workspace> \
  --map 'skill/old-path=skill/new-path'
```

New targets receive blank intent. Update their `patch.toml` entries with the reason, required outcome, and constraints. Further captures append ordered patches as usual.

Proceed with authorized routine changes. Ask the user only about unresolved product or policy decisions. Run `skillbox sync` after all intent notes and reported findings are addressed. Sync verifies the recorded source and patch hashes before installation.
