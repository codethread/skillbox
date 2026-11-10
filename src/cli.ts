#!/usr/bin/env bun
import { Command } from "commander";
import { match, P } from "ts-pattern";
import { z } from "zod";
import { add } from "./add.ts";
import { defaultConfigPath } from "./config.ts";

const program = new Command()
	.name("skillbox")
	.description("Install repository-local skill bundles.")
	.option(
		"--config <file>",
		"config file; workspace is the parent of its containing directory",
		defaultConfigPath,
	)
	.showHelpAfterError();

program
	.command("add")
	.description("Add local repository bundles to the config and SDK project lock.")
	.argument("<source>", "local repository directory containing skillbox/<bundle>/<skill>")
	.argument("<bundles...>", "bundle directory names to install")
	.action(async (source: string, bundles: string[]) => {
		const skills = await add({
			cwd: process.cwd(),
			source,
			bundles,
			config: program.opts<{ config: string }>().config,
		});
		if (skills.length === 0) {
			console.log(`Already added bundles: ${[...new Set(bundles)].join(", ")}.`);
			return;
		}
		console.log(
			`Added ${skills.length} skill${skills.length === 1 ? "" : "s"} from ${[...new Set(bundles)].join(", ")}:\n${skills.map((name) => `  ${name}`).join("\n")}`,
		);
	});

try {
	await program.parseAsync();
} catch (error) {
	const message = match(error)
		.with(P.instanceOf(z.ZodError), (error) =>
			error.issues.map((issue) => issue.message).join("; "),
		)
		.with(P.instanceOf(Error), (error) => error.message)
		.otherwise((error) => String(error));
	console.error(`error: ${message}`);
	process.exitCode = 1;
}
