# Skillbox

Repository-local skill bundles for agents.

## Try the POC

From this checkout, install the included development bundle into a disposable client:

```sh
bun install --frozen-lockfile
source_repo="$PWD"
client=$(mktemp -d /tmp/skillbox-demo-XXXXXX)
(cd "$client" && bun run "$source_repo/src/cli.ts" add "$source_repo" development)
```

Bundles live under `skillbox/<bundle>/<skill>/SKILL.md`. The command copies each selected skill and its supporting files into the client's `.agents/skills/` and links `.claude/skills` to it. Existing skill paths are rejected without changing their contents.

This is an initial-install POC for local sources. Repeated adds, remote sources, managed config, ignores, locks, migration, and patches are not implemented yet.

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
