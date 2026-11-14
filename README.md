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

Retained skills must still match their locked content hashes; sync does not update those hashes or refs. New skills receive SDK-generated lock entries. Unmanaged skill paths and name collisions are rejected before publishing. Installed managed files are generated output and can be replaced or removed by sync.

The JSON result reports `installed`, `unchanged`, and `removed` skill counts. Repeating sync with matching installed contents and lock entries reports an unchanged result without rewriting them.

Operational commands return JSON with explicit `success`, concise result data, and structured errors. Full skill contents and config/lockfile dumps are not included by default.

## Import and patch a plugin

An adapted bundle imports a Git repository's skills subtree, pins its exact revision, and keeps local changes as reviewable patches. For example, import all of the official PSTACK skills under the bundle name `pstack`:

```sh
skillbox patch init pstack \
  --source https://github.com/cursor/plugins \
  --root pstack --skills-root skills \
  --ref 3dbd22ff12742fb28c9700b9760baa29ed41dc13 --update-ref main
skillbox patch prepare pstack --output .skillbox-prepare-pstack
```

`init` installs the skills and records the source. `prepare` returns an editable workspace containing `pristine/`, `edited/`, and a manifest. Edit files under `edited/skills/`, including nested references and scripts. Capture those changes with their reason:

```sh
skillbox patch capture pstack --from .skillbox-prepare-pstack \
  --intent "Use the project's Botlake seats, work records, and Mail for coordination."
skillbox sync
```

For distinct reasons per file, pass `--intent-file intents.toml` instead of `--intent`. Each `[[change]]` entry names a `skill`, a skill-relative `target` such as `./references/tools.md`, and its `intent`. Additions, deletions, binary files, and executable mode changes are captured as concrete Git diffs. An optional `--skill` narrows capture to one skill.

Commit `skillbox/config.json`, `skillbox/lock.json`, and `skillbox/patches/<bundle>/`. The patch directory contains the source descriptor, exact source revision and content hashes, and per-skill intent manifests and diffs. Keep `.agents/skills/`, `.claude/skills`, and editable workspaces ignored. Sync reconstructs installed skills from the pinned source and committed patches; it neither advances the source nor interprets the intent.

Source snapshots are cached outside the project, under the XDG cache directory (override with `SKILLBOX_CACHE_DIR`). A verified cached revision can be restored offline. A cold cache needs access to the pinned Git revision; the full upstream source is not committed to the project. Existing native bundles retain their existing source-fetching behavior.

Request upstream changes explicitly:

```sh
skillbox update pstack                 # resolve the configured update_ref
skillbox update pstack --ref <commit>  # choose a particular revision
```

If a patch no longer applies, update leaves the current installation and tracking files unchanged and returns an `UPDATE_CONFLICT` with a regeneration workspace. Adapt its `edited/` files using the recorded intents, then adopt the result:

```sh
skillbox patch adopt pstack --from <returned-workspace>
# When upstream renamed a patched file, preserve its reason explicitly:
skillbox patch adopt pstack --from <returned-workspace> \
  --map 'skill/references/old.md=skill/references/new.md'
```

Supply `--intent` or `--intent-file` for newly introduced changes. Capture and adopt regenerate patch artifacts through the CLI; hand-editing a committed diff does not update its lock. Re-run sync to verify the result.

This repository dogfoods PSTACK adapted for Botlake. See [the POC design and verification guide](docs/engdocs/pstack-patches.md) for provenance, adaptation scope, and the authoring helper.

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
