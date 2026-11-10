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

`skillbox/config.json` accepts only `sources`, whose entries contain a nonempty `source` and a nonempty `bundles` array. Saved local paths are relative to the workspace root. Git sources retain their source string. Prefer `add` to keep config, lock, and installed contents aligned; editing only the config can make sync fail.

`skillbox/lock.json` uses the upstream SDK's format and records per-skill provenance and hashes. A moving Git ref or content hash is not an immutable revision pin. Ordinary sync resolves the configured sources again; it can fail if upstream moved rather than restoring an archived revision. Do not delete or regenerate the lock merely to silence drift errors without approval for changed contents.

Skillbox does not read or modify the root `skills-lock.json` used by `npx skills`. Do not substitute that file for the Skillbox lock. There is no separate SDK config file to maintain.

## Failure decisions

| Error | Next action |
| --- | --- |
| `WORKSPACE_NOT_FOUND` / `SOURCE_NOT_FOUND` | Correct the supplied path. Create the intended workspace separately if needed. |
| `BUNDLE_REQUIRED` / `BUNDLE_NOT_FOUND` | Check source layout and explicit bundle names; use `add --help`. |
| `CONFIG_NOT_FOUND` / `LOCK_NOT_FOUND` | Restore tracked files from version control, or use `add` for a genuinely new installation. |
| `LOCK_SKILL_MISMATCH` / `LOCK_HASH_MISMATCH` | Compare config, lock, and source changes. Restore the matching source/tracking files; an update policy needs user agreement. |
| `MIGRATION_REQUIRED` | Read `skillbox skills get skillbox-migrate` for a backed-up manual first-install cutover. |
| `SKILL_NAME_COLLISION` / `UNMANAGED_SKILL` | Preserve existing contents and resolve naming/ownership deliberately before retrying. |
| `CLAUDE_SKILLS_LINK_INVALID` | Inspect and preserve the existing Claude skills directory or link before resolving the conflict. |
| `PUBLISH_FAILED` | Inspect the error's retained recovery directory and current workspace before retrying; do not assume nothing changed. |

Other SDK, config, and filesystem failures also return structured errors. Use their actual code/message and affected source, skill, or input where provided; avoid blindly repeating a mutation.
