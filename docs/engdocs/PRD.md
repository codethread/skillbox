# Skillbox acceptance criteria

Status: `@codethread/skillbox@0.1.0` is published under MIT. The first slice delivers add, basic hash-checked sync, optional `--workspace`, and default JSON outcomes. Checked outcomes have fixture coverage; partial coverage is called out explicitly. Immutable Git revision capture/replay, shared/offline cache, explicit updates, migration, info/search, patches, and the remaining response-disclosure/failure contracts are not complete.

## User goal

As a user, I want to install skills from other repositories into my project, pin their versions, and reproduce or update them with minimal effort. I want to customize upstream skills while retaining both my concrete changes and the intent behind them.

## First shipped slice — 0.1.0

Release: [npm package](https://www.npmjs.com/package/@codethread/skillbox/v/0.1.0) and [MIT-licensed source tag](https://github.com/codethread/skillbox/tree/v0.1.0).

These checks record implementation coverage, not new acceptance criteria or completion of every scenario below. The 15 persisted black-box tests run the public CLI in real disposable directories and use inline snapshots for generated payloads.

Release smoke checks additionally verified tarball installation through npm, `"skills:sync": "skillbox sync"` in a consuming project's scripts, and the published `bunx @codethread/skillbox sync` in a directory without `package.json`. Those are manual release checks recorded in Botlake publish task `225-slab-send`, not additional automated fixtures.

- [x] Record requested sources and bundles in `skillbox/config.json`, and use the SDK to write native `skills-lock.json`: [config and lock fixture](../../tests/add.test.ts#L90).
- [x] Install Git sources without an npm package: [Git-source fixture](../../tests/add.test.ts#L676). A GitHub tree URL also implies its bundle, as exercised by this repository's [dogfood config](../../skillbox/config.json) and [SDK lock](../../skills-lock.json).
- [x] Anchor outputs and lockfiles to the config-selected workspace through `--workspace <dir>` (with `skillbox/config.json` implied), rather than the invocation directory: [frontend/backend fixture](../../tests/add.test.ts#L483) and [absolute workspace fixture](../../tests/add.test.ts#L600).
- [x] Make repeated adds write-free: [repeated-add fixture](../../tests/add.test.ts#L283). This does not verify sync idempotence.
- [x] Return concise JSON for add, unchanged outcomes, and actionable failures: [add response fixtures](../../tests/add.test.ts#L90) and [command-argument fixture](../../tests/cli.test.ts#L40).
- [x] Restore missing generated skills without changing config/lock contents, then leave repeated sync write-free: [fresh-checkout sync fixture](../../tests/sync.test.ts#L26).
- [x] Reject source drift instead of advancing lock hashes: [hash-mismatch fixture](../../tests/sync.test.ts#L80).
- [x] Preserve existing skill contents and lock entries when adding [another bundle](../../tests/add.test.ts#L330) or [another source](../../tests/add.test.ts#L413).
- [x] Keep local source paths portable when publishing the SDK lock out of staging: [multiple-source fixture](../../tests/add.test.ts#L413) and [same-repository fixture](../../tests/add.test.ts#L552).
- [x] Preserve unmanaged local skills: [shared skills fixture](../../tests/add.test.ts#L224) and [Claude directory fixture](../../tests/add.test.ts#L254). Migrating them is not implemented.

### First-slice limits

- The native lock guards skill contents, not an immutable source archive. Sync resolves configured sources and verifies their SDK-generated hashes; it does not independently replay a commit recorded in the lock. If a moving source changes the selected contents, sync fails rather than advancing the hash or recovering an older revision.
- An unchanged sync avoids publishing or rewriting installed skills and tracking files, but still fetches sources and writes disposable staging files. Network/download avoidance and offline use are not implemented.
- The prototype rebuilds differing contents within managed skill directories; it rejects extra unmanaged skill directories. Direct-edit handling and broader failure/transaction policy remain open, and direct-edit behavior has no dedicated fixture.

## Common CLI contract

Current add/sync commands support workspace selection and default JSON success/error responses. Explicit detail expansion and growing-inventory pagination are not implemented. Partial-result data plumbing exists, but reporting real partial mutations has no public CLI fixture; the failure-policy decisions below remain open.

### Select a workspace

- **When** I run an operational command with `--workspace <dir>`,
- [x] **Then** `<dir>` selects the workspace for installed skills, `skillbox/config.json`, and lockfiles, rather than selecting a config file,
- [x] **And** relative directories are resolved from the invocation directory; absolute directories are supported,
- [x] **And** omitting the option selects the current directory.

Coverage: [nested workspaces](../../tests/add.test.ts#L483), [absolute workspace from another directory](../../tests/add.test.ts#L600), and [default-directory restore](../../tests/sync.test.ts#L26).

### Return explicit JSON outcomes

- **When** an operational command completes, including when it fails,
- [x] **Then** stdout contains a concise JSON response with an explicit `success: true` or `success: false`,
- [ ] **And** failures include structured errors identifying the affected source, skill, or input where applicable,
- [x] **And** failure information is never available solely through prose diagnostics or an exit code.

Coverage: [add success](../../tests/add.test.ts#L90), [bundle/source context](../../tests/add.test.ts#L185), [invalid command arguments](../../tests/cli.test.ts#L40), and [skill hash mismatch](../../tests/sync.test.ts#L80). Structured context is **partial**: these exercised cases pass; broader filesystem/configuration/SDK failure classification is not fully verified.

### Report confirmed mutation effects

- **When** a command changes project state or determines that no changes are needed,
- [x] **Then** its JSON response reports confirmed effects, including unchanged or no-op outcomes, and identifiers needed for the next action,
- [x] **And** it does not dump configuration or lockfile contents by default.

Coverage: [add and its summary](../../tests/add.test.ts#L90), [add no-op](../../tests/add.test.ts#L283), and [sync restore/unchanged summaries](../../tests/sync.test.ts#L26). This does not verify a partially committed mutation.

### Disclose detail on demand

- **When** I run an operational command without requesting expanded details,
- **Then** its response contains the information needed for the next action,
- **And** full skill bodies, supporting-file contents, and detailed diagnostics require explicit expansion,
- **And** this does not omit required matching text, locations, hidden status, or actionable error information.

### Bound growing result collections

- **When** a command returns a growing collection of results,
- **Then** it supports bounded retrieval and explicitly indicates whether more results remain,
- **And** any remaining results can be retrieved without silent truncation.

### Report partial outcomes honestly

- **Given** an operation has both confirmed results and failures,
- **When** it returns its JSON response,
- **Then** it returns `success: false`, preserves available result data, and identifies failed or incomplete items,
- **And** it does not present partial completion as complete success.

This response contract does not define rollback or transaction boundaries, or authorize continuing mutations after a failure. Those failure-policy decisions remain open.

## Repository-local installation and provenance

### Install an external skill

- **Given** an external repository contains a skill with `SKILL.md` and supporting files,
- **When** I add that skill to my project,
- [x] **Then** the skill and its supporting files are installed into my project without requiring a global skill installation: [local-source fixture](../../tests/add.test.ts#L90),
- [ ] **And** Skillbox records the source repository, the skill's location within it, and an exact source revision. **Partial:** source/bundle selections and hashes are recorded, and [Git installs](../../tests/add.test.ts#L676) also record per-skill source paths and refs. The [dogfood lock](../../skills-lock.json) tracks `main`, not an immutable revision pin,
- [ ] **And** the fetched source revision is stored in a shared local cache on my machine.

### Reproduce a pinned installation

- **Given** my project records a skill's source and pinned revision,
- **When** I sync in a fresh checkout,
- **Then** Skillbox installs the contents from that exact revision, together with any recorded patches.

**Partial:** [fresh-checkout sync](../../tests/sync.test.ts#L26) restores matching contents from the currently configured sources and preserves tracking files. Immutable lock-ref replay and recorded patches are not implemented.

## Search installed skills

These criteria describe intended behavior; search is not implemented.

### Search the current workspace by default

- **Given** skills are installed under the current directory's `.agents/skills/`,
- **When** I run `skillbox search <pattern>` without `--workspace`,
- **Then** search is limited to those local installed skills,
- **And** it does not search global installations, ancestor workspaces, or nested workspaces.

### Select a nested workspace

- **Given** separate workspaces have their own installed skills,
- **When** I run `skillbox --workspace <dir> search <pattern>`,
- **Then** search uses `<dir>/.agents/skills/`, following the common workspace selection,
- **And** a relative directory is resolved from the invocation directory; absolute directories are also supported,
- **And** only the selected workspace is searched, without discovering or combining other configs.

### Search descriptions and skill instructions

- **Given** local installed skills contain YAML descriptions and `SKILL.md` instructions,
- **When** I search without a scope flag,
- **Then** descriptions and `SKILL.md` contents are searched,
- **And** supporting files are not searched.

### Search descriptions only

- **When** I run `skillbox search --descriptions-only <pattern>`,
- **Then** only YAML description values are searched,
- **And** skill bodies, other metadata fields, and supporting files are excluded.

### Include supporting Markdown

- **When** I run `skillbox search --include-markdown <pattern>`,
- **Then** search additionally includes all supporting Markdown files recursively within each installed skill directory,
- **And** those files need not be in a directory named `references/`.

### Search all text

- **When** I run `skillbox search --all-text <pattern>`,
- **Then** search includes all text files recursively within each installed skill directory, including supporting Markdown,
- **And** binary files are skipped.

### Respect ignores within the installed-skills search root

- **Given** the selected workspace's `.agents/skills/` is the search root,
- **When** I search in any scope,
- **Then** workspace and ancestor ignore rules outside that root do not exclude installed skills,
- **And** Gitignore rules within the search root, including nested skill directories, are respected,
- **And** these rules apply even when the search root is not a Git repository.

### Surface hidden skills

- **Given** a skill declares `disable-model-invocation: true` in its YAML frontmatter,
- **When** its searched content matches,
- **Then** the skill remains in the results and is identified as hidden,
- **And** results distinguish skills that are not hidden; a missing flag means the skill is not hidden.

### Return navigable regular-expression matches

- **When** I search using a ripgrep regular expression,
- **Then** JSON results include matching text and a Vim-style `path:line:column` location for the matching file,
- **And** matches in supporting files retain the owning skill's hidden status.

### Keep search read-only

- **When** I search,
- **Then** installed skills, configuration, and lockfiles remain unchanged.

## Sync and updates

### Repeat sync without changes

- **Given** my installed skills match their pins and recorded patches,
- **When** I run sync repeatedly without changing those inputs,
- **Then** the installed contents remain identical, without duplicate installations or patches being applied repeatedly to already-patched files,
- **And** Skillbox avoids unnecessary network requests, downloads, and file writes wherever possible.

**Partial:** [repeated sync](../../tests/sync.test.ts#L26) verifies unchanged installed/tracking files and no duplicate materialization. Patches, network/download avoidance, and cached/offline restoration are not covered or implemented by this slice.

### Keep updates explicit

- **Given** my project pins a skill and a newer upstream revision exists,
- **When** I run ordinary sync,
- **Then** Skillbox keeps the existing pin and installs that revision rather than advancing to the newer one.

**Partial:** [source drift](../../tests/sync.test.ts#L80) fails without changing installed contents or saved hashes. It does not demonstrate fetching an older pinned revision after the configured source moves.

### Update a pinned skill

- **Given** my project pins a skill and a newer upstream revision is available,
- **When** I explicitly request an update to that revision,
- **Then** Skillbox uses the requested revision as the new pin,
- **And** any recorded patches are checked against the new source before the skill is reported as successfully updated.

## Shared local cache

### Reuse a revision across projects

- **Given** project A has fetched a source revision into the shared local cache,
- **When** I add that same revision to project B,
- **Then** Skillbox installs it from the cache without downloading it again,
- **And** project B does not depend on project A's installed files.

### Sync offline

- **Given** my project's pinned source revisions and all required skill files are cached locally,
- **When** I run sync without network access,
- **Then** Skillbox installs those exact revisions and applies the project's recorded patches without requiring the source host.

### Check for the latest version on a new add

- **Given** I am adding a skill without an existing pin and its source host is reachable,
- **When** Skillbox resolves the version to install,
- **Then** it checks for the latest upstream version according to the freshness policy,
- **And** it records the exact revision it installs.

### Add from cache when the source host is unavailable

- **Given** a skill has a locally cached source revision and I am adding it without an existing pin,
- **When** the network is unreliable or the source host is unavailable,
- **Then** Skillbox can install a cached revision,
- **And** its JSON response identifies the installed revision as cached and not verified as the latest,
- **And** it records the revision actually installed without claiming that revision was verified as the latest.

### Report an unavailable pinned revision

- **Given** a required pinned revision is not cached locally,
- **When** Skillbox cannot fetch that revision,
- **Then** the operation returns `success: false` with a structured error identifying the missing source and required revision, rather than substituting a different revision.

## Intent-backed patches

### Record intent and concrete changes

- **Given** an upstream TypeScript skill includes `SKILL.md` and `references/strict-types.md`, which recommends type aliases,
- **When** I ask my agent to prefer interfaces in that reference because my project standardizes on interfaces,
- **Then** the agent records what should change and why in TOML metadata within a repository-local patch directory for that skill,
- **And** the target is recorded relative to the distributed skill root as `./references/strict-types.md`, not as an absolute filesystem path or URL,
- **And** the agent creates concrete patch artifacts alongside the metadata, leaving the rest of the skill unchanged,
- **And** the metadata and patch artifacts can be version-controlled with my project.

### Patch multiple files in a skill

- **Given** a skill contains `SKILL.md` and multiple supporting files,
- **When** I ask my agent to customize multiple files,
- **Then** the skill's patch directory can hold multiple patch files,
- **And** its TOML metadata connects the changes to their intent and relative target paths.

### Apply recorded patches during sync

- **Given** my project contains concrete patches for a pinned skill,
- **When** I run sync,
- **Then** Skillbox starts from the original pinned source and applies the recorded patches over it,
- **And** it does not require an agent to reinterpret the intent prompts on every run.

## Updating a patched skill

### Detect a patch that no longer applies

- **Given** my skill has recorded intent and patches against an older upstream revision,
- **When** I explicitly update to a revision where those patches no longer apply,
- **Then** Skillbox returns `success: false` with a structured error identifying the affected skill and that its patches need regeneration, rather than silently dropping the customization or reporting success,
- **And** the original intent and previous patch artifacts remain available to guide regeneration.

### Regenerate a patch after an upstream rename

- **Given** my intent is to prefer interfaces over type aliases and upstream has renamed `references/strict-types.md` to `references/aliases.md`,
- **When** I ask my agent to regenerate the patches against the new revision,
- **Then** the agent preserves my intent, updates the relative target path, and generates new patch artifacts against the renamed file,
- **And** subsequent syncs reproduce the new pinned source with those patches applied,
- **And** repeating sync produces identical installed contents.

## Open design decisions

- Remaining command/flag design for explicit updates, info, migration, search retrieval, detailed disclosure, and patch regeneration. The first-slice add/sync syntax and optional `--workspace` are implemented.
- Additional immutable-revision fields and replay semantics in config/native locks, cache and per-skill patch directory layouts, and exact TOML fields and patch format. The first-slice config and lock locations are already implemented.
- Freshness checks, cache selection, and user-visible reporting when a new add uses cached data without verifying the latest upstream version.
- Whether still-valid patches carry forward automatically during an update or all updates require explicit patch regeneration.
- Failure boundaries: whether an unsuccessful update leaves the previous pin and installation untouched, and how failures affect other skills in the same operation.
- How to handle edits made directly to installed files rather than through recorded patches.
