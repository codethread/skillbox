# Review and capture an upstream update

Use this workflow when the user asks to update an adapted bundle. Skillbox stages source and replay results. You inspect upstream changes, judge whether the adaptation still meets each file intent, and report unresolved decisions to the user.

## Stage the exact candidate

Run one of these commands:

```sh
skillbox update <bundle>
skillbox update <bundle> --ref <ref>
```

Without `--ref`, Skillbox resolves the descriptor's configured update ref. The command resolves that ref once and stages that exact commit. A later upstream push does not change the candidate.

Update never installs and never changes a tracked pin. It returns a prepared workspace with these trees:

- `pristine` is the candidate's unmodified source.
- `edited` starts with the candidate source plus every patch that replayed successfully.
- If a target conflicts, `edited` contains the partial result. Skillbox skips later patches for that target.

For a clean replay, expect `data.status` to be `prepared`, `data.conflicts` to be empty, and `data` to include `source`, `from`, `to`, `workspace`, `pristine`, and `editable`. The `editable` field is the path to the edited tree.

For a conflict, expect a nonzero result with `UPDATE_CONFLICT`. The same paths remain in `data`, `data.status` is `conflicted`, and each conflict names the failed `skill`, `target`, `patch`, and `reason`.

## Review what upstream authored

Do not treat a clean replay as proof that the update is correct. Agents are expected to use Git well and make the semantic judgment.

1. In an upstream checkout, use `data.from` as the old pin and `data.to` as the exact candidate pin. Inspect the descriptor root between them:

    ```sh
    git log --oneline <data.from>..<data.to> -- <descriptor-root>
    git diff --stat <data.from> <data.to> -- <descriptor-root>
    git diff --find-renames <data.from> <data.to> -- <descriptor-root>
    ```

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

Capture records `data.to` as the new bundle pin and regenerates diffs against the candidate's pristine source. It retains existing per-file intent. The capture also verifies that replay reproduces the edited tree.

If upstream renamed a file and its intent still applies, preserve that intent during capture:

```sh
skillbox patch capture <bundle> --from <workspace> \
  --map 'skill/old-path=skill/new-path'
```

New targets receive blank intent. Update their `patch.toml` entries with the reason, required outcome, and constraints. Further captures append ordered patches as usual.

Proceed with authorized routine changes. Ask the user only about unresolved product or policy decisions. Run `skillbox sync` after all intent notes and reported findings are addressed. Sync verifies the recorded source and patch hashes before installation.
