# Skillbox

Give your agents reusable skills without copying them between projects. Compose bundles from upstream and locally authored skills, choose which bundles your project installs, and customize instructions with a record of **why** you changed them.

## Get started

Requires **Node.js 22.20+ and Git**. Install in your project, then import some skills:

```sh
npm install --save-dev @codethread/skillbox
# or: bun add --dev @codethread/skillbox
npx skillbox add skills codethread/agents development --path skillbox/coding
npx skillbox add skills codethread/agents development --path skillbox/dev
```

Here `development` is your destination bundle. Both source directories contribute skills to it; their skill names must not collide.

Skills and their supporting files install into `.agents/skills/`; `.claude/skills` links to that directory. After cloning a configured project, install dependencies and restore its skills:

```sh
npx skillbox sync
```

Below, use `npx skillbox` in a terminal or `skillbox` in package scripts, such as `"skills:sync": "skillbox sync"`.

## Compose a bundle

Use `add skills` for a repository with ordinary skill directories, or `add skillbox` for a repository publishing Skillbox bundles:

```sh
# Import selected skills from an arbitrary directory in a repository.
skillbox add skills owner/toolkit development --path skills --pick review --pick testing

# Add another contribution to the same destination bundle.
skillbox add skillbox owner/team development --bundle coding --bundle review \
  --pick '{"coding":["typescript"]}' --omit '{"review":["legacy"]}'
```

Both commands accept `--ref <ref>`. Omit `--bundle` to import every published bundle from a local or remote Skillbox source, regardless of what that source installs. Omit selectors to include all skills. Raw `skills` contributions accept either repeated `--pick` or repeated `--omit`, not both. For `skillbox` contributions, each upstream bundle can use pick or omit, but not both. Missing names and collisions fail rather than silently skipping or overwriting skills.

Author shared project skills at `skillbox/development/<skill>/SKILL.md`, with supporting files alongside them. In shared config, that native directory contributes to the same `development` bundle automatically; it can coexist with imported contributions.

## Publish separately from installation

`skillbox/config.json` defines imported contributions and a separate installation list:

```json
{
	"sources": [
		{
			"type": "skills",
			"id": "development",
			"source": "owner/toolkit",
			"path": "skills",
			"pick": ["review", "testing"]
		},
		{
			"type": "skillbox",
			"id": "development",
			"source": "owner/team",
			"bundles": ["coding"],
			"pick": { "coding": ["typescript"] }
		}
	],
	"install": ["development", "local"]
}
```

Every shared composed bundle is publishable, whether or not it appears in `install`. Native bundles such as `skillbox/local/` are publishable too; a native-only producer needs no config. The name `local` is a convention, not access control. Imports read only the producer's shared config, lock, and patches, never its personal setup.

`add` selects the destination for installation by default. Use `--no-install` to add a publishable contribution without changing `install`. Edit `install` and run `sync` to change what this project uses; an empty list installs no bundles without removing their exports. A local Skillbox source such as `"."` can compose other bundles in this repository; composition cycles fail.

## Try personal skills

Add the [private ignore rules](#what-to-commit). Create `skillbox/config.local.json` to choose your own installation without changing the shared setup. It selects personal config instead of `config.json`, without merging either file. Import `"."` to include shared bundles explicitly:

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

This example imports all shared bundles, omits `poteto-mode` from `pstack`, and adds skills from `../my-skills/skills/`. Use your source's exact bundle and skill names. Shared native bundles enter only through the explicit import.

Run `skillbox sync`. The first personal sync resolves its own Git pins; shared producer pins and patches remain authoritative. Later additions that need new pins use `add`. Commands that mutate state report the selected config path.

Personal commands use `skillbox/lock.local.json`, `skillbox/patches.local/`, and `skillbox/.prepare.local/`. To return to the shared installation, move `config.local.json` out of that path and run sync. Restore it and sync to resume your personal setup. Keep the private lock, patches, and installation state through both switches.

## Published workflow skills

This repository publishes the PSTACK workflow adaptation for CT-configured Botlake agents and an unchanged, pinned reference to Cursor Team Kit's `deslop` cleanup skill:

```sh
skillbox add skillbox codethread/skillbox workflows --bundle pstack --bundle deslop
```

Keep project-specific changes in your consumer-owned patches; the shared PSTACK patches stay with this producer.

## Customize and update

An unchanged import needs its active config and matching lock, not a patch directory or copied upstream files. The lock records immutable Git pins and flattened provenance. Ordinary sync retains Git pins rather than following upstream changes. Filesystem-path sources are live local worktrees; use a Git URL (including `file://`) when you need immutable replay.

To customize a composed bundle:

```sh
skillbox patch prepare development
# Edit the prepared skills at the returned path, then:
skillbox patch capture development --from <workspace>
# Fill in the per-file reasons in the reported patch.toml files.
skillbox sync
```

`skillbox update development` stages an upstream candidate for review; capture accepts the reviewed candidate, then sync installs it. Producer patches belong to the producer. A consumer receives that producer's pinned output and records only its own additional changes and intent.

## Let your agent handle the details

**Skillbox ships offline instructions for agents** covering setup, authoring, migration, customization, and upstream review:

```sh
skillbox skills list
skillbox skills get skillbox-configure
skillbox skills get skillbox-patch
```

Instructions and references are built into the CLI. No checkout or network is needed. If the project already has unmanaged installed skills, load `skillbox-migrate` before the first add. Use `skillbox <command> --help` for options. Operational commands return JSON by default; `--workspace <dir>` selects another project directory.

## What to commit

Commit shared `skillbox/config.json`, `skillbox/lock.json`, authored bundles, and any `skillbox/patches/<bundle>/<skill>/patch.toml` files with their `changes/` payloads. Include dependency changes and shared ignore rules. Keep personal sources outside the repository or in a separately ignored directory.

Edit owned sources or prepared skills, not generated installations. Capture wanted edits before deleting a preparation workspace. Add these rules to `.gitignore`, or use Git's private `info/exclude` for a personal opt-in. Skillbox edits neither file:

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

`skillbox/install-state.local.json` tracks the physical installation across shared and personal syncs. Keep it when switching configs.

See [release history](CHANGELOG.md), also available through `skillbox changelog`.
