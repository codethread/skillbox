# Skillbox

Repository scaffolding for shared agent instructions and skills. No application is implemented yet.

## Setup

Install [mise](https://mise.jdx.dev/getting-started.html). Botlake uses the same named local dependencies as the dots lake: first register `ct-config` and the Botlake packages listed in [`.botlake/package.json`](.botlake/package.json) by running [`bun link`](https://bun.com/docs/pm/cli/link) from each package's directory in the Botlake checkout.

Then run from the repository root:

```sh
mise trust
mise run
```

Mise installs the pinned Bun and Node.js versions, installs tooling from the root and Botlake lockfiles, and activates the pre-commit hook. Setup is safe to repeat. Botlake dependencies stay isolated in `.botlake/`.

## Formatting

```sh
mise run fmt
mise run check
```

The pre-commit hook formats and re-stages supported staged files, including Markdown, using Oxfmt and lint-staged.

## Botlake

Install the Botlake CLI separately and ensure its supervisor is running before starting the repository lake:

```sh
botlake lake start
botlake lake info
bl help
```

Bootstrap installs Botlake dependencies but does not start or restart services. The lake uses shared `ct-config` settings for agents, flags, references, priming, Work, and Work–Agents, alongside Batteries and Identity. Use `bl help` to discover available commands. After configuration changes, run `botlake lake restart` and verify with `botlake lake info`.
