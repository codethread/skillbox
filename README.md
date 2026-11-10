# Skillbox

Repository-local skill bundles for agents.

## Build and add bundles

Build a standalone CLI, then add a GitHub bundle to your project—no npm package is needed:

```sh
bun install --frozen-lockfile
bun run build
./dist/skillbox --workspace ../my-project add https://github.com/codethread/agents/tree/main/skillbox/dev
```

A tree URL pointing to `skillbox/<bundle>` implies the bundle name. Repository URLs and GitHub shorthand accept explicit bundle names, for example `skillbox add owner/repo frontend backend`. The SDK handles fetching and discovery.

Local repositories also use explicit bundle names: `skillbox add ../my-skills development`.

Bundles live under `skillbox/<bundle>/<skill>/SKILL.md`. The command copies each selected skill and its supporting files into the client's `.agents/skills/` and links `.claude/skills` to it. Unmanaged skill paths and name collisions are rejected without overwriting their contents.

Two files record the installation; commit both:

- `skillbox/config.json` records source repositories and requested bundles. Local source paths are relative to the workspace root; Git sources retain their source string.
- `skills-lock.json` is Vercel's native project lock, written by the SDK. It records per-skill source information, content hashes, copy mode, and Git refs and skill paths where available. A branch such as `main`, or a content hash by itself, is **not an immutable revision pin**.

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

`--workspace` selects a workspace directory, defaulting to the current directory; `skillbox/config.json` is implied. In these examples, the existing `frontend/` and `backend/` directories each get their own `.agents/skills/`, `.claude/skills` link, config, and SDK lockfile. Relative and absolute directory paths are supported. Source arguments are resolved from the invocation directory, then saved relative to the workspace root.

## Sync

```sh
skillbox sync
skillbox --workspace frontend sync
```

Sync restores generated skills from the recorded config and verifies their content against the SDK lockfile before publishing. It does not advance the recorded hashes or refs. Repeating sync with matching installed contents reports an unchanged result.

Operational commands return JSON with explicit `success`, concise result data, and structured errors. Full skill contents and config/lockfile dumps are not included by default.

Exact revision pin creation, shared caching, automatic ignore setup in consuming projects, migration, patches, and multi-workspace orchestration are not implemented yet.

Run `./dist/skillbox add --help` for command options.

## Setup

Install [mise](https://mise.jdx.dev/getting-started.html). Botlake uses the same named local dependencies as the dots lake: first register `ct-config` and the Botlake packages listed in [`.botlake/package.json`](.botlake/package.json) by running [`bun link`](https://bun.com/docs/pm/cli/link) from each package's directory in the Botlake checkout.

Then run from the repository root:

```sh
mise trust
mise run
```

### Botlake

Install the Botlake CLI separately and ensure its supervisor is running before starting the repository lake:

```sh
botlake lake start
botlake lake info
bl help
```
