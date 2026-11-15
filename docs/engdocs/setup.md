# Maintainer setup

The CLI builds with `bun install --frozen-lockfile` and `bun run build`. The following setup also configures this repository's maintainer tooling and Botlake lake.

Install [mise](https://mise.jdx.dev/getting-started.html). The lake installs Botlake packages and the shared `@botlake/extension-ct-config` preset from npm. The repository root owns the Bun workspace and its single committed `bun.lock`; do not install dependencies separately inside `.botlake`.

Run from the repository root:

```sh
mise trust
mise run
```

Install the Botlake CLI separately and ensure its supervisor is running before starting the repository lake:

```sh
botlake lake start
botlake lake info
bl help
```
