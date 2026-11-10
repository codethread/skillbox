#!/usr/bin/env bun
import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { Command, CommanderError } from "commander";
import { add } from "./add.ts";
import { failureResponse, responseError, successResponse } from "./response.ts";
import { sync } from "./sync.ts";

const program = new Command()
	.name("skillbox")
	.description("Install skill bundles into your repository.")
	.option("--workspace <dir>", "workspace directory for skills, config, and lockfiles", ".")
	.configureOutput({ writeErr: () => {} })
	.exitOverride();

program
	.command("add")
	.description("Add repository bundles to the config and SDK project lock.")
	.argument("<source>", "local repository, GitHub shorthand, or Git/tree URL")
	.argument("[bundles...]", "bundle names; implied by a skillbox/<bundle> tree URL")
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
	.description("Restore configured skills without advancing their recorded versions.")
	.action(async () => {
		const cwd = process.cwd();
		const result = await sync({ cwd, workspace: await selectedWorkspace(cwd) });
		writeJson(successResponse(result));
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
