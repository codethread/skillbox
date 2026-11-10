# Repository instructions

## Setup and verification

- Install mise, then run `mise trust` and `mise run` from the repository root.
- `mise run fmt` formats supported files; `mise run check` checks formatting.
- No application, build, or test suite exists yet. Do not add placeholder commands.

## Layout and conventions

- `AGENTS.md` is canonical; `CLAUDE.md` links to it.
- `.agents/skills/` holds repository skills; `.claude/skills` links to it.
- `.husky/pre-commit` runs lint-staged to format supported staged files.
- Keep root tooling dependencies in `package.json` and `bun.lock`. Botlake dependencies and their lockfile live in `.botlake/`.

## Agent tracking

Use the repository's Botlake lake for agent tracking. Read `bl prime work` before work tracking and `bl prime OP` before unfamiliar operations. Inspect `botlake lake info` for the active configuration and extension documentation, and `bl help` for available operations. Configuration uses the shared `ct-config` package; its named `link:` dependencies must be registered from the Botlake checkout before bootstrap.
