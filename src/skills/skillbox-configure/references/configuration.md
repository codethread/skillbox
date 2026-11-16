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

The positional id (`development` or `shared`) names the destination bundle. `--bundle` names upstream bundles. Both add commands accept `--ref <ref>` and `--no-install`. By default add includes the destination in `install`; `--no-install` leaves that list unchanged, including any existing selection of that id.

Use the source repository root for local sources, not its `skillbox/` directory. Configured local paths resolve from the selected workspace root. Local filesystem sources use live worktree content and reject `--ref`; use a Git source such as a `file://` repository URL when immutable Git replay is required. Git refs select the initial resolution or explicit update target; ordinary sync replays the locked commit.

Changing `ref` in config changes the future update target, not the existing pin. Repeating `add` with a different explicit ref fails with `UPDATE_REQUIRED`; use the reviewed update workflow to advance it. Repeating a contribution updates its selectors; repeated Skillbox contributions merge upstream bundle names and replace selectors for the bundles named in that invocation.

## Config

```json
{
	"sources": [
		{
			"type": "skills",
			"id": "development",
			"source": "owner/toolkit",
			"path": "plugins/team/skills",
			"ref": "main",
			"pick": ["review"]
		},
		{
			"type": "skillbox",
			"id": "development",
			"source": "owner/team",
			"bundles": ["coding", "review"],
			"pick": { "coding": ["typescript"] },
			"omit": { "review": ["legacy"] }
		}
	],
	"install": ["development", "local"]
}
```

The config has two fields: `sources` and `install`.

Each contribution has `type`, destination `id`, repository/path `source`, and optional `ref`:

- `type: "skills"` requires `path`, the source-relative skills directory. Optional `pick` or `omit` is a nonempty list of exact skill names. They are mutually exclusive.
- `type: "skillbox"` requires `bundles`, a list of upstream bundle ids. Optional `pick` and `omit` map requested upstream bundle ids to nonempty lists of exact skill names. A bundle cannot appear in both maps; picking from one and omitting from another is valid.

Without selectors, a contribution includes every skill in its selected directory or bundles. Selectors use skill names, not paths or patterns. The original skill directory name need not equal its frontmatter name; preserve both. Missing selected or omitted names, selectors for unrequested bundles, and duplicate skill names in a composition fail. Selected skills include their complete supporting files and executable modes; references to other skills do not import dependencies automatically.

Multiple contributions may share an id. Native files at `skillbox/<id>/<skill>/SKILL.md` implicitly contribute to the same bundle, alongside virtual contributions. Local Skillbox sources can reference other native or composed bundles. Do not create composition cycles or a self-reference just to include a native directory—it is already included.

`install` is a distinct list of destination bundle ids. It never controls exports. Every composed id and native bundle is publishable. An empty installation list removes managed installations without removing contributions or exports. Collisions between installed bundles also fail; there is no last-writer-wins order. To publish a broader collection while installing a smaller selection, compose a separate destination with its own selectors and install only that destination.

A repository publishing only native directories needs no config. A composition producer commits its config and root lock even when it installs nothing. Downstream `add skillbox` reads its publishable bundles, not its installation list.

## Root lock and patch ownership

`skillbox/lock.json` owns resolved source pins, flattened bundle-member provenance, and managed installation state. Git sources use immutable revisions; local filesystem sources remain live worktrees. Do not hand-edit or delete pins merely to silence an error. Skillbox does not use or modify the root `skills-lock.json` belonging to `npx skills`.

An unchanged import creates no patch directory and does not copy upstream source into a native bundle. To customize it, prepare the composed bundle, edit, capture, and annotate the per-file intent. Only those changes live under `skillbox/patches/<id>/<skill>/patch.toml` and `changes/`.

A Git-backed consumer pins the producer revision. The producer's locked dependencies and patches determine its exported output. Consumers layer their own patches over that output; do not copy producer intent or patch payloads into consumer-owned files. Updating a producer contribution adopts the producer's reviewed output, not independently newer versions of its dependencies.

Load `skillbox skills get skillbox-patch` for preparation, capture, intent, and staged updates.

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
