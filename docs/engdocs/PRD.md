# Skillbox acceptance criteria

This document records the approved contract, including composable bundles. The historical first-slice notes below are not the current config, lock, or CLI specification. Public CLI coverage verifies [composition and installation](../../tests/composition.test.ts), [patch capture and updates](../../tests/patch.test.ts), [pin, provenance, and conflict regressions](../../tests/regressions.test.ts), and the [packaged Node CLI](../../tests/packaging.test.ts).

Offline agent guidance is available through `skillbox skills list/get/file`; it is distinct from searching installed workspace skills. Recorded release history is available through `skillbox changelog` and [CHANGELOG.md](../../CHANGELOG.md).

## User goal

As a user, I want to compose publishable bundles from upstream and locally authored skills, independently choose which bundles my project installs, and reproduce or explicitly update pinned sources with minimal effort. I want to customize upstream skills while retaining both my concrete changes and the intent behind them.

## First shipped slice — 0.1.0

Release: [npm package](https://www.npmjs.com/package/@codethread/skillbox/v/0.1.0) and [MIT-licensed source tag](https://github.com/codethread/skillbox/tree/v0.1.0).

These are historical observations from 0.1.0, not verification of the current composable-bundle model. That release used source/bundle selections and SDK-format hashes, not the current contribution schema and immutable Git pins.

The first slice exercised repository-local add/sync, workspace selection, concise JSON, repeated no-op operations, separate Skillbox lock ownership, preservation of existing skills, and fresh-checkout restoration of matching source contents. Its persisted fixtures and counts described that release only.

Release smoke checks additionally verified tarball installation through npm, `"skills:sync": "skillbox sync"` in a consuming project's scripts, and published `bunx @codethread/skillbox sync` without `package.json`. Those manual checks were recorded in Botlake publish task `225-slab-send`.

### First-slice limits (historical)

- The SDK-format lock guarded contents, not immutable source replay. Moving-source drift failed rather than recovering an older revision.
- Unchanged sync avoided rewriting installed/tracking files but still fetched and staged sources; offline cache replay was not implemented in that slice.
- Managed-directory edits could be replaced; broader direct-edit and failure policies were not settled by those checks.

## Common CLI contract

Operational commands retain workspace selection and default JSON success/error responses. Explicit detail expansion and growing-inventory pagination are not implemented. Partial-result data plumbing exists, but reporting real partial mutations has no public CLI fixture; the failure-policy decisions below remain open.

### Select a workspace

- **When** I run an operational command with `--workspace <dir>`,
- [x] **Then** `<dir>` selects the workspace for installed skills, `skillbox/config.json`, and lockfiles, rather than selecting a config file,
- [x] **And** relative directories are resolved from the invocation directory; absolute directories are supported,
- [x] **And** omitting the option selects the current directory.

### Keep lock ownership separate

- **When** Skillbox manages a workspace installation,
- [x] **Then** Skillbox stores its lockfile within that workspace's `skillbox/` directory,
- [x] **And** it does not read or modify the root `skills-lock.json` used by `npx skills`.

### Return explicit JSON outcomes

- **When** an operational command completes, including when it fails,
- [x] **Then** stdout contains a concise JSON response with an explicit `success: true` or `success: false`,
- [ ] **And** failures include structured errors identifying the affected source, skill, or input where applicable,
- [x] **And** failure information is never available solely through prose diagnostics or an exit code.

### Report confirmed mutation effects

- **When** a command changes project state or determines that no changes are needed,
- [x] **Then** its JSON response reports confirmed effects, including unchanged or no-op outcomes, and identifiers needed for the next action,
- [x] **And** it does not dump configuration or lockfile contents by default.

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

## Repository-local composition, installation, and provenance

### Add a contribution to a destination bundle

- **Given** a source provides raw skill directories or publishable Skillbox bundles,
- **When** I run `add skills <source> <id> --path <directory>` or `add skillbox <source> <id> --bundle <upstream-id> ...`,
- **Then** Skillbox records a contribution to destination `<id>` in `skillbox/config.json`,
- **And** both commands accept an optional `--ref` and select the destination for installation by default,
- **And** `--no-install` leaves the installation list unchanged.

Config has `{sources: Contribution[], install: string[]}`. A contribution has `type`, destination `id`, `source`, and optional `ref`. Raw `skills` contributions require `path`; `skillbox` contributions require upstream `bundles`.

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
- **Then** it combines their selected skills with any native `skillbox/<id>/<skill>/SKILL.md` members,
- **And** a physical directory and virtual contributions with the same id form one bundle, not competing layouts,
- **And** local Skillbox sources can reference other native or composed bundles,
- **And** composition cycles and skill-name collisions fail rather than choosing a winner.

### Publish independently of installation

- **Given** a repository defines native or composed bundles,
- **When** another project imports one of those bundles,
- **Then** its export is determined by native members and configured contributions, not the producer's `install` list,
- **And** a repository may publish more bundles than it installs, including installing none,
- **And** a native-only producer needs no config,
- **And** the consumer receives the composed output with producer-owned patches applied.

Config defines composition/publication as well as installation.

### Select local installation

- **Given** my workspace defines publishable bundle ids,
- **When** I choose ids in the distinct `install` list and run sync,
- **Then** only those bundles' skills enter the managed installation,
- **And** deselecting a bundle removes its managed installation without removing its export,
- **And** collisions between installed bundles fail rather than overwriting skills.

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
- **And** root `skillbox/lock.json` records immutable Git source pins and flattened member provenance, including source locations,
- **And** fetched Git revisions use the shared local cache.

Filesystem-path sources are live local worktrees for owned authoring. Remote Git sources and `file://` Git sources use immutable revisions; a live local path is not an immutable pin.

### Reproduce a pinned installation

- **Given** my project records a Git source and pinned revision,
- **When** I sync in a fresh checkout,
- **Then** Skillbox installs that exact revision with recorded patches rather than following a moving ref,
- **And** a pinned Skillbox producer contributes its native members, locked dependencies, and producer patches independently of its installation list,
- **And** consumer patches and intent remain consumer-owned rather than copying producer patch metadata.

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

Source registration uses `add`. Prepare/capture/update operate on the composed destination bundle. Per-skill `skillbox/patches/<id>/<skill>/patch.toml` and `changes/` retain their existing file-intent and ordered-payload format. Pins and flattened provenance belong in root `skillbox/lock.json`, not a `bundle.toml` or per-source lock under patches.

Producer intent describes producer-owned changes; consumers keep only their additional changes and reasons. Optional collection-wide rationale belongs in ordinary repository prose and does not replace per-file intent or introduce another schema.

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

- Remaining command/flag design for info, automated migration, search retrieval, and detailed disclosure. Source-specific add, composed-bundle prepare/capture/update, and optional `--workspace` are specified above.
- Freshness checks, cache selection, and user-visible reporting when a new add uses cached data without verifying the latest upstream version.
- Failure boundaries: whether an unsuccessful update leaves the previous pin and installation untouched, and how failures affect other skills in the same operation.
- How to handle edits made directly to installed files rather than through recorded patches.
