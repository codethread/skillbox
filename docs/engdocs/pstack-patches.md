# PSTACK bundles and patches

This working POC has two parts: the reusable Skillbox patch commands and this repository's PSTACK bundle maintained through those commands. The installed skills remain generated output, while source provenance, patch intent, and concrete diffs belong in Git under `skillbox/`.

The existing [acceptance criteria](PRD.md) remain the product requirements. The implementation choices below are the reviewable POC draft requested for this worktree.

## Sources

| Source | What it establishes |
| --- | --- |
| [Cursor marketplace](https://cursor.com/marketplace/cursor/pstack) | The official PSTACK plugin and its source repository. |
| [Official source](https://github.com/cursor/plugins/tree/c742dd61706fbacc1b95f1a20b7b988cf096ce6c/pstack) | PSTACK 0.15.36: 58 skills, including 24 internal principle references, with nested playbooks, references, and scripts. |
| [Plugin manifest](https://github.com/cursor/plugins/blob/c742dd61706fbacc1b95f1a20b7b988cf096ce6c/pstack/.cursor-plugin/plugin.json) | Skills live under `skills/`; plugin agents are a separate capability. |
| [Michael Denyer's port](https://github.com/michael-denyer/pstack-claude/tree/a12b04786023e762f12f5de7bb5fafb8c23f8c36) | A maintained adaptation of PSTACK for other agent runtimes. |
| [Port maintenance workflow](https://github.com/michael-denyer/pstack-claude/blob/a12b04786023e762f12f5de7bb5fafb8c23f8c36/CONTRIBUTING.md) | How it separates upstream content, runtime translation, and deliberate policy changes. |
| [Upstream pins and exclusions](https://github.com/michael-denyer/pstack-claude/blob/a12b04786023e762f12f5de7bb5fafb8c23f8c36/tools/upstream.json) | Exact source revisions and explicit omitted paths. |
| [Declared changes and reasons](https://github.com/michael-denyer/pstack-claude/blob/a12b04786023e762f12f5de7bb5fafb8c23f8c36/tools/forks.json) | A reason for each deliberately changed upstream file. |
| [Port sync implementation](https://github.com/michael-denyer/pstack-claude/blob/a12b04786023e762f12f5de7bb5fafb8c23f8c36/tools/sync.mjs) | Comparison of old upstream, new upstream, and local content, including additions, removals, modes, and conflicts. |

The official source was inspected at repository commit `3dbd22ff12742fb28c9700b9760baa29ed41dc13`. Its most recent PSTACK change is `c742dd61706fbacc1b95f1a20b7b988cf096ce6c`; both identify the same PSTACK subtree.

## Required outcome

1. Select a source subtree and give all its skills the local bundle name `pstack`.
2. Record its original repository, subtree, and exact revision without installing it.
3. Create an editable workspace immediately and capture modifications, additions, and deletions, including nested files and executable modes.
4. Annotate every captured file with intent explaining why it differs, its required outcome, and constraints future regeneration must preserve.
5. Commit the intent metadata and concrete diffs, then run `skillbox sync` to reproduce the patched skills in ignored `.agents/skills/`.
6. Explicitly request source updates. Stage the exact candidate without changing the tracked pin or installation, then let an agent review and capture it.

Capture and update never install. Sync applies concrete artifacts without interpreting intent or running an agent, and refuses blank intent before changing the installation.

## Source and installation scope

PSTACK's source tree contains more than skills. The source snapshot remains available for provenance and patch authoring. Installation selects skill directories and their supporting files, including the internal principle references. Plugin agents, hooks, and automations are not activated.

Sibling skill links remain valid in the flat installation. The Botlake patch carries the useful plugin guide pages, licence, and attribution into `poteto-help/references/upstream/` and updates their links. Two useful agent briefs are retained as supporting references; they do not register plugin agents.

## Botlake adaptation

The patch preserves PSTACK's engineering workflows while changing their runtime instructions to use the lake's configured capabilities:

- Work groups, tasks, dependencies, and notes for durable coordination.
- Registered agent seats and managed runs for delegation and model selection.
- Mail for coordination between agents.
- Gates for machine-checkable waiting conditions.
- Explicit run inspection and session recovery instead of assuming Cursor transcript locations or background task tools.

Runtime-sensitive entry points include `poteto-mode`, `setup-pstack`, investigation and review skills, session recovery, and the coordination playbooks. Supporting documents must agree with the entry points they explain.

## Agreed implementation draft

Sol and DeepSeek independently reviewed the repository and references, exchanged critiques through Botlake Mail, and agreed on the following design:

- Keep the existing source/bundle config and SDK lock format. Discover adapted bundles through `skillbox/patches/<bundle>/bundle.toml`.
- Pin the imported Git revision and subtree in a separate bundle lock. Keep full source context in a verified, ignored cache; commit provenance and diffs.
- Apply patches to source before SDK installation. The SDK's hashes then describe the final installed content, rather than an unpatched intermediate tree.
- Keep one intent note per changed file and an ordered list of concrete Git diffs in its skill's `patch.toml`. Successive captures append incremental patches for the same target, including deliberate reverts, while sharing that file note. Include additions, deletions, nested paths, binary changes, and executable modes.
- Make sync deterministic and independent of an agent. A deliberate update resolves the moving upstream ref once, stages that exact candidate, and leaves the tracked pin and installation unchanged.
- Preserve reasons when regenerated changes move to renamed files through an explicit capture mapping. The agent supplies the new implementation; the CLI validates and records it.
- Write captured patch artifacts and the refreshed prepared manifest atomically. Publish installation changes only through sync.

The Claude port demonstrates the maintenance problem and the value of per-file reasons. This POC uses strict patch replay and an explicit agent regeneration workflow; an automatic three-way merge engine is outside its scope.

## Tracking layout

```text
skillbox/
  config.json
  lock.json
  patches/pstack/
    bundle.toml              # original source, subtree, update ref
    lock.json                # source identity, exact revision, source/patch hashes
    <skill>/
      patch.toml             # file intents plus ordered patch records
      changes/*.patch        # incremental one-file Git diffs
.agents/skills/              # generated and ignored
.claude/skills               # generated symlink, ignored
```

The source cache is outside the project under the XDG cache directory; `SKILLBOX_CACHE_DIR` overrides it. Cached content is checked before replay. Ordinary sync fetches the exact recorded commit if the cache is empty and fails if that commit is unavailable. A warm adapted bundle cache supports offline reconstruction. The repository's native bundles keep their existing fetching behavior, so this does not promise an entirely offline sync for arbitrary mixed configurations.

## Maintaining the local bundle

The [README](../../README.md#import-and-patch-a-plugin) documents importing a new bundle. This repository already records its PSTACK selection, so restore it with:

```sh
bun run src/cli.ts sync
```

To change the bundle, use the same workflow as a consumer:

1. Run `bun run src/cli.ts patch prepare pstack`. The optional `--output` overrides the default `.skillbox-prepare-pstack`. The result identifies the workspace and editable tree.
2. Edit, add, or delete files only under `.skillbox-prepare-pstack/edited/skills/`, including nested references and scripts.
3. Capture and inspect the result:

    ```sh
    bun run src/cli.ts patch capture pstack --from .skillbox-prepare-pstack
    ```

    Capture appends incremental per-file diffs against the last captured output, verifies strict replay, writes the pack, and refreshes the prepared manifest atomically. It does not install. Later edits and deliberate reverts add ordered patch records instead of replacing earlier artifacts.

4. Follow `intentFiles` and edit each reported `skillbox/patches/pstack/<skill>/patch.toml`. Replace blank file intent with the adaptation's why, required outcome, and constraints. Existing reasons are preserved and shared by every patch for that target.
5. Continue editing and capturing in the same workspace as needed. Manual intent annotation and an intervening sync do not make the workspace single-use. Review notes as files evolve: the maintainer owns their accuracy, and capture neither rewrites nor guesses intent.
6. Run `bun run src/cli.ts sync` only after using `intentFiles` to address the reported `pendingIntents` count. A blank intent returns `INTENT_REQUIRED` without installation mutation. Review and commit `skillbox/config.json`, `skillbox/lock.json`, and `skillbox/patches/pstack/`.

The bundle lock records the source identity, exact revision, and source and patch hashes. Each patch record contains only its target and diff path. File intent remains editable explanation and is excluded from integrity hashes. Source identity, patch targets and paths, and concrete diff payloads are protected. Capture verifies that replay reproduces the edited tree.

For an upstream refresh, run `bun run src/cli.ts update pstack`, with `--ref <ref>` when you need a specific revision. Update resolves the ref once and stages that exact candidate without changing any tracked pin or installing skills. A later push to the ref does not change the candidate.

The clean JSON result has status `prepared`, an empty `conflicts` array, the source repository and exact `from`/`to` revisions, and `workspace`, `pristine`, and `editable` paths. `UPDATE_CONFLICT` returns nonzero with status `conflicted`, the same refs and paths, and the failed skill, target, patch, and reason. The pristine tree is the new source. The editable tree is the new source plus successful replays, and can be partial after conflicts. The replay skips later patches for a failed target.

Before editing, inspect the upstream Git log and diff from `from` to `to`, scoped to the descriptor root. Read broad upstream changes, including new files, renames, deletions, runtime assumptions, scripts, and executable modes. Compare the upstream-authored change with each file intent and the candidate's adapted result. Use `patch prepare` and `git diff --no-index` to compare the current and candidate edited trees when useful. A clean replay can still leave a semantic conflict, duplicate an adaptation that upstream absorbed, or miss a new runtime-specific file.

Edit distributed skill files under the returned editable tree’s configured skills root. Report product or policy decisions to the user instead of inventing custom analysis commands. Then capture the candidate:

```sh
bun run src/cli.ts patch capture pstack --from <returned-workspace>
# Preserve intent across an exact upstream rename:
bun run src/cli.ts patch capture pstack --from <returned-workspace> \
  --map 'skill/old-path=skill/new-path'
```

Capture records the exact candidate pin, regenerates diffs against its pristine source, retains per-file intent, and verifies replay. You can edit and capture repeatedly; later captures append as usual. New targets receive blank intent. Add their notes, review the candidate, then sync.

`tests/patch.test.ts` exercises the public CLI with a local bare remote, an upstream author checkout, and a consumer repository. The author commits and pushes real upstream changes; the consumer reviews an exact candidate, captures it, and syncs.

## Verified POC result

The dogfood artifacts select all 58 PSTACK skills beside the nine existing native skills. Running `bun run src/cli.ts sync` produces 67 skills under ignored `.agents/skills/`.

- The patch pack records 75 captured changes across 17 skills: 58 modifications, 16 additions, and one deletion. Each target has file-level intent, each patch points to a concrete Git diff, and the bundle lock records the exact source revision.
- The PSTACK installation contains 550 files, including 423 files under script directories. Its bytes and executable modes match the prepared edited source. The nine native lock entries remain unchanged.
- The deleted file is `poteto-mode/scripts/worktree-audit.sh`, whose Cursor transcript assumptions do not apply here. The corresponding playbook uses Botlake records and `wktree`; the deletion and its reason are recorded. The other five upstream executable files retain their executable modes.
- Removing generated output and restoring with the Node build recreates all 67 skills. Repeated sync preserves file modification times. Bun source, packaged Node, and standalone binary sync all pass.
- `bun run check` passes: 38 tests, 54 snapshots, lint, types, formatting, and changelog validation. Fifteen tests cover the patch lifecycle, including staged updates, overlapping conflicts, renamed targets, new and removed skills, upstream-incorporated changes, and exact candidate pins despite later pushes. Both packaged builds pass. The adapted `poteto-mode` scripts passed their 61 tests and typecheck in a disposable copy.

Review the [source descriptor](../../skillbox/patches/pstack/bundle.toml), [source and patch lock](../../skillbox/patches/pstack/lock.json), and [mode's per-file intents](../../skillbox/patches/pstack/poteto-mode/patch.toml). The `changes/` directory next to each intent manifest contains the replayable diffs.
