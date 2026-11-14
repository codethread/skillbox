# Skillbox

Repository-local skill bundles for agents.

## Install

Requires Node.js 22.20+ and Git. Install the CLI in your project:

```sh
bun add --dev @codethread/skillbox
# or: npm add --save-dev @codethread/skillbox
```

The package ships a prebuilt CLI; no postinstall build is required. npm and Bun expose the `skillbox` executable to package scripts:

```json
{
	"scripts": {
		"skills:sync": "skillbox sync"
	}
}
```

## Add bundles

```sh
bunx @codethread/skillbox add https://github.com/codethread/agents dev coding
```

### Build from source

Build a standalone CLI, then add a GitHub bundle to your project—source skills do not need an npm package. For repository development, `mise run` installs the pinned tools, root Bun workspace (including Botlake), and Git hooks:

```sh
bun install --frozen-lockfile
bun run build
./dist/skillbox --workspace ../my-project add https://github.com/codethread/agents dev coding
```

Prefer a repository URL or GitHub shorthand with explicit bundle names. Reuse the exact same source string when adding more bundles to keep them in one config entry:

```sh
skillbox add owner/repo frontend
skillbox add owner/repo backend
# One source entry with bundles: ["backend", "frontend"].
```

A tree URL pointing to `skillbox/<bundle>` is also supported and implies the bundle name:

```sh
skillbox add https://github.com/codethread/agents/tree/main/skillbox/dev
```

Git source strings are retained, not canonicalized: tree URLs for `dev` and `coding` create separate entries even when they refer to the same repository and ref. A repository URL and its GitHub shorthand also remain separate if mixed. Keep the intended Git ref when choosing a source; different refs are not interchangeable. The SDK handles native bundle fetching and discovery.

Local repositories also use explicit bundle names: `skillbox add ../my-skills development`.

Native bundles live under `skillbox/<bundle>/<skill>/SKILL.md`. Producers can also export adapted bundles from `skillbox/patches/<bundle>/`; see [Consume a shared adaptation](#consume-a-shared-adaptation). The command copies each selected skill and its supporting files into the client's `.agents/skills/` and links `.claude/skills` to it. Unmanaged skill paths and name collisions are rejected without overwriting their contents.

Ignore both generated installation paths in the workspace's `.gitignore` (the Claude path is a symlink, so its rule has no trailing slash):

```gitignore
/.agents/skills/
/.claude/skills
```

The CLI does not add these rules automatically. If either path is already tracked, use `git rm -r --cached -- <path>` to untrack it without deleting the installation.

Two files record the installation; commit both, along with any `skillbox/patches/` packs:

- `skillbox/config.json` records source repositories and requested bundles. Local source paths are relative to the workspace root; Git sources retain their source string.
- `skillbox/lock.json` is Skillbox's lockfile, retaining the SDK's native format. It records per-skill source information, content hashes, copy mode, and Git refs and skill paths where available. Local source paths remain relative to the workspace root. A branch such as `main`, or a content hash by itself, is **not an immutable revision pin**.

Skillbox does not read or modify the root `skills-lock.json` used by `npx skills`. SDK lock generation happens only in disposable staging directories.

For example, a config selecting a sibling source repository looks like:

```json
{
	"sources": [
		{
			"source": "../my-skills",
			"bundles": ["development"]
		}
	]
}
```

Adding another source or bundle preserves existing installed skills and lock entries. Repeating an add with the same source string and already-configured bundles performs no writes. The SDK config object stays in code; there is no second SDK config file.

### Workspaces

```sh
bun run src/cli.ts --workspace frontend add ../my-skills development
bun run src/cli.ts --workspace backend add ../my-skills development
```

`--workspace` selects a workspace directory, defaulting to the current directory; `skillbox/config.json` is implied. In these examples, the existing `frontend/` and `backend/` directories each get their own `.agents/skills/`, `.claude/skills` link, config, and Skillbox lockfile. Relative and absolute directory paths are supported. Source arguments are resolved from the invocation directory, then saved relative to the workspace root.

## Sync

```sh
skillbox sync
skillbox --workspace frontend sync
```

Edit `skillbox/config.json` to add or remove sources/bundles, then run sync. Both tracking files must already exist; use `add` for the first installation. Sync installs newly selected skills, removes deselected managed skills and their lock entries, and preserves the config's formatting. Local paths in the config resolve from the selected workspace root. Use `"sources": []` to remove all managed skills.

Retained native skills must still match their locked content hashes; sync does not update those hashes or refs. Adapted bundles use their recorded source and patch hashes, as described below. New skills receive SDK-generated lock entries. Unmanaged skill paths and name collisions are rejected before publishing. Installed managed files are generated output and can be replaced or removed by sync.

The JSON result reports `installed`, `unchanged`, and `removed` skill counts. Repeating sync with matching installed contents and lock entries reports an unchanged result without rewriting them.

Operational commands return JSON with explicit `success`, concise result data, and structured errors. Full skill contents and config/lockfile dumps are not included by default.

## Consume a shared adaptation

Skillbox is the CLI. This repository also produces a shared CT-Botlake adaptation of PSTACK. From your consuming project, import that bundle from the producer repository:

```sh
skillbox add codethread/skillbox pstack
```

Use a producer revision containing the adaptation. A sibling checkout works too: `skillbox add ../skillbox pstack`. Add installs the adapted skills and creates an empty consumer-owned pack under `skillbox/patches/pstack/`. It records the producer snapshot without copying the producer's diffs or claiming ownership of its intents. Commit your config, lock, and patch pack. You do not need a checkout of the producer or a manual copy of its generated skills.

Ordinary sync restores the recorded producer snapshot and your patches. Git producers are pinned to exact commits; local producers use content-digest snapshots. The producer's own lock retains the original PSTACK source pin. A producer push or local edit does not silently advance your installation.

To customize an imported skill in your project:

```sh
skillbox patch prepare pstack
# Edit .skillbox-prepare-pstack/edited/skills/.
skillbox patch capture pstack --from .skillbox-prepare-pstack
# Annotate the reported file intents in your own patch pack.
skillbox sync
```

Your patches apply on top of the producer's adaptation. To adopt a newer producer version, run `skillbox update pstack`, review the staged result, then capture and sync as described below. This updates the producer snapshot, not its original upstream independently. Git owns review, history, and reverts.

A separate local skill is another option when you want a personal mode, project verification workflow, or preferences alongside PSTACK. Author it at `skillbox/local/<name>/SKILL.md` and select it with `skillbox add . local`. Use a distinct skill name; local bundles do not override imported skills by name. Neither a local overlay nor a patch is mandatory. Changes meant for every consumer belong with the shared bundle's maintainer.

## Import and patch a plugin

An adapted bundle pins a Git repository's skills subtree and keeps local changes as reviewable per-file patches. Initialize PSTACK, optionally choosing the editable workspace path:

```sh
skillbox patch init pstack \
  --source https://github.com/cursor/plugins \
  --root pstack --skills-root skills \
  --ref 3dbd22ff12742fb28c9700b9760baa29ed41dc13 --update-ref main
```

Init registers the bundle and immediately returns `data.workspace` and `data.editable`; it does **not** install skills. Without `--output`, the workspace is `.skillbox-prepare-pstack`. Edit only files under `<workspace>/edited/skills/`. For an existing adapted bundle, `skillbox patch prepare pstack` recreates the same kind of workspace, including a previously captured draft.

Capture additions, edits, deletions, binary content, and executable mode changes as ordered per-file diffs:

```sh
skillbox patch capture pstack --from .skillbox-prepare-pstack
```

Capture appends incremental diffs against the last captured output, verifies replay, writes `skillbox/patches/pstack/`, and refreshes the prepared manifest atomically; it never installs. A later edit or deliberate revert adds another ordered patch rather than replacing earlier artifacts.

Its result reports `pendingIntents` and workspace-relative `intentFiles`. In each reported `<skill>/patch.toml`, file intent is separate from the ordered `[[patches]]` records. New targets have blank intent; explain why the adaptation exists, its required outcome, and constraints future updates must preserve. Existing manually edited file reasons survive recapture and apply to every patch for that target. Review their continuing accuracy as files evolve; capture does not rewrite or guess them.

The workspace remains reusable: edit `edited/skills/` again and rerun capture, including after annotating intents or syncing. Commit `skillbox/config.json`, `skillbox/lock.json`, and `skillbox/patches/<bundle>/`. Keep editable workspaces and generated `.agents/skills/` and `.claude/skills` output ignored.

Run sync only after every intent is nonblank:

```sh
skillbox sync
```

Otherwise sync returns `INTENT_REQUIRED` without changing the installation. Sync validates the adapted source and patch hashes before publishing and still rejects native source content that differs from its locked hash. Capture verifies that replay reproduces the edited tree. The bundle lock records the source identity, exact source pin, and source and patch hashes; each patch record contains only its target and diff path. File intent is explanatory and may be edited directly; integrity hashes protect source identity, patch targets and paths, and diff payloads.

Source snapshots are cached outside the project under the XDG cache directory (override with `SKILLBOX_CACHE_DIR`). Verified cached sources can be restored offline. A cold cache needs access to every pinned Git revision in the adaptation chain. A local producer snapshot needs its matching cached content or unchanged local source; an unavailable snapshot fails rather than accepting changed content.

Request upstream changes explicitly:

```sh
skillbox update pstack                # Git update_ref or current local producer
skillbox update pstack --ref <commit> # choose a Git revision
```

`--ref` selects a Git revision. Local producers reject `--ref`; update snapshots their current worktree.

Update always stages the exact resolved candidate. It does not change a tracked pin or install skills. The JSON result returns `source`, `from`, `to`, `workspace`, `pristine`, and `editable`. `from` and `to` are pin objects: Git pins contain `type: "git"`, `revision`, and `tree`; local producer pins contain `type: "local"` and `digest`. A clean replay has status `prepared` and an empty `conflicts` array. `UPDATE_CONFLICT` returns nonzero with the same paths, status `conflicted`, and the failed skill, target, patch, and reason. The pristine tree is the new baseline: raw plugin source for a direct import, or the producer's adapted output for an imported bundle. The editable tree adds your successful patch replays and can be partial after a conflict. Later patches for a failed target are skipped.

For Git sources, review the source log and diff from the old pin to the exact candidate pin, scoped to the descriptor root. For an imported adaptation, include the producer's pack and original-source pin changes; compare the old and candidate materialized trees as well. For local producer snapshots, compare those trees and the producer's available history. Read broad changes, including new files, runtime assumptions, renames, deletions, scripts, and executable modes. Compare those changes with each per-file intent and the current adapted result. A clean replay can still hide a semantic conflict or an upstream change that has absorbed a local patch.

Edit the returned workspace and capture the candidate:

```sh
skillbox patch capture pstack --from <returned-workspace>
# Preserve intent across an exact upstream rename:
skillbox patch capture pstack --from <returned-workspace> \
  --map 'skill/references/old.md=skill/references/new.md'
```

Capture records the exact candidate pin and regenerates diffs while retaining per-file intent. You can edit and capture repeatedly; later captures append as usual. Annotate blank intents for new targets, then sync. A later upstream push does not change the staged candidate. This repository uses the same workflow for its PSTACK adaptation; see [the PSTACK bundle guide](docs/engdocs/pstack-patches.md) for provenance and maintained scope.

Native bundle revision pin creation, automatic ignore setup in consuming projects, migration, and multi-workspace orchestration remain separate work.

## Botlake Mail

The repository lake enables direct Mail, registered identity links, and automatic live-agent delivery with five-minute post-stop resumption. Agents use `bl mail` and should inspect delivery status.

## Changelog

Read [the changelog](CHANGELOG.md), or query the history bundled in the installed CLI without a workspace, Git checkout, or network:

```sh
skillbox changelog
skillbox changelog --since 0.1.1
skillbox changelog --release 0.1.1 --text
```

The default JSON response uses the `success`/`data`/`errors` envelope. History starts at 0.1.0; the default selects the newest recorded release at or below the installed version. `--since` is exclusive and cannot be combined with `--release`. Pages contain up to 20 changes by default; use `--limit` (1–100) and continue with `--offset` at `data.nextOffset` when present. `--schema` returns the JSON Schema for `data`; `--text` opts into human-readable output. Breaking changes and adoption steps are recorded explicitly.

## Agent guidance

The CLI bundles offline instructions for project configuration and bundle authoring. Discover metadata first, then load only the instructions or supporting resource needed:

```sh
skillbox skills list
skillbox skills get <name>
skillbox skills file <name> <path>
```

These commands return JSON in the same `success`/`data`/`errors` envelope. `get` returns Markdown in `data.body` without frontmatter; `file` returns a selected resource in `data.content`. This reads CLI-bundled guidance, not skills installed in a workspace. `skills list --limit <count> --offset <count>` supports paging; `data.nextOffset: null` means exhausted. Use `skills schema <list|get|file>` for response schemas.

Run `skillbox --help` or `skillbox <command> --help` for command options.
