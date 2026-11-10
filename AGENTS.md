# Skillbox

- Bun typescript project using oxfmt and oxlint.
- Write unit tests to help shape and validate, delete once finished.
- Write blackbox tests to verify the system as a user would.

## Features

If not working from a pre-assigned task, study [PRD](./docs/engdocs/PRD.md).  
Keep this in sync with your new behavior and ensure behaviour is verified as a user would use it.

## Development cycle

1. build (make it work)
2. refactor (remove cruft, needless code, improve readability, minimise abstractions)
3. smoke test against a real disposable db (you can may build up seeding scripts in VCS to help, keep them well documented)
4. fix -> back to `1` as needed
5. delete tests
6. align and prune docs

## Doc guidance

- best docs are no docs, build on good DDD with well structured modules and folders.
- Keep maintainer docs in `docs/engdocs/`, indexed by [docs/engdocs/index.md](docs/engdocs/index.md). The rest of `docs/` is user-facing, indexed by [docs/index.md](docs/index.md).
- Extension-specific user guidance belongs in that extension's `README.md`.
- Keep indexes to links; only the user index needs a brief introduction to Botlake and extension authoring.
