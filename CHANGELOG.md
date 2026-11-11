# Changelog

<!-- Generated from src/changelog.json by bun run changelog:generate. -->

Recorded history starts at 0.1.0. Earlier development history is not included.

## 0.2.1

- Bundle recorded changelog history using @codethread/cli-changelog@0.1.0. ([b2f54ee](https://github.com/codethread/skillbox/commit/b2f54ee))

    Read release history offline with skillbox changelog. Select releases with --since or --release, page changes with --limit and --offset, request --schema, or opt into --text. The npm package includes CHANGELOG.md generated from the same history. Both the Node npm CLI and standalone binary are supported.

    **Adoption (optional):** Run skillbox changelog --since 0.2.0 to read changes since your previous version. No tracking-file migration is required from 0.2.0.

## 0.2.0

- Reconcile direct config edits during sync. ([61035fa](https://github.com/codethread/skillbox/commit/61035fa))

    Sync installs newly selected skills, removes deselected managed skills and lock entries, and preserves retained content hashes. Results report installed, unchanged and removed counts.

    **Adoption (optional):** Edit skillbox/config.json and run sync. Both tracking files must already exist; use add for the first installation. Managed installed files are generated output and can be replaced or removed.

- Bundle offline configuration and authoring guidance. ([4e04ef8](https://github.com/codethread/skillbox/commit/4e04ef8))

    Discover guidance with skills list, load instructions with skills get, retrieve supporting resources with skills file, and request response schemas with skills schema.

- Bundle manual skill migration guidance. ([2782196](https://github.com/codethread/skillbox/commit/2782196))

    Migration guidance is manual; this does not add an automated migration command.

- Expose the installed version with -v and --version. ([781bb91](https://github.com/codethread/skillbox/commit/781bb91))

- Clarify source grouping, local bundles and npm execution options. ([2a91eb0](https://github.com/codethread/skillbox/commit/2a91eb0))

    Reuse the exact source string to merge bundle selections. Ignore generated .agents/skills/ and the .claude/skills symlink in consuming projects.

## 0.1.1

- Keep lock ownership within Skillbox. ([c4f592d](https://github.com/codethread/skillbox/commit/c4f592d))

    Store the SDK-format lock at skillbox/lock.json, preserve existing entries and workspace-relative source paths, and leave the root skills-lock.json owned by npx skills untouched.

    **BREAKING:** Skillbox no longer reads its lock from the root skills-lock.json.

    **Adoption (required):** If Skillbox 0.1.0 created your root skills-lock.json, move it to skillbox/lock.json before upgrading. Do not move an unrelated npx skills lock; migration is not automatic.

## 0.1.0

- Publish the repository-local skill bundle CLI under MIT. ([977cfa9](https://github.com/codethread/skillbox/commit/977cfa9))

    Install local or Git-hosted bundles with add, record source selections and SDK lock entries, and restore matching skill contents with sync. Includes workspace selection, JSON outcomes, a prebuilt npm CLI and a standalone binary. Lock hashes check content; immutable revision replay, shared caching, updates and patches are not implemented.
