# Skillbox acceptance criteria

Status: intended product behavior, not a description of the current implementation. CLI syntax, storage layout, and TOML schema remain to be designed.

## User goal

As a user, I want to install skills from other repositories into my project, pin their versions, and reproduce or update them with minimal effort. I want to customize upstream skills while retaining both my concrete changes and the intent behind them.

## Repository-local installation and provenance

- Skills install into the consuming repository, rather than requiring a mix of globally and locally installed packages.
- Each installed skill has recorded provenance: its source repository, location within that repository, and pinned version.
- The pin identifies an exact source revision, so subsequent installs can reproduce the same source contents.
- Another project can consume the same source revision without depending on the first project's installed files.

## Sync and updates

- Sync materializes the pinned upstream skill and applies any recorded patches.
- Repeating sync with unchanged inputs produces the same installed contents, without duplicate installations or repeatedly applying a patch to already-patched files.
- Sync does not advance an existing version pin merely because a newer upstream version exists.
- Updating the pinned version is an explicit user action. Whether this is a separate command or a sync flag is undecided.
- Unchanged syncs avoid unnecessary network requests, downloads, and writes wherever possible.

## Shared local cache

- Downloaded source versions are cached on the user's machine and reusable across consuming repositories.
- Given project A has fetched a source revision, project B can install that same revision from the cache without downloading it again.
- Sync can run offline when the pinned source revision and all required skill files are cached locally.
- For a new add without a pin, the desired behavior is to check for the latest upstream version when possible, while allowing installation from the cache if the network or source host is unavailable.
- A cache-backed installation records the revision actually installed; it must not claim an unverified cached version is the latest.
- If the required revision is not cached and cannot be fetched, the operation reports the missing source rather than substituting a different revision.

The freshness policy for new adds and the choice among cached versions remain open decisions.

## Intent-backed patches

- A skill can contain `SKILL.md` and multiple supporting files; customization is not limited to `SKILL.md`.
- Each customized skill has a patch directory that can contain multiple patch files, with TOML metadata connecting concrete changes to their intent.
- Intent is human-readable guidance for an agent, including what should change and why.
- Target paths are relative to the distributed skill root, such as `./references/strict-types.md`, not absolute filesystem paths or source-host URLs.
- An agent can record the user's intent in the TOML metadata and create the concrete patch artifacts alongside it. Intent alone is not an executable patch.
- The patch directory and metadata are repository-local artifacts that can be version-controlled with the consuming project.
- Ordinary sync starts from the pinned original source and applies the concrete recorded patches. It does not require an agent to reinterpret prompts on every run.

### Example

An upstream TypeScript skill includes `SKILL.md` and `references/strict-types.md`. The user wants the skill unchanged except for guidance recommending type aliases.

The agent records intent equivalent to:

> In `./references/strict-types.md`, change the guidance to prefer interfaces over type aliases because this project standardizes on interfaces.

The agent then creates the corresponding patch. Sync reproduces that customization over the pinned upstream source.

## Updating a patched skill

- After an explicit upstream version update, patches must be checked against the new source.
- If a patch no longer applies, sync must not silently drop the customization or report the skill as successfully patched.
- The original intent and previous patch artifacts remain available to guide regeneration.
- An agent can inspect the new upstream structure and regenerate the skill's patch artifacts while preserving the user's intent.
- For example, if upstream renames `references/strict-types.md` to `references/aliases.md`, the agent can update the target path and generate a new patch against that file.
- Once regeneration is complete, sync reproduces the new pinned source with the regenerated patches, and repeated syncs remain idempotent.

Whether regeneration requires an explicit flag or a separate workflow remains undecided. Skillbox applying patches and an agent regenerating patches are distinct responsibilities.

## Open design decisions

- Command syntax for add, sync, explicit updates, and patch regeneration.
- Manifest, lock, cache, and per-skill patch directory layouts; exact TOML fields and patch format.
- Freshness checks, cache selection, and user-visible reporting when a new add uses cached data without verifying the latest upstream version.
- Whether still-valid patches carry forward automatically during an update or all updates require explicit patch regeneration.
- Failure boundaries: whether an unsuccessful update leaves the previous pin and installation untouched, and how failures affect other skills in the same operation.
- How to handle edits made directly to installed files rather than through recorded patches.
