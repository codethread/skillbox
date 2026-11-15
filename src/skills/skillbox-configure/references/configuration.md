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

To consolidate existing tree-URL entries, first verify that they select the same repository and ref. With user approval, replace them in the config with one repository-level source selecting that ref and the union of their bundle selections. Preserve any subset objects rather than replacing them with whole-bundle strings. Preserve the lockfile, run `skillbox sync`, and require successful hash verification before committing. Do not re-add already-installed skills under a new source string; this can raise `SKILL_NAME_COLLISION`. This is a deliberate config-only regrouping, not a general repair or update procedure.

## Tracking files

A config selecting a whole bundle and a subset from a local source looks like:

```json
{
	"sources": [
		{
			"source": "../team-skills",
			"bundles": ["base", { "bundle": "review", "skills": ["deslop"] }]
		}
	]
}
```

`skillbox/config.json` accepts only `sources`, whose entries contain a nonempty `source` and a nonempty `bundles` array. Local paths resolve from the selected workspace root. Git sources retain their source string. Each `bundles` entry is one of:

- A bundle-name string, which selects every skill in that bundle.
- An object containing exactly `bundle` and `skills`. `bundle` is the bundle name. `skills` is a nonempty array of nonempty, exact skill names within that bundle, not paths or patterns.

An unknown selected name fails before installation publication. Each selected skill includes its complete directory, supporting files, and executable modes. Skillbox does not infer dependencies from references to other skills. Only selected names participate in new installation collisions and receive installation lock entries. Existing installed names remain reserved until sync removes them.

Use `add` for the first native installation. Config alone cannot bootstrap a missing lock. Once both tracking files exist, sync applies selection edits. Newly selected skills receive lock entries, and deselected managed skills and their entries are removed. Replace a subset object with its bundle-name string to select the whole bundle, or edit `skills` to expand or reduce the subset. Adding another bundle preserves existing objects; re-adding a selected bundle never widens it or applies pending selection edits.

An empty `sources` array removes all managed skills. Config formatting and retained lock entries are preserved; retained skill contents must still match their saved hashes. Sync reports `installed`, `unchanged`, and `removed` skill counts and refuses to overwrite unmanaged skills.

`skillbox/lock.json` uses the upstream SDK's format and records per-skill provenance and hashes. For native bundles, a moving Git ref or content hash is not an immutable revision pin: sync resolves their configured sources again and can fail if upstream moved. Adapted bundles additionally record a source pin under `skillbox/patches/`: an exact Git revision or a local producer content snapshot. An imported adapted bundle pins the producer, whose own lock retains the original upstream pin. Do not delete or regenerate a lock merely to silence drift errors without authorization for changed contents.

Skillbox does not read or modify the root `skills-lock.json` used by `npx skills`. Do not substitute that file for the Skillbox lock. There is no separate SDK config file to maintain.

## Select before first installation

Selection uses config and the existing commands, without new flags. Choose acquisition by source layout.

### Native source

A native source contains `skillbox/<bundle>/<skill>/SKILL.md`. If the workspace has no managed installation, first add an unrelated bundle from that source:

```sh
skillbox add ../team-skills base
```

Preserve the resulting tracking files. Add the `review` subset to config as shown above, then run `skillbox sync`. This installs `deslop` without first installing the other `review` skills. If both tracking files already exist, select the subset directly and sync.

### Raw Cursor Team Kit

A raw plugin subtree is not a native Skillbox bundle. Initialize it without installing skills:

```sh
skillbox patch init cursor-team-kit \
	--source https://github.com/cursor/plugins \
	--root cursor-team-kit \
	--skills-root skills \
	--ref main
```

Init records the source pin and creates the config entry, patch pack, and editing workspace. It creates the installation lock if needed. Before the first sync, replace only the new `"cursor-team-kit"` entry in `bundles` with:

```json
{ "bundle": "cursor-team-kit", "skills": ["deslop"] }
```

Preserve the registered source string and all other selections, then run `skillbox sync`. Only `deslop` and its supporting files enter the installation, and only `deslop` receives an installation lock entry for this bundle. Commit the config, installation lock, and patch pack for restoration in another checkout. If you edit the adaptation, follow `skillbox skills get skillbox-patch` before syncing.

## Adapted bundles and patches

A producer exports an adapted bundle through `skillbox/patches/<bundle>/bundle.toml`, its lock, and its intent-backed diffs. Import it with `skillbox add <producer-source> <bundle>`. Skillbox installs the selected materialized skills and creates a separate, empty consumer patch pack. To select a subset before importing, establish managed state with an unrelated native bundle if needed. Declare the subset in config, then run `skillbox add <producer-source> <bundle>` to import the exported bundle. A config declaration alone does not import the producer's patch pack. Existing imported packs retain their recorded producer pin. A native and adapted bundle at the same source selector is ambiguous and must be resolved at the producer.

Skillbox replays the complete adapted bundle before selecting skills. Source, hash, intent, and patch validation still cover unselected siblings. Selection changes only the local installation and its lock entries, not the pinned source or complete patch pack.

Publishing remains independent of local config selection. Native folders and complete adapted packs define exports. Selecting only `deslop` locally does not turn an exported Cursor Team Kit pack into a deslop-only bundle.

Load `skillbox skills get skillbox-patch` for the editable-workspace, capture, intent, update, and conflict workflow. `update <bundle>` stages a newer producer snapshot for an imported adaptation, not a new original-upstream revision independently. Keep generated installations separate from committed patch artifacts.

## Failure decisions

| Error | Next action |
| --- | --- |
| `WORKSPACE_NOT_FOUND` / `SOURCE_NOT_FOUND` | Correct the supplied path. Create the intended workspace separately if needed. |
| `BUNDLE_REQUIRED` / `BUNDLE_NOT_FOUND` | Check source layout and explicit bundle names; use `add --help`. |
| `CONFIG_NOT_FOUND` / `LOCK_NOT_FOUND` | Restore tracked files from version control, or use `add` for a genuinely new installation. |
| `SKILL_NOT_FOUND` | Check the reported name against the selected bundle's inventory. Use exact names, then edit config and retry. |
| `LOCK_HASH_MISMATCH` | A retained skill's contents changed. Restore the matching source/tracking files; config edits do not authorize updating existing hashes. |
| `INTENT_REQUIRED` | Annotate every blank intent named by the patch capture result, then retry sync. |
| `PRODUCER_INTENT_REQUIRED` | Ask the producer to complete its file intent before exporting; do not replace producer intent with consumer notes. |
| `PRODUCER_SNAPSHOT_UNAVAILABLE` | Restore access to the recorded producer snapshot or matching cache. For a local producer, the selected pack must match its recorded digest. Use an explicit reviewed update if adopting a different snapshot is intended. |
| `MIGRATION_REQUIRED` | Read `skillbox skills get skillbox-migrate` for a backed-up manual first-install cutover. |
| `SKILL_NAME_COLLISION` / `UNMANAGED_SKILL` | Preserve existing contents and resolve naming/ownership deliberately before retrying. |
| `CLAUDE_SKILLS_LINK_INVALID` | Inspect and preserve the existing Claude skills directory or link before resolving the conflict. |
| `PUBLISH_FAILED` | Inspect the error's retained recovery directory and current workspace before retrying; do not assume nothing changed. |

Other SDK, config, and filesystem failures also return structured errors. Use their actual code/message and affected source, skill, or input where provided; avoid blindly repeating a mutation.
