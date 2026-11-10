# Skillbox acceptance criteria

Status: intended product behavior, not a description of the current implementation. CLI syntax, storage layout, and TOML schema remain to be designed.

## User goal

As a user, I want to install skills from other repositories into my project, pin their versions, and reproduce or update them with minimal effort. I want to customize upstream skills while retaining both my concrete changes and the intent behind them.

## Repository-local installation and provenance

### Install an external skill

- **Given** an external repository contains a skill with `SKILL.md` and supporting files,
- **When** I add that skill to my project,
- **Then** the skill and its supporting files are installed into my project without requiring a global skill installation,
- **And** Skillbox records the source repository, the skill's location within it, and an exact source revision,
- **And** the fetched source revision is stored in a shared local cache on my machine.

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
