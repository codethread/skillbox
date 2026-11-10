# Skillbox

Repository-local skill bundles for agents.

## Add local bundles

From this checkout, install the included development bundle into a disposable client:

```sh
bun install --frozen-lockfile
source_repo="$PWD"
client=$(mktemp -d /tmp/skillbox-demo-XXXXXX)
(cd "$client" && bun run "$source_repo/src/cli.ts" add "$source_repo" development)
```

Bundles live under `skillbox/<bundle>/<skill>/SKILL.md`. The command copies each selected skill and its supporting files into the client's `.agents/skills/` and links `.claude/skills` to it. Unmanaged skill paths and name collisions are rejected without overwriting their contents.

Two files record the installation; commit both:

- `skillbox/config.json` records source repositories and requested bundles. Source paths are relative to the workspace root.
- `skills-lock.json` is Vercel's native project lock, written by the SDK. It records per-skill source information, content hashes, and copy mode. Local directory hashes are **not immutable revision pins**.

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

### Workspace config override

```sh
bun run src/cli.ts --config frontend/skillbox/config.json add ../my-skills development
bun run src/cli.ts --config backend/skillbox/config.json add ../my-skills development
```

The workspace root is the parent of the config file's containing directory. In these examples, the existing `frontend/` and `backend/` directories each get their own `.agents/skills/`, `.claude/skills` link, config, and SDK lockfile. `--config` accepts relative or absolute paths. Source arguments are resolved from the invocation directory, then saved relative to the workspace root.

Remote sources, exact revision pins, restoring from config (`sync`), automatic ignores, migration, patches, and multi-workspace orchestration are not implemented yet.

Vercel's library API is not in the current npm release. Until it ships, `skills` is pinned to an upstream Git commit, `tsconfig.json` maps its public entry to source, and its unbundled runtime dependencies are installed directly.

Run `bun run skillbox add --help` for usage, `bun test` for the real-filesystem black-box tests, or `mise run check` for all checks.

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
