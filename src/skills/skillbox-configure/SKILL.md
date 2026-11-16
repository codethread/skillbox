---
name: skillbox-configure
description: Configure shared or personal Skillbox bundles, choose what to install or publish, restore skills, and diagnose configuration or sync failures.
---

# Configure Skillbox

Use `skillbox --help` and the selected command's `--help` for current syntax. Operational results are JSON with `success`, `data`, and `errors`; inspect failures before retrying. For unmanaged existing installations or `MIGRATION_REQUIRED`, load `skillbox skills get skillbox-migrate` first.

## Choose how to run it

Skillbox requires Node.js 22.20+ and Git. Prefer a project-local dev dependency using the project's package manager:

```sh
npm install --save-dev @codethread/skillbox
# or: bun add --dev @codethread/skillbox
# or: pnpm add --save-dev @codethread/skillbox
```

Use `npx skillbox` in a terminal or `skillbox` in package scripts, for example `"skills:sync": "skillbox sync"`. Commit the dependency manifest and package-manager lockfile. Without an npm manifest, use `npx --yes @codethread/skillbox` or `bunx @codethread/skillbox` instead; no permanent global install is needed.

## Compose, then select installation

1. Select `skillbox/config.local.json` if present, otherwise `skillbox/config.json`. Inspect its matching lock and patches, shared native bundles, `.agents/skills/`, and `.claude/skills`. Preserve unmanaged skills and existing tracking files. Before setting up personal skills, load `skillbox skills file skillbox-configure references/configuration.md` for explicit shared imports, private paths, and ignore rules.
2. Choose a destination bundle id and the source layout:

    ```sh
    # A repository exposing ordinary skill directories.
    skillbox add skills owner/toolkit development --path skills --pick review --pick testing

    # A repository exposing Skillbox bundles.
    skillbox add skillbox owner/team development --bundle coding --bundle review \
      --pick '{"coding":["typescript"]}' --omit '{"review":["legacy"]}'
    ```

3. Each command adds a contribution to `development` in the active config; several sources can contribute to the same id. Shared config includes native `skillbox/development/<skill>/SKILL.md` members automatically. Personal config includes only explicit contributions. Names must not collide. Include supporting files within each skill directory.
4. Add selects the destination in `install` by default. Use `--no-install` to contribute without changing that list. Omit `--bundle` to import all published bundles from a local or remote Skillbox source, regardless of its installation. Both source types accept `--ref`. For selectors and the config shape, load:

    ```sh
    skillbox skills file skillbox-configure references/configuration.md
    ```

5. Use `skillbox sync` to restore installed skills or reconcile approved config edits. `install` selects destination ids, not source bundles or individual skills. Removing an id from `install` removes its managed installation, not its shared publication. Ordinary sync is not an upstream update.
6. Verify `success: true`, the reported active config path, counts, installed names, supporting files, and `.claude/skills` linking to `.agents/skills`. For shared publication changes, verify that publish-only bundles remain available to a disposable consumer.

All operational commands accept `--workspace <dir>`; it selects an existing workspace directory, not a config file. It defaults to the invocation directory. Configured local source paths resolve from that workspace root; use absolute local source paths at the CLI when working across directories to avoid ambiguity.

## Ownership and next steps

An unchanged import creates no patch directory. The active config and matching lock record composition and pinned provenance. Consumers read only shared producer config, lock, and patches, independently of what the producer installs. Consumer changes and intent belong in the consumer's own patch files, not copied producer metadata.

- To author complementary skills or change an owned source, load `skillbox skills get skillbox-author`.
- To change imported instructions or review upstream updates, load `skillbox skills get skillbox-patch`. Source registration uses `add`.
- Treat `.agents/skills/` and `.claude/skills` as generated output. Edit owned sources or the path returned by patch preparation instead.

Commit shared config, lock, authored sources, and patch metadata and payloads. Keep personal config and state private. Use the ignore rules in `references/configuration.md`; Skillbox edits neither `.gitignore` nor Git's `info/exclude`. If generated paths are tracked, untrack them without deleting the installation, preserving unrelated changes.
