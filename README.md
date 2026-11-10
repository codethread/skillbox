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
bunx @codethread/skillbox add https://github.com/codethread/agents/tree/main/skillbox/dev
```

### Build from source

Build a standalone CLI, then add a GitHub bundle to your project—source skills do not need an npm package:

```sh
bun install --frozen-lockfile
bun run build
./dist/skillbox --workspace ../my-project add https://github.com/codethread/agents/tree/main/skillbox/dev
```

A tree URL pointing to `skillbox/<bundle>` implies the bundle name. Repository URLs and GitHub shorthand accept explicit bundle names, for example `skillbox add owner/repo frontend backend`. The SDK handles fetching and discovery.

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

Adding another source or bundle preserves existing installed skills and lock entries. Repeating an already-configured add performs no writes. The SDK config object stays in code; there is no second SDK config file.

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

Sync restores generated skills from the recorded config and verifies their content against the Skillbox lockfile before publishing. It does not advance the recorded hashes or refs. Repeating sync with matching installed contents reports an unchanged result.

Operational commands return JSON with explicit `success`, concise result data, and structured errors. Full skill contents and config/lockfile dumps are not included by default.

Exact revision pin creation, shared caching, automatic ignore setup in consuming projects, migration, patches, and multi-workspace orchestration are not implemented yet.

## Agent guidance

The CLI bundles offline instructions for project configuration and bundle authoring. Discover metadata first, then load only the instructions or supporting resource needed:

```sh
skillbox skills list
skillbox skills get <name>
skillbox skills file <name> <path>
```

These commands return JSON in the same `success`/`data`/`errors` envelope. `get` returns Markdown in `data.body` without frontmatter; `file` returns a selected resource in `data.content`. This reads CLI-bundled guidance, not skills installed in a workspace. `skills list --limit <count> --offset <count>` supports paging; `data.nextOffset: null` means exhausted. Use `skills schema <list|get|file>` for response schemas.

Run `skillbox --help` or `skillbox <command> --help` for command options.
