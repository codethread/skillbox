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
import { patchCapture, patchInit, patchPrepare, patchUpdate } from "./commands/patch.ts";
import { createAdaptedBundles } from "./workspace/adapted.ts";

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

program
	.command("add")
	.description("Add repository bundles to the config and SDK project lock.")
	.argument("<source>", "local repository, GitHub shorthand, or Git/tree URL")
	.argument("[bundles...]", "bundle names; implied by a skillbox/<bundle> tree URL")
	.addHelpText(
		"after",
		`
Prefer a repository URL or GitHub shorthand with explicit bundle names.
Bundles merge into one config entry only when the source strings match exactly.
Tree URLs are retained as supplied; different bundle URLs create separate entries.

Examples:
  skillbox add owner/repo frontend backend
  skillbox add owner/repo testing`,
	)
	.action(async (source: string, bundles: string[]) => {
		const cwd = process.cwd();
		const workspace = await selectedWorkspace(cwd);
		const result = await add({ cwd, source, bundles, workspace });
		writeJson(
			successResponse({
				status: result.status,
				source: result.source,
				bundles: result.bundles,
				installed: result.installed,
			}),
		);
	});

const patch = program.command("patch").description("Manage exact-source adapted bundle patches.");
patch
	.command("init")
	.description("Import a Git skills subtree as an immutable adapted bundle.")
	.argument("<bundle>")
	.requiredOption("--source <repo>", "Git repository or GitHub tree URL")
	.option("--root <path>", "plugin root relative to the repository; use . for its root")
	.option(
		"--skills-root <path>",
		"skills directory relative to the plugin root (default: skills)",
	)
	.option("--ref <ref>", "source revision to resolve to an immutable commit")
	.option("--update-ref <ref>", "ref to resolve on a later explicit update")
	.action(async (bundle, options) => {
		const cwd = process.cwd();
		const workspace = await selectedWorkspace(cwd);
		writeJson(
			successResponse(
				await patchInit({
					adapted: createAdaptedBundles(),
					cwd,
					workspace,
					bundle,
					source: options.source,
					root: options.root,
					skillsRoot: options.skillsRoot,
					ref: options.ref,
					updateRef: options.updateRef,
				}),
			),
		);
	});
patch
	.command("prepare")
	.description("Create pristine and editable copies of the pinned patched source.")
	.argument("<bundle>")
	.requiredOption("--output <dir>", "new editing workspace directory")
	.action(async (bundle, options) => {
		const cwd = process.cwd();
		writeJson(
			successResponse(
				await patchPrepare({
					adapted: createAdaptedBundles(),
					workspace: await selectedWorkspace(cwd),
					bundle,
					output: options.output,
				}),
			),
		);
	});
patch
	.command("capture")
	.description("Capture edited source files as per-file diffs with intent.")
	.argument("<bundle>")
	.requiredOption("--from <dir>", "prepared workspace containing manifest.json and edited/")
	.option("--skill <name>", "capture only this skill")
	.option("--intent <text>", "reason for the captured changes")
	.option("--intent-file <file>", "TOML file with a reason per changed target")
	.action(async (bundle, options) => {
		const cwd = process.cwd();
		writeJson(
			successResponse(
				await patchCapture({
					adapted: createAdaptedBundles(),
					workspace: await selectedWorkspace(cwd),
					bundle,
					from: options.from,
					skill: options.skill,
					intent: options.intent,
					intentFile: options.intentFile,
				}),
			),
		);
	});
patch
	.command("adopt")
	.description("Adopt regenerated edits after an upstream update conflict.")
	.argument("<bundle>")
	.requiredOption("--from <dir>", "prepared workspace containing manifest.json and edited/")
	.option("--intent <text>", "reason for the captured changes")
	.option("--intent-file <file>", "TOML file with a reason per changed target")
	.option("--map <mapping...>", "preserve intent across skill/old-path=skill/new-path renames")
	.action(async (bundle, options) => {
		const cwd = process.cwd();
		writeJson(
			successResponse(
				await patchCapture({
					adapted: createAdaptedBundles(),
					workspace: await selectedWorkspace(cwd),
					bundle,
					from: options.from,
					intent: options.intent,
					intentFile: options.intentFile,
					maps: options.map,
				}),
			),
		);
	});

program
	.command("update")
	.description("Advance an adapted bundle and replay its recorded patches.")
	.argument("<bundle>")
	.option("--ref <ref>", "source revision to resolve to an immutable commit")
	.action(async (bundle, options) => {
		const cwd = process.cwd();
		writeJson(
			successResponse(
				await patchUpdate({
					adapted: createAdaptedBundles(),
					workspace: await selectedWorkspace(cwd),
					bundle,
					ref: options.ref,
				}),
			),
		);
	});

program
	.command("sync")
	.description("Reconcile configured skills while preserving retained content hashes.")
	.action(async () => {
		const cwd = process.cwd();
		const result = await sync({
			adapted: createAdaptedBundles(),
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

function writeJson(value: unknown): void {
	process.stdout.write(`${JSON.stringify(value)}\n`);
}
