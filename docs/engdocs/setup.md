# Maintainer setup

The CLI builds with `bun install --frozen-lockfile` and `bun run build`. The following setup also configures this repository's maintainer tooling and Botlake lake.

Install [mise](https://mise.jdx.dev/getting-started.html). Prepare the shared private `ct-config` archive through the Botlake checkout's install task. This lake installs public Botlake packages from npm and private configuration from that packed tarball, using its committed lockfile.

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
