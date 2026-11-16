# Contributions, installation, and tracking

## Choose a source layout

```sh
# Raw skills: path is a skills directory relative to the source repository.
skillbox add skills owner/toolkit development --path plugins/team/skills --pick review

# Omit instead of pick; raw contributions cannot use both.
skillbox add skills owner/other development --path skills --omit legacy

# Skillbox: combine upstream bundles into one destination.
skillbox add skillbox owner/team development --bundle coding --bundle review \
  --pick '{"coding":["typescript"]}' --omit '{"review":["legacy"]}'

# Compose other local bundles without selecting the destination for installation.
skillbox add skillbox . shared --bundle development --bundle local --no-install

skillbox --workspace frontend sync
```

The positional id (`development` or `shared`) names the destination bundle. `--bundle` names upstream bundles. Omit it to select all published bundles from a local or remote source, regardless of that source's installation. Both add commands accept `--ref <ref>` and `--no-install`. By default add includes the destination in `install`; `--no-install` leaves that list unchanged, including any existing selection of that id.

Use the source repository root for local sources, not its `skillbox/` directory. Configured local paths resolve from the selected workspace root. Local filesystem sources use live worktree content and reject `--ref`; use a Git source such as a `file://` repository URL when immutable Git replay is required. Git refs select the initial resolution or explicit update target; ordinary sync replays the locked commit.

Changing `ref` in config changes the future update target, not the existing pin. Repeating `add` with a different explicit ref fails with `UPDATE_REQUIRED`; use the reviewed update workflow to advance it. Repeating a contribution updates its selectors. Repeated Skillbox contributions merge named bundle requests; an all-bundles request keeps the selection at all bundles. A named request replaces selectors only for those bundles. An all-bundles request replaces all selectors.

## Config

`skillbox/config.local.json` is active when present; otherwise `skillbox/config.json` is active. Mutators report the selected path. Both files use the same schema, but they are never automatically merged.

For a personal installation, create this local config using your source's exact bundle and skill names:

```json
{
	"sources": [
		{
			"type": "skillbox",
			"id": "team",
			"source": ".",
			"omit": { "pstack": ["poteto-mode"] }
		},
		{
			"type": "skills",
			"id": "personal",
			"source": "../my-skills",
			"path": "skills"
		}
	],
	"install": ["team", "personal"]
}
```

This imports all shared bundles except `pstack`'s `poteto-mode` skill and adds skills from `../my-skills/skills/`. Run sync to install the selection. Personal config has only explicit contributions. The `"."` source uses the normal importer to read shared output, including native bundles, shared pins, and producer patches.

To switch to shared config, move `config.local.json` out of its active path and sync. Restore it and sync to return to personal config. Keep private state through both switches.

The config has two fields, `sources` and `install`.

Each contribution has `type`, destination `id`, repository/path `source`, and optional `ref`:

- `type: "skills"` requires `path`, the source-relative skills directory. Optional `pick` or `omit` is a nonempty list of exact skill names. They are mutually exclusive.
- `type: "skillbox"` accepts optional `bundles`, a nonempty list of upstream bundle ids. Omission selects all published bundles, not the producer's `install` list. Optional `pick` and `omit` map requested upstream bundle ids to nonempty lists of exact skill names. A bundle cannot appear in both maps; picking from one and omitting from another is valid.

Without selectors, a contribution includes every skill in its selected directory or bundles. Selectors use skill names, not paths or patterns. The original skill directory name need not equal its frontmatter name; preserve both. Missing selected or omitted names, selectors for unrequested bundles, and duplicate skill names in a composition fail. Selected skills include their complete supporting files and executable modes; references to other skills do not import dependencies automatically.

Multiple contributions may share an id. In shared config, native files at `skillbox/<id>/<skill>/SKILL.md` implicitly contribute to the same bundle. Personal config imports shared native members explicitly through a Skillbox source. Local Skillbox sources can reference other native or composed bundles. Composition cycles fail.

`install` is a distinct list of destination bundle ids. It never controls exports. Every shared composed id and native bundle is publishable. Personal composition is private. An empty installation list removes managed installations without removing contributions or exports. Collisions between installed bundles also fail; there is no last-writer-wins order. To publish a broader collection while installing a smaller selection, compose a separate destination with its own selectors and install only that destination.

A repository publishing only native directories needs no config. A composition producer commits its config and root lock even when it installs nothing. Downstream `add skillbox` reads shared producer config, lock, and patches, never personal config or state.

## Lock and patch ownership

Shared config uses `skillbox/lock.json` and `skillbox/patches/`. Personal config uses `skillbox/lock.local.json` and `skillbox/patches.local/`. Each lock records source pins and flattened member provenance. One `skillbox/install-state.local.json` tracks the physical installation across both configs. Keep it when switching.

The first personal sync resolves its own direct Git pins without changing shared state. Imports use the producer's shared lock and patched output; personal sync does not resolve missing producer pins. Later contributions with missing Git pins require `add`. Losing an initialized private lock is an error, not a request to resolve fresh pins. Git sources retain immutable revisions; filesystem sources remain live worktrees. Do not hand-edit or delete pins to silence an error. Skillbox does not use or modify `skills-lock.json` belonging to `npx skills`.

An unchanged import creates no patch directory and does not copy upstream source into a native bundle. To customize it, prepare the composed bundle, edit, capture, and annotate the per-file intent. Only those changes live under the active patch directory's `<id>/<skill>/patch.toml` and `changes/`.

A Git-backed consumer pins the producer revision. The producer's locked dependencies and patches determine its exported output. Consumers layer their own patches over that output; do not copy producer intent or patch payloads into consumer-owned files. Updating a producer contribution adopts the producer's reviewed output, not independently newer versions of its dependencies.

Load `skillbox skills get skillbox-patch` for preparation, capture, intent, and staged updates.

Keep personal sources outside the repository or in a separately ignored directory. Add these rules to `.gitignore`, or to Git's private `info/exclude` for a personal opt-in. Skillbox edits neither file:

```gitignore
/.agents/skills/
/.claude/skills
/skillbox/.prepare/
/skillbox/config.local.json
/skillbox/lock.local.json
/skillbox/patches.local/
/skillbox/.prepare.local/
/skillbox/install-state.local.json
```

Use no trailing slash on the `.claude/skills` symlink rule. Capture wanted edits before deleting a preparation workspace.

## Failures

Read the returned error code, message, and affected input before retrying:

- Missing source, bundle, or skill: verify the source layout and exact names; do not silently drop the selection.
- Invalid selectors or composition cycles: correct config deliberately; do not widen picks to work around the error.
- Name collisions or unmanaged installations: preserve existing files and agree on ownership/naming before retrying.
- Missing tracking files or unavailable pinned revisions: restore the tracked state or access to that revision; do not substitute a moving ref.
- Missing intent: fill the reported `patch.toml` file reasons, then retry.
- Update conflicts: retain the candidate, old patch artifacts, and intent; follow the patch update guidance.
- For a backed-up first-install cutover, use `skillbox-migrate` before changing existing installations.
- Publication/filesystem failures: inspect current workspace state and any reported recovery directory; do not assume nothing changed.
