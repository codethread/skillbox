# Changelog

All notable changes to Skillbox since 0.1.0 are documented in this file.

## 0.4.0

### Changes

- Experiment with personal skills without changing shared configuration, locks, or patches. (870c04f)

    Create skillbox/.local/config.json to select a personal installation instead of the shared configuration. Reuse the existing importers and pick/omit selectors, import "." for shared bundles, and add personal sources independently. Personal config, lock, patches, and the installation receipt live under skillbox/.local/. Producers always export shared state.

    - **Breaking:** Sync now rejects modified managed skills instead of overwriting local edits. Prepared edit manifests now bind the workspace and active config kind; preparations created by earlier versions cannot be captured directly.
    - **Adoption (optional):** To opt in, ignore /skillbox/.local/ in .gitignore or Git's private info/exclude, then create skillbox/.local/config.json and run sync. Keep /skillbox/.prepare/ ignored too. Import "." explicitly to include shared bundles. Personal config replaces shared config; it does not merge with it.
    - **Adoption (required):** Keep skillbox/.local/install-state.json when switching between shared and personal config. Move only skillbox/.local/config.json aside to return to shared mode, then run sync. Restore it and sync to resume personal mode. Existing version 2 shared locks work without recreation; the first sync bootstraps the installation receipt from the shared lock.
    - **Adoption (required):** Before upgrading, capture pending prepared edits with your current version or back up the editable files. To continue uncaptured edits after upgrading, prepare again under the intended config and transfer your edits into the new preparation. Shared and personal edits use skillbox/.prepare/; an existing preparation path fails without overwrite. Back up edits made directly to installed skills and restore the managed files before syncing.

- Import every exported Skillbox bundle when bundle selection is omitted. (870c04f)

    Omit --bundle or the bundles config field to import all shared exported bundles, including bundles the producer does not install. Named bundle selections and per-bundle pick/omit remain available.

    - **Adoption (optional):** Omit --bundle when adding a Skillbox source to consume all its exports. Keep explicit --bundle selections to limit which upstream bundles you import.

- Apply manual-only invocation policy to installed skills. (019c681)

    When the final patched SKILL.md has disable-model-invocation: true, installation sets policy.allow_implicit_invocation to false in agents/openai.yaml. Other metadata remains intact. Authored sources and patch exports do not gain generated policy files.

    - **Adoption (optional):** Run sync to apply invocation policy to existing managed installations. A missing or false disable-model-invocation flag leaves authored OpenAI metadata unchanged.

## 0.3.0

### Changes

- Compose publishable bundles from imported and locally authored skills. (d1cf4ad)

    Combine raw skill directories, selected Skillbox bundles, and native skills under a destination bundle. Select incoming skills with pick/omit, and choose local installation independently from publication with the install list. Bundled offline guidance covers configuration, authoring, and customization.

    - **Breaking:** The add command now requires add skills <source> <id> --path <directory> or add skillbox <source> <id> --bundle <bundle>.
    - **Breaking:** Configuration now uses typed source contributions with destination ids and a separate install list. The version 2 Skillbox lock replaces the previous SDK-format lock; old tracking files are not migrated automatically.
    - **Adoption (required):** Before upgrading a 0.2.x workspace, back up skillbox/config.json, skillbox/lock.json, authored sources, and installed skills including local edits. Recreate the source selections in an empty disposable workspace with the new add commands, verify the installed files, then cut over to the new configuration and version 2 lock. Keep any unrelated root skills-lock.json unchanged. Update scripts that use the old add syntax.

- Pin Git sources and customize bundles with intent-backed patches. (d1cf4ad)

    Git imports record immutable revisions and reuse a shared local cache. Ordinary sync retains pins. Prepare and capture per-skill patches with per-file intent; update stages an upstream candidate for review, capture accepts it, and sync installs it. Consumers receive producer patches and keep their own additional patches separately.

    - **Adoption (optional):** Use patch prepare <id>, patch capture <id> --from <workspace>, and update <id> for reviewed customization and updates. Commit patch.toml files and their changes payloads; ignore skillbox/.prepare/. Filesystem-path sources remain live authored worktrees rather than immutable Git pins.

- Publish shared PSTACK workflows and a pinned deslop skill through the repository. (f715f3a)

    Import the repository's pstack and deslop bundles with add skillbox codethread/skillbox workflows --bundle pstack --bundle deslop. Producer-owned workflow patches remain in the producer; consumer customizations remain consumer-owned. These bundles are distributed from Git, separately from the npm CLI.

- Consume @codethread/cli-changelog@0.1.1 from npm. (368e448)

    Replace the Git dependency with the latest published npm version, retain local Markdown changelog generation, and verify release installation with the current add syntax.

## 0.2.2

### Changes

- Update the bundled cli-changelog dependency to 0.1.1. (d0c5869)

    Bundles @codethread/cli-changelog@0.1.1 in the npm CLI and standalone executable.

## 0.2.1

### Changes

- Bundle recorded changelog history using @codethread/cli-changelog@0.1.0. (b2f54ee)

    Read release history offline with skillbox changelog. Select releases with --since or --release, page changes with --limit and --offset, request --schema, or opt into --text. The npm package includes CHANGELOG.md generated from the same history. Both the Node npm CLI and standalone binary are supported.

    - **Adoption (optional):** Run skillbox changelog --since 0.2.0 to read changes since your previous version. No tracking-file migration is required from 0.2.0.

## 0.2.0

### Changes

- Reconcile direct config edits during sync. (61035fa)

    Sync installs newly selected skills, removes deselected managed skills and lock entries, and preserves retained content hashes. Results report installed, unchanged and removed counts.

    - **Adoption (optional):** Edit skillbox/config.json and run sync. Both tracking files must already exist; use add for the first installation. Managed installed files are generated output and can be replaced or removed.

- Bundle offline configuration and authoring guidance. (4e04ef8)

    Discover guidance with skills list, load instructions with skills get, retrieve supporting resources with skills file, and request response schemas with skills schema.

- Bundle manual skill migration guidance. (2782196)

    Migration guidance is manual; this does not add an automated migration command.

- Expose the installed version with -v and --version. (781bb91)

- Clarify source grouping, local bundles and npm execution options. (2a91eb0)

    Reuse the exact source string to merge bundle selections. Ignore generated .agents/skills/ and the .claude/skills symlink in consuming projects.

## 0.1.1

### Changes

- Keep lock ownership within Skillbox. (c4f592d)

    Store the SDK-format lock at skillbox/lock.json, preserve existing entries and workspace-relative source paths, and leave the root skills-lock.json owned by npx skills untouched.

    - **Breaking:** Skillbox no longer reads its lock from the root skills-lock.json.
    - **Adoption (required):** If Skillbox 0.1.0 created your root skills-lock.json, move it to skillbox/lock.json before upgrading. Do not move an unrelated npx skills lock; migration is not automatic.

## 0.1.0

### Changes

- Publish the repository-local skill bundle CLI under MIT. (977cfa9)

    Install local or Git-hosted bundles with add, record source selections and SDK lock entries, and restore matching skill contents with sync. Includes workspace selection, JSON outcomes, a prebuilt npm CLI and a standalone binary. Lock hashes check content; immutable revision replay, shared caching, updates and patches are not implemented.
