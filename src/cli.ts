#!/usr/bin/env bun
import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { Command, CommanderError } from "commander";
import { add } from "./add.ts";
import {
	bundledSkillSchema,
	getBundledSkill,
	getBundledSkillFile,
	listBundledSkills,
} from "./bundled-skills.ts";
import { failureResponse, responseError, successResponse } from "./response.ts";
import { sync } from "./sync.ts";

const program = new Command()
	.name("skillbox")
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

program
	.command("sync")
	.description("Reconcile configured skills while preserving retained content hashes.")
	.action(async () => {
		const cwd = process.cwd();
		const result = await sync({ cwd, workspace: await selectedWorkspace(cwd) });
		writeJson(successResponse(result));
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
		// Commander has already written requested help to stdout.
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
