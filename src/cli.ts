#!/usr/bin/env bun
import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { Command, CommanderError } from "commander";
import {
	changelogHistorySchema,
	changelogQuerySchema,
	changelogSchema,
	queryChangelog,
	renderChangelog,
} from "@codethread/cli-changelog";
import recordedHistory from "./changelog.json";
import { version } from "../package.json";
import { add } from "./commands/add.ts";
import {
	bundledSkillSchema,
	getBundledSkill,
	getBundledSkillFile,
	listBundledSkills,
} from "./skills/catalog.ts";
import { failureResponse, responseError, successResponse } from "./response.ts";
import { sync } from "./commands/sync.ts";
import { patchCapture, patchPrepare, patchUpdate } from "./commands/patch.ts";
import { createBundles } from "./workspace/bundles.ts";
import { createPatchGit } from "./workspace/patch-git.ts";

const program = new Command()
	.name("skillbox")
	.version(version, "-v, --version")
	.description("Install skill bundles into your repository.")
	.addHelpText(
		"after",
		"\nAgent guidance: skills list → skills get <name> → skills file <name> <path>.",
	)
	.option("--workspace <dir>", "workspace directory for skills, config, and lockfiles", ".")
	.configureOutput({ writeErr: () => {} })
	.exitOverride();

const addCommand = program
	.command("add")
	.description("Contribute a source to a local destination bundle.")
	.action(() => {
		throw responseError("SOURCE_TYPE_REQUIRED", "Use add skillbox or add skills.");
	});
addCommand
	.command("skillbox")
	.description("Merge published Skillbox bundles into a destination local bundle.")
	.argument("<source>", "producer repository URL, shorthand, or authored local path")
	.argument("<id>", "destination local bundle name")
	.requiredOption("--bundle <name>", "upstream bundle (repeatable)", collect, [])
	.option("--pick <json>", "bundle-to-skill-names selection map")
	.option("--omit <json>", "bundle-to-skill-names exclusion map")
	.option("--ref <ref>", "Git resolution and future update target")
	.option("--no-install", "publish without selecting the destination for local installation")
	.action(async (source: string, id: string, options) => {
		const cwd = process.cwd();
		writeJson(
			successResponse(
				await add({
					bundles: workspaceBundles(),
					cwd,
					workspace: await selectedWorkspace(cwd),
					install: options.install,
					contribution: {
						type: "skillbox",
						source,
						id,
						bundles: options.bundle,
						ref: options.ref,
						pick: parseSelection(options.pick),
						omit: parseSelection(options.omit),
					},
				}),
			),
		);
	});
addCommand
	.command("skills")
	.description("Merge an arbitrary upstream skills directory into a destination local bundle.")
	.argument("<source>", "repository URL, shorthand, or authored local path")
	.argument("<id>", "destination local bundle name")
	.requiredOption("--path <dir>", "relative upstream skills directory")
	.option("--pick <name>", "include a skill name (repeatable)", collect)
	.option("--omit <name>", "exclude a skill name (repeatable)", collect)
	.option("--ref <ref>", "Git resolution and future update target")
	.option("--no-install", "publish without selecting the destination for local installation")
	.action(async (source: string, id: string, options) => {
		const cwd = process.cwd();
		writeJson(
			successResponse(
				await add({
					bundles: workspaceBundles(),
					cwd,
					workspace: await selectedWorkspace(cwd),
					install: options.install,
					contribution: {
						type: "skills",
						source,
						id,
						path: options.path,
						ref: options.ref,
						pick: options.pick,
						omit: options.omit,
					},
				}),
			),
		);
	});

const patch = program
	.command("patch")
	.description("Edit pinned bundles and record file intent with ordered diffs.")
	.addHelpText(
		"after",
		"\nWorkflow: add → prepare → edit → capture → annotate file intent → sync.\nUpdates: update → review/edit → capture → sync.\nRepeat edit/capture in the same workspace; capture preserves file notes.\nAgent guidance: skills get skillbox-patch.",
	);
patch
	.command("prepare")
	.description("Create pristine and editable copies of the pinned patched source.")
	.argument("<bundle>")
	.option("--output <dir>", "new editing directory (default: skillbox/.prepare/<bundle>/edit)")
	.action(async (bundle, options) => {
		const cwd = process.cwd();
		writeJson(
			successResponse(
				await patchPrepare({
					bundles: workspaceBundles(),
					workspace: await selectedWorkspace(cwd),
					bundle,
					output: options.output,
				}),
			),
		);
	});
patch
	.command("capture")
	.description(
		"Record edited files or accept an update candidate; annotate new file intent before sync.",
	)
	.argument("<bundle>")
	.requiredOption(
		"--from <dir>",
		"prepared workspace containing manifest.json and edited/skills/",
	)
	.option("--skill <name>", "capture only this skill")
	.option(
		"--map <mapping...>",
		"preserve intent across skill/old-path=skill/new-path renames in an update",
	)
	.action(async (bundle, options) => {
		const cwd = process.cwd();
		writeJson(
			successResponse(
				await patchCapture({
					bundles: workspaceBundles(),
					workspace: await selectedWorkspace(cwd),
					bundle,
					from: options.from,
					skill: options.skill,
					maps: options.map,
				}),
			),
		);
	});
program
	.command("update")
	.description("Prepare an exact-source update candidate; review and accept with patch capture.")
	.argument("<bundle>")
	.option(
		"--ref <ref>",
		"Git revision to resolve to an immutable commit; not for local producers",
	)
	.addHelpText(
		"after",
		"\nGit sources use contribution ref or HEAD when --ref is omitted.\nLocal producers use the current worktree and reject --ref.\nTracked files and installations stay unchanged until capture/sync.\nUPDATE_CONFLICT retains the candidate for review and capture.",
	)
	.action(async (bundle, options) => {
		const cwd = process.cwd();
		writeJson(
			successResponse(
				await patchUpdate({
					bundles: workspaceBundles(),
					workspace: await selectedWorkspace(cwd),
					bundle,
					ref: options.ref,
				}),
			),
		);
	});

program
	.command("sync")
	.description("Install configured skills from recorded sources and patches.")
	.action(async () => {
		const cwd = process.cwd();
		const result = await sync({
			bundles: workspaceBundles(),
			cwd,
			workspace: await selectedWorkspace(cwd),
		});
		writeJson(successResponse(result));
	});

program
	.command("changelog")
	.description("Read recorded release history offline; defaults to the latest installed release.")
	.option("--since <version>", "releases newer than this version (exclusive)")
	.option("--release <version>", "one exact recorded release")
	.option("--limit <count>", "page size in changes (1–100; default: 20)")
	.option("--offset <count>", "zero-based change offset (default: 0)")
	.option("--text", "render a human-readable page instead of JSON")
	.option("--schema", "return the JSON Schema for data without querying history")
	.action((options: { text?: boolean; schema?: boolean }) => {
		const query = changelogQuerySchema.parse(options);
		if (options.schema) {
			writeJson(successResponse(changelogSchema()));
			return;
		}
		const page = queryChangelog(
			{ tool: "skillbox", version },
			changelogHistorySchema.parse(recordedHistory),
			query,
		);
		if (options.text) process.stdout.write(renderChangelog(page));
		else writeJson(successResponse(page));
	});

const skills = program
	.command("skills")
	.description("Read bundled agent guidance; offline and independent of --workspace.")
	.addHelpText(
		"after",
		"\nList metadata, get selected instructions, then load referenced files on demand.\nAll results are JSON with success/data/errors; failures exit nonzero.\nThese commands read CLI-bundled guidance, not installed workspace skills.",
	);

skills
	.command("list")
	.description("List names and descriptions as JSON, without instruction bodies or resources.")
	.option("--limit <count>", "page size (1–100; default: 20)")
	.option("--offset <count>", "zero-based offset (default: 0)")
	.addHelpText(
		"after",
		"\nContinue at data.nextOffset; null means exhausted. data.total is the full count.",
	)
	.action((options: { limit?: string; offset?: string }) => {
		writeJson(successResponse(listBundledSkills(options)));
	});

skills
	.command("get")
	.description("Return one skill's Markdown body in JSON data.body, without YAML frontmatter.")
	.argument("<name>", "bundled skill name from skills list")
	.action((name: string) => {
		writeJson(successResponse(getBundledSkill(name)));
	});

skills
	.command("file")
	.description("Return one supporting resource in JSON data.content, without other files.")
	.argument("<name>", "bundled skill name from skills list")
	.argument("<path>", "exact relative resource path from the selected skill's instructions")
	.action((name: string, path: string) => {
		writeJson(successResponse(getBundledSkillFile(name, path)));
	});

skills
	.command("schema")
	.description("Return an on-demand JSON Schema for a skills command's success/error response.")
	.argument("<command>", "list, get, or file")
	.action((command: string) => {
		writeJson(successResponse(bundledSkillSchema(command)));
	});

try {
	await program.parseAsync();
} catch (error) {
	if (error instanceof CommanderError && error.exitCode === 0) {
		// Commander has already written requested help or version to stdout.
	} else {
		writeJson(failureResponse(error));
		process.exitCode = error instanceof CommanderError ? error.exitCode : 1;
	}
}

async function selectedWorkspace(cwd: string): Promise<string> {
	const input = program.opts<{ workspace: string }>().workspace;
	try {
		return await realpath(resolve(cwd, input));
	} catch (cause) {
		throw responseError(
			"WORKSPACE_NOT_FOUND",
			`Workspace does not exist: ${input}`,
			{ input },
			cause,
		);
	}
}

function workspaceBundles() {
	return createBundles(createPatchGit(), process.env.SKILLBOX_CACHE_DIR);
}

function collect(value: string, previous: string[] = []): string[] {
	return [...previous, value];
}
function parseSelection(value: string | undefined): unknown {
	if (value === undefined) return undefined;
	try {
		return JSON.parse(value);
	} catch (cause) {
		throw responseError(
			"INVALID_INPUT",
			"Selectors must be valid JSON maps.",
			{ input: value },
			cause,
		);
	}
}

function writeJson(value: unknown): void {
	process.stdout.write(`${JSON.stringify(value)}\n`);
}
