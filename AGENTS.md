# Skillbox

- Bun typescript project using oxfmt and oxlint.
- Write unit tests to help shape and validate, delete once finished.
- Write blackbox tests to verify the system as a user would.
- Run `mise run` from the repository root to install pinned tools, workspace dependencies, and Git hooks. `mise run check` covers the full workspace; `bun run --filter skillbox-lake check` targets the lake package.

## Features

If not working from a pre-assigned task, study [PRD](./docs/engdocs/PRD.md).  
Keep this in sync with your new behavior and ensure behaviour is verified as a user would use it.

### PRD

Only add/edit/remove AC with explicit user agreement. AC must be stated and all conflicting AC's must also be discussed and agreed on intended scope before changing.

### PHILOSOPHY

Before editing PRD.md ALWAYS read [PHILOSOPHY](./docs/engdocs/PHILOSOPHY.md) and ensure all changes are in alignment. Implementation and review agents must reject a violation of this intent.

read-only work, or implementation of AC's does not require this check.

## Development cycle

1. build (make it work)
2. refactor (remove cruft, needless code, improve readability, minimise abstractions)
3. smoke test against a real disposable db (you can may build up seeding scripts in VCS to help, keep them well documented)
4. fix -> back to `1` as needed
5. delete tests
6. align and prune docs

## Shared skill adaptations

Skillbox is the tool; this repository also produces the shared CT-Botlake PSTACK adaptation. Write distributed skills for consuming projects, not only this checkout. Route edits to the owner's local skill source, a consumer-owned patch of an imported adapted bundle, or the shared maintainer as appropriate. Do not require consumers to own the producer's patches or use Skillbox checkout paths. Personal modes and local overlays are optional; retain PSTACK's verification creators and maintainers.

## Doc guidance

- best docs are no docs, build on good DDD with well structured modules and folders.
- Keep maintainer docs in `docs/engdocs/`, indexed by [docs/engdocs/index.md](docs/engdocs/index.md). User-facing usage belongs in [README.md](README.md).
- Extension-specific user guidance belongs in that extension's `README.md`.
- Keep indexes to links.
