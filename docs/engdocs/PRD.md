# Skillbox acceptance criteria

Status: intended product behavior. Checked outcomes have fixture coverage; partial coverage is called out explicitly. Add and basic hash-checked sync now use `--workspace` and default JSON outcomes. Search, immutable revision pin creation, shared cache, and patches remain unimplemented.

## User goal

As a user, I want to install skills from other repositories into my project, pin their versions, and reproduce or update them with minimal effort. I want to customize upstream skills while retaining both my concrete changes and the intent behind them.

## Verified add slice

These checks record implementation coverage, not new acceptance criteria or completion of sync, exact pinning, cache, or patches. Fixtures run the public CLI in real disposable directories and use inline snapshots for generated payloads.

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

## Sync and updates

### Repeat sync without changes

- **Given** my installed skills match their pins and recorded patches,
- **When** I run sync repeatedly without changing those inputs,
- **Then** the installed contents remain identical, without duplicate installations or patches being applied repeatedly to already-patched files,
- **And** Skillbox avoids unnecessary network requests, downloads, and file writes wherever possible.

### Keep updates explicit

- **Given** my project pins a skill and a newer upstream revision exists,
- **When** I run ordinary sync,
- **Then** Skillbox keeps the existing pin and installs that revision rather than advancing to the newer one.

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
- **And** it records the revision actually installed without claiming that revision was verified as the latest.

### Report an unavailable pinned revision

- **Given** a required pinned revision is not cached locally,
- **When** Skillbox cannot fetch that revision,
- **Then** the operation reports the missing source rather than substituting a different revision.

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
- **Then** Skillbox reports that the patches need regeneration rather than silently dropping the customization or reporting success,
- **And** the original intent and previous patch artifacts remain available to guide regeneration.

### Regenerate a patch after an upstream rename

- **Given** my intent is to prefer interfaces over type aliases and upstream has renamed `references/strict-types.md` to `references/aliases.md`,
- **When** I ask my agent to regenerate the patches against the new revision,
- **Then** the agent preserves my intent, updates the relative target path, and generates new patch artifacts against the renamed file,
- **And** subsequent syncs reproduce the new pinned source with those patches applied,
- **And** repeating sync produces identical installed contents.

## Open design decisions

- Command syntax for add, sync, explicit updates, and patch regeneration, including whether regeneration needs an additional flag.
- Manifest, lock, cache, and per-skill patch directory layouts; exact TOML fields and patch format.
- Freshness checks, cache selection, and user-visible reporting when a new add uses cached data without verifying the latest upstream version.
- Whether still-valid patches carry forward automatically during an update or all updates require explicit patch regeneration.
- Failure boundaries: whether an unsuccessful update leaves the previous pin and installation untouched, and how failures affect other skills in the same operation.
- How to handle edits made directly to installed files rather than through recorded patches.
