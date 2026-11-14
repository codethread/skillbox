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

Git source strings are retained, not canonicalized: tree URLs for `dev` and `coding` create separate entries even when they refer to the same repository and ref. A repository URL and its GitHub shorthand also remain separate if mixed. Keep the intended Git ref when choosing a source; different refs are not interchangeable. The SDK handles fetching and discovery.

Local repositories also use explicit bundle names: `skillbox add ../my-skills development`.

Bundles live under `skillbox/<bundle>/<skill>/SKILL.md`. The command copies each selected skill and its supporting files into the client's `.agents/skills/` and links `.claude/skills` to it. Unmanaged skill paths and name collisions are rejected without overwriting their contents.

Ignore both generated installation paths in the workspace's `.gitignore` (the Claude path is a symlink, so its rule has no trailing slash):

```gitignore
/.agents/skills/
/.claude/skills
```

The CLI does not add these rules automatically. If either path is already tracked, use `git rm -r --cached -- <path>` to untrack it without deleting the installation.

Two files record the installation; commit both:

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

Retained native skills must still match their locked content hashes; sync does not update those hashes or refs. Adapted bundles use their recorded patch and output hashes, as described below. New skills receive SDK-generated lock entries. Unmanaged skill paths and name collisions are rejected before publishing. Installed managed files are generated output and can be replaced or removed by sync.

The JSON result reports `installed`, `unchanged`, and `removed` skill counts. Repeating sync with matching installed contents and lock entries reports an unchanged result without rewriting them.

Operational commands return JSON with explicit `success`, concise result data, and structured errors. Full skill contents and config/lockfile dumps are not included by default.

## Import and patch a plugin

An adapted bundle pins a Git repository's skills subtree and keeps local changes as reviewable per-file patches. Initialize PSTACK, optionally choosing the editable workspace path:

```sh
skillbox patch init pstack \
  --source https://github.com/cursor/plugins \
  --root pstack --skills-root skills \
  --ref 3dbd22ff12742fb28c9700b9760baa29ed41dc13 --update-ref main
```

Init registers the bundle and immediately returns `data.workspace` and `data.editable`; it does **not** install skills. Without `--output`, the workspace is `.skillbox-prepare-pstack`. Edit only files under `<workspace>/edited/skills/`. For an existing bundle, `skillbox patch prepare pstack` recreates the same kind of workspace, including a previously captured draft.

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

Otherwise sync returns `INTENT_REQUIRED` without changing the installation. Sync validates the adapted source, patch, and output hashes before publishing and still rejects native source content that differs from its locked hash. The bundle lock pins the upstream revision; each patch record contains only its target and diff path. File intent is explanatory and may be edited directly; integrity hashes protect source identity, patch targets and paths, and diff payloads.

Source snapshots are cached outside the project under the XDG cache directory (override with `SKILLBOX_CACHE_DIR`). A verified cached revision can be restored offline; a cold cache needs access to the pinned Git revision.

Request upstream changes explicitly:

```sh
skillbox update pstack                 # resolve the configured update_ref
skillbox update pstack --ref <commit>  # choose a particular revision
```

Update advances the adapted bundle lock with strict replay but does not install until sync. On `UPDATE_CONFLICT`, the current tracking files and live installation remain unchanged and the result provides a regeneration workspace. Edit its `edited/skills/` tree, then adopt it:

```sh
skillbox patch adopt pstack --from <returned-workspace>
# Preserve an existing reason across an exact upstream rename:
skillbox patch adopt pstack --from <returned-workspace> \
  --map 'skill/references/old.md=skill/references/new.md'
```

Adopt may rebuild ordered diffs against the new pristine source while preserving file notes. Annotate blank intents for new targets, then sync. This repository uses the same workflow for its PSTACK adaptation; see [the PSTACK bundle guide](docs/engdocs/pstack-patches.md) for provenance and maintained scope.

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
