# Skillbox acceptance criteria

These criteria define Skillbox's intended behavior. Release history belongs in [CHANGELOG.md](../../CHANGELOG.md).

## User goal

As a user, I want to compose publishable bundles from upstream and locally authored skills, independently choose which bundles my project installs, and reproduce or explicitly update pinned sources with minimal effort. I want to customize upstream skills while retaining both my concrete changes and the intent behind them. I want to try personal skills without changing my team's shared setup.

## Common CLI contract

### Run in a project

- **Given** my project uses npm, Bun, or pnpm,
- **When** I install `@codethread/skillbox` as a development dependency,
- **Then** I can run Skillbox through project scripts without a global installation.

- **Given** my project has no `package.json`,
- **When** I invoke Skillbox through `npx @codethread/skillbox` or `bunx @codethread/skillbox`,
- **Then** I can manage repository-local skills without creating an npm project.

### Select a workspace

- **When** I run an operational command with `--workspace <dir>`,
- **Then** `<dir>` selects the workspace for installed skills, the active config, and lockfiles, rather than selecting a config file,
- **And** relative directories are resolved from the invocation directory; absolute directories are supported,
- **And** omitting the option selects the current directory.

- **When** I run a command that uses workspace configuration,
- **Then** `skillbox/.local/config.json` is active if present, otherwise `skillbox/config.json` is active,
- **And** Skillbox does not automatically merge the two configs,
- **And** local config includes only explicit contributions, with shared native and composed bundles available through a normal Skillbox import of `"."`.

### Keep lock ownership separate

- **When** Skillbox manages a workspace installation,
- **Then** Skillbox stores its lockfile within that workspace's `skillbox/` directory,
- **And** it uses `skillbox/.local/lock.json` for local config and `skillbox/lock.json` for shared config,
- **And** one ignored `skillbox/.local/install-state.json` tracks the physical installation across both configs,
- **And** it does not read or modify the root `skills-lock.json` used by `npx skills`.

- **Given** local config is active,
- **When** I add, sync, prepare, capture, or update,
- **Then** changes use the private lock and `skillbox/.local/patches/` as applicable,
- **And** shared config, lock, and patches remain unchanged,
- **And** both configs use `skillbox/.prepare/`, with prepared manifests retaining workspace and config ownership.

- **Given** I keep personal config and state out of version control,
- **When** I set up ignore rules,
- **Then** one `skillbox/.local/` ignore pattern covers private config, lock, patches, and installation state, and `skillbox/.prepare/` covers preparation for both configs,
- **And** Skillbox does not edit `.gitignore` or Git's `info/exclude` automatically.

### Return explicit JSON outcomes

- **When** an operational command completes, including when it fails,
- **Then** stdout contains a concise JSON response with an explicit `success: true` or `success: false`,
- **And** failures include structured errors identifying the affected source, skill, or input where applicable,
- **And** failure information is never available solely through prose diagnostics or an exit code.

### Report confirmed mutation effects

- **When** a command changes project state or determines that no changes are needed,
- **Then** its JSON response reports confirmed effects, including unchanged or no-op outcomes, and identifiers needed for the next action,
- **And** mutators report the selected config path,
- **And** it does not dump configuration or lockfile contents by default.

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

Partial-result reporting does not authorize continuing mutations after a failure or imply rollback.

## Agent guidance and release history

### Read offline agent guidance

- **When** I use `skillbox skills list/get/file`,
- **Then** I can discover bundled configuration, authoring, migration, and patch guidance without network access,
- **And** listing returns bounded metadata while skill bodies and supporting files are retrieved explicitly,
- **And** bundled guidance is distinct from searching installed workspace skills.

### Read recorded release history

- **When** I run `skillbox changelog`,
- **Then** I can read offline release history, select a version, and retrieve changes in bounded pages,
- **And** breaking changes and adoption steps are explicit,
- **And** JSON responses, response schemas, and optional text rendering are available,
- **And** the packaged `CHANGELOG.md` is generated from the same recorded history.

## Repository-local composition, installation, and provenance

### Add a contribution to a destination bundle

- **Given** a source provides raw skill directories or publishable Skillbox bundles,
- **When** I run `add skills <source> <id> --path <directory>` or `add skillbox <source> <id> [--bundle <upstream-id> ...]`,
- **Then** Skillbox records a contribution to destination `<id>` in the active config,
- **And** both commands accept an optional `--ref` and select the destination for installation by default,
- **And** `--no-install` leaves the installation list unchanged.

Config has `{sources: Contribution[], install: string[]}`. A contribution has `type`, destination `id`, `source`, and optional `ref`. Raw `skills` contributions require `path`. Skillbox contributions may specify upstream `bundles`; omitting that field or CLI `--bundle` selects every published source bundle. This applies to local and remote sources independently of the producer's `install` list. Existing pick/omit, collision, and pin rules still apply.

### Select incoming skills

- **Given** a contribution contains multiple skills,
- **When** I pick or omit exact skill names,
- **Then** selection applies to that incoming contribution before composition and includes each selected skill's complete supporting files,
- **And** raw `skills` contributions accept either `pick: string[]` or `omit: string[]`, never both,
- **And** `skillbox` contributions accept pick/omit maps from requested upstream bundle ids to skill-name lists, with no bundle in both maps,
- **And** missing names and selectors for unrequested upstream bundles fail rather than silently changing the selection.

Raw CLI selectors repeat (`--pick a --pick b`, or `--omit x`). Skillbox CLI selectors are JSON maps (`--pick '{"B":["a"]}' --omit '{"A":["x"]}'`). Omitting selectors includes all incoming skills. Names refer to `SKILL.md` names; original directory names and supporting files are preserved.

### Compose physical and virtual contributions

- **Given** multiple contributions use the same destination id,
- **When** Skillbox resolves that bundle,
- **Then** it combines their selected skills,
- **And** shared composition also includes native `skillbox/<id>/<skill>/SKILL.md` members, so a physical directory and shared virtual contributions form one bundle,
- **And** local config receives shared native members only through explicit imports,
- **And** local Skillbox sources can reference other native or composed bundles,
- **And** composition cycles and skill-name collisions fail rather than choosing a winner.

### Publish independently of installation

- **Given** a repository defines native or composed bundles,
- **When** another project imports one of those bundles,
- **Then** its export is determined by native members and shared configured contributions, not the producer's `install` list,
- **And** imports read only shared producer config, lock, and patches, including same-repository imports, without consulting personal state,
- **And** a repository may publish more bundles than it installs, including installing none,
- **And** a native-only producer needs no config,
- **And** the consumer receives the composed output with producer-owned patches applied.

Shared config defines publication as well as installation. Personal composition is not published.

### Select local installation

- **Given** my active configuration exposes destination bundle ids,
- **When** I choose ids in the distinct `install` list and run sync,
- **Then** only those bundles' skills enter the managed installation,
- **And** deselecting a bundle removes its managed installation without removing its export,
- **And** collisions between installed bundles fail rather than overwriting skills.

- **Given** I have synced a personal configuration,
- **When** I remove `skillbox/.local/config.json` from its active path and sync,
- **Then** Skillbox reconciles the physical installation to shared config,
- **And** restoring that file and syncing restores the personal selection without deleting its private lock, patches, or installation state.

### Reconcile configuration edits

- **Given** I edit source contributions or the installation list in the active config,
- **When** I run sync,
- **Then** Skillbox installs newly selected skills, removes deselected managed skills, and reconciles its lock with that configuration,
- **And** retained Git sources keep their pins unless I explicitly update them.

- **Given** I create a personal config without a private lock,
- **When** I sync that personal config for the first time,
- **Then** Skillbox resolves its own direct source pins into the private lock,
- **And** shared producer locks and patched output remain authoritative for imports,
- **And** later contributions with missing Git pins require `add`, rather than ordinary sync resolving new pins.

### Preserve unrelated skills

- **Given** my workspace contains skills outside the managed installation,
- **When** I add or sync bundles,
- **Then** those skills remain unchanged,
- **And** a collision with an unmanaged skill fails rather than overwriting it.

### Publish an external skill by reference

- **Given** an external Git source contains a skill I want to publish,
- **When** I select that skill without modifying it,
- **Then** the committed config and root lock record its source, immutable Git revision, and selection without copied upstream skill files,
- **And** an unchanged import creates no patch directory,
- **And** first customization adds per-skill patch metadata and payloads alongside that same registered contribution, without a source-layout conversion.

### Install an external skill

- **Given** an external repository contains a skill with `SKILL.md` and supporting files,
- **When** I add it to a bundle selected for installation,
- **Then** its complete files install into my project without requiring a global skill installation,
- **And** the active config's lock records immutable Git source pins and flattened member provenance, including source locations,
- **And** fetched Git revisions use the shared local cache.

Filesystem-path sources are live local worktrees for owned authoring. Remote Git sources and `file://` Git sources use immutable revisions; a live local path is not an immutable pin.

### Reproduce a pinned installation

- **Given** my project records a Git source and pinned revision,
- **When** I sync in a fresh checkout,
- **Then** Skillbox installs that exact revision with recorded patches rather than following a moving ref,
- **And** a pinned Skillbox producer contributes its native members, locked dependencies, and producer patches independently of its installation list,
- **And** consumer patches and intent remain consumer-owned rather than copying producer patch metadata.

## Skill information and migration

### Inspect a skill's provenance and original contents

- **Given** my project records a skill's source and revision,
- **When** I request information about that skill,
- **Then** I receive concise provenance identifying its source, location, and revision,
- **And** I can explicitly retrieve the original skill body and supporting files at that revision.

### Migrate existing authored skills

- **Given** my project contains authored skill directories or symlinks,
- **When** I migrate them into Skillbox management,
- **Then** my authored content is preserved as repository-local source,
- **And** tracked source is distinct from generated agent installations,
- **And** the migration accounts for Git tracking and ignore setup for those sources and generated outputs.

## Search installed skills

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

### Repeat an add without changes

- **Given** a contribution and its installation selection are already recorded,
- **When** I repeat the same add without changing its inputs,
- **Then** Skillbox reports an unchanged outcome without duplicate contributions or unnecessary file writes.

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
- **When** I explicitly request an update for its composed bundle,
- **Then** Skillbox stages a candidate without accepting its pins or installing it,
- **And** recorded patches are checked against the candidate for review,
- **And** capture accepts the reviewed candidate pins and changes, after which sync installs the result.

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

Source registration uses `add`. Prepare/capture/update operate on the active config's composed destination bundle. Per-skill `patch.toml` records file intent, and `changes/` stores ordered patch payloads. Shared patches live at `skillbox/patches/<id>/<skill>/`; personal patches use `skillbox/.local/patches/<id>/<skill>/`. Pins and flattened provenance belong in the matching lock.

Producer intent describes producer-owned changes; consumers keep only their additional changes and reasons. Optional collection-wide rationale belongs in ordinary repository prose and does not replace per-file intent or introduce another schema.

### Record intent and concrete changes

- **Given** an upstream TypeScript skill includes `SKILL.md` and `references/strict-types.md`, which recommends type aliases,
- **When** I ask my agent to prefer interfaces in that reference because my project standardizes on interfaces,
- **Then** the agent records what should change and why in TOML metadata within a repository-local patch directory for that skill,
- **And** the target is recorded relative to the distributed skill root as `./references/strict-types.md`, not as an absolute filesystem path or URL,
- **And** the agent creates concrete patch artifacts alongside the metadata, leaving the rest of the skill unchanged,
- **And** shared metadata and patch artifacts can be version-controlled with my project, while personal patches remain private.

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

- Command/flag design for info, automated migration, search retrieval, and detailed disclosure.
- Freshness checks and cache selection for a new add; cached-but-not-verified reporting follows the criteria above.
- Transaction and rollback boundaries for mutations, and how failures affect other skills in the same operation. Staged updates do not accept pins or change installations; capture accepts reviewed candidates.
- How to handle edits made directly to installed files rather than through recorded patches.
