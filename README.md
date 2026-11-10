# Skillbox

Repository scaffolding for shared agent instructions and skills. No application is implemented yet.

A skillbox is one source for all skills, avoid global skills. Instead import other skillboxes or patch over a popular one.

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
