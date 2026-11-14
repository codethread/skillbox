# Sources, tracking files, and failures

## Source selection

```sh
# Run from the consuming project; ../team-skills is a sibling repository.
skillbox add ../team-skills development

# Prefer a repository URL or GitHub shorthand with explicit bundle selections.
skillbox add owner/repo frontend backend

# Reuse that exact source string to extend the same config entry.
skillbox add owner/repo testing

# A tree URL is also supported and selects a single bundle.
skillbox add https://github.com/owner/repo/tree/main/skillbox/development

# Restore a separate existing workspace.
skillbox --workspace frontend sync
```

Use the source repository root for local paths, not its `skillbox/` directory. Bundle names are single directory names containing letters, numbers, hyphens, or underscores, starting with a letter or number.

Git sources are grouped by exact source string, not repository identity. Tree URLs ending in `skillbox/frontend` and `skillbox/backend` create separate entries even for the same repository and ref; mixing a repository URL with GitHub shorthand does too. Prefer one repository-level source string plus explicit bundles when grouping is desired. Preserve the intended Git ref: sources at different refs are not interchangeable.

To consolidate existing tree-URL entries, first verify that they select the same repository and ref. With user approval, replace them in the config with one repository-level source selecting that ref and the union of their bundles. Preserve the lockfile, run `skillbox sync`, and require successful hash verification before committing. Do not re-add already-installed skills under a new source string; this can raise `SKILL_NAME_COLLISION`. This is a deliberate config-only regrouping, not a general repair or update procedure.

## Tracking files

A config selecting a local source looks like:

```json
{
	"sources": [
		{
			"source": "../team-skills",
			"bundles": ["development"]
		}
	]
}
```

`skillbox/config.json` accepts only `sources`, whose entries contain a nonempty `source` and a nonempty `bundles` array. Local paths resolve from the selected workspace root. Git sources retain their source string. Use `add` for the first installation. Once both tracking files exist, direct source/bundle edits can be applied with `sync`: newly selected skills receive lock entries, and deselected managed skills and their entries are removed. An empty `sources` array removes all managed skills. Config formatting and retained lock entries are preserved; retained skill contents must still match their saved hashes. Sync reports `installed`, `unchanged`, and `removed` skill counts and refuses to overwrite unmanaged skills.

`skillbox/lock.json` uses the upstream SDK's format and records per-skill provenance and hashes. For native bundles, a moving Git ref or content hash is not an immutable revision pin: sync resolves their configured sources again and can fail if upstream moved. Adapted bundles additionally record an immutable pin under `skillbox/patches/`. Do not delete or regenerate a lock merely to silence drift errors without authorization for changed contents.

Skillbox does not read or modify the root `skills-lock.json` used by `npx skills`. Do not substitute that file for the Skillbox lock. There is no separate SDK config file to maintain.

## Adapted bundles and patches

Import a Git source with a skills subtree into a locally named bundle:

```sh
skillbox patch init pstack --source https://github.com/cursor/plugins \
  --root pstack --skills-root skills --ref <commit> --update-ref main
skillbox patch prepare pstack --output .skillbox-prepare-pstack
```

`--ref` chooses the imported revision; `--update-ref` chooses what a later explicit update resolves. The resulting pin is an exact Git commit. `init` installs the skills and creates `skillbox/patches/pstack/bundle.toml` and `lock.json`. Only the selected skills subtree is distributed; other source files remain available for authoring context.

`prepare` returns `data.workspace` and `data.editable`. Preserve the workspace manifest and `pristine/`; edit only distributed skill files under `edited/`. To include source documentation outside the skills subtree, copy it into a skill's supporting resources and update its links.

```sh
skillbox patch capture pstack --from .skillbox-prepare-pstack \
  --intent "Use this project's Botlake agents and work records for coordination."
skillbox sync
```

Use `--intent-file <file.toml>` when different files have different reasons:

```toml
[[change]]
skill = "poteto-mode"
target = "./references/botlake-tools.md"
intent = "Map runtime operations to the lake's discovered capabilities."
```

Capture supports nested file edits, additions, deletions, binary content, and executable mode changes. `--skill <name>` limits capture to a skill. Commit the config, SDK lock, and entire `skillbox/patches/<bundle>/` pack. Keep generated installations and prepared workspaces ignored. Do not hand-edit a concrete diff to bypass the recorded hash; capture it through the CLI.

Ordinary sync reconstructs the pinned source plus recorded diffs. It does not interpret intent, invoke an agent, or advance the pin. Verified source snapshots use the XDG cache directory or `SKILLBOX_CACHE_DIR`. A warm adapted source cache supports offline replay; a cold cache needs the exact commit from the repository. Native sources may still require network access.

`skillbox update <bundle>` resolves `update_ref`; `--ref <revision>` overrides it. A clean replay publishes the refreshed installation and locks. `UPDATE_CONFLICT` preserves the existing installation and tracking files and returns `data.workspace`, `data.editable`, and conflict details. Read the current per-file intents, revise the returned edited tree for the new source, and run:

```sh
skillbox patch adopt pstack --from <returned-workspace>
# Preserve intent across an upstream rename:
skillbox patch adopt pstack --from <returned-workspace> \
  --map 'skill/references/old.md=skill/references/new.md'
```

Supply intent for new changes with `--intent` or `--intent-file`. After adoption, run sync and confirm an unchanged result. Preserve the regeneration workspace until the result is verified.

## Failure decisions

| Error | Next action |
| --- | --- |
| `WORKSPACE_NOT_FOUND` / `SOURCE_NOT_FOUND` | Correct the supplied path. Create the intended workspace separately if needed. |
| `BUNDLE_REQUIRED` / `BUNDLE_NOT_FOUND` | Check source layout and explicit bundle names; use `add --help`. |
| `CONFIG_NOT_FOUND` / `LOCK_NOT_FOUND` | Restore tracked files from version control, or use `add` for a genuinely new installation. |
| `LOCK_HASH_MISMATCH` | A retained skill's contents changed. Restore the matching source/tracking files; config edits do not authorize updating existing hashes. |
| `MIGRATION_REQUIRED` | Read `skillbox skills get skillbox-migrate` for a backed-up manual first-install cutover. |
| `SKILL_NAME_COLLISION` / `UNMANAGED_SKILL` | Preserve existing contents and resolve naming/ownership deliberately before retrying. |
| `CLAUDE_SKILLS_LINK_INVALID` | Inspect and preserve the existing Claude skills directory or link before resolving the conflict. |
| `PUBLISH_FAILED` | Inspect the error's retained recovery directory and current workspace before retrying; do not assume nothing changed. |

Other SDK, config, and filesystem failures also return structured errors. Use their actual code/message and affected source, skill, or input where provided; avoid blindly repeating a mutation.
