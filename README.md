# Skillbox

Give your agents reusable skills without copying them between projects. Choose bundles, restore your project's skills after cloning, and customize upstream instructions while keeping a record of **why** you changed them.

## Get started

Requires **Node.js 22.20+ and Git**. Install in your project, then add your first bundles:

```sh
npm install --save-dev @codethread/skillbox
# or: bun add --dev @codethread/skillbox
npx skillbox add codethread/agents dev coding
```

Skills and their supporting files install into `.agents/skills/`; `.claude/skills` links to that directory.

After cloning a configured project, install dependencies and restore its skills:

```sh
npx skillbox sync
```

For the examples below, use `npx skillbox` in a terminal or `skillbox` in package scripts, such as `"skills:sync": "skillbox sync"`.

## Let your agent handle the details

**Skillbox ships offline instructions for agents** covering setup, authoring, migration, customization, and upstream updates. Ask your agent to discover and load the relevant guidance:

```sh
skillbox skills list
skillbox skills get skillbox-configure
```

The instructions and supporting references are built into the CLI—no checkout or network needed. If your project already has installed skills, have your agent follow the migration guidance before the first `add`.

Use `skillbox <command> --help` for options.

## Choose bundles

`skillbox/config.json` selects remote and local sources:

```json
{
	"sources": [
		{ "source": "codethread/agents", "bundles": ["dev", "coding"] },
		{ "source": ".", "bundles": ["local"] }
	]
}
```

For the local selection, author skills at `skillbox/local/<name>/SKILL.md`, with supporting files alongside them. No patch pack is needed. You can also select a sibling repository such as `../team-skills`; config paths resolve from your project root. Skill names must be distinct across selections.

Use `add` for the first installation. Afterward, edit the config and run `sync` to install selections or remove deselected skills.

## Customize upstream skills

Adapt upstream skills to your workflow with reviewable patches and a reason for each changed file. Skillbox records the source snapshot; your agent can help review updates before you adopt them.

For example, this repository publishes a PSTACK adaptation for CT-configured Botlake agents:

```sh
skillbox add codethread/skillbox pstack
```

Choose a producer revision containing the adaptation. Any customizations you make belong to your project's patch pack, separate from the producer's changes. Ask your agent to follow the built-in patch guidance.

## What to commit

Commit `skillbox/config.json`, `skillbox/lock.json`, any `skillbox/patches/` packs, and locally authored source bundles, along with dependency changes and ignore rules.

Edit owned sources or prepared adaptations, not generated installations. Prepared editing workspaces and update candidates live under `skillbox/.prepare/<bundle>/`; capture wanted edits before deleting them. Add these rules yourself; Skillbox does not manage `.gitignore`:

```gitignore
/.agents/skills/
/.claude/skills
/skillbox/.prepare/
```

See [release history](CHANGELOG.md), also available through `skillbox changelog`.
