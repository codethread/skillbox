#!/usr/bin/env bun
import { Command } from "commander";
import { match, P } from "ts-pattern";
import { z } from "zod";
import { add } from "./add.ts";

const program = new Command()
	.name("skillbox")
	.description("Install skill bundles into your repository.")
	.option("--config <dir>", "workspace directory containing skillbox/config.json", ".")
	.showHelpAfterError();

program
	.command("add")
	.description("Add repository bundles to the config and SDK project lock.")
	.argument("<source>", "local repository, GitHub shorthand, or Git/tree URL")
	.argument("[bundles...]", "bundle names; implied by a skillbox/<bundle> tree URL")
	.action(async (source: string, bundles: string[]) => {
		const result = await add({
			cwd: process.cwd(),
			source,
			bundles,
			config: program.opts<{ config: string }>().config,
		});
		const { skills } = result;
		if (skills.length === 0) {
			console.log(`Already added bundles: ${result.bundles.join(", ")}.`);
			return;
		}
		console.log(
			`Added ${skills.length} skill${skills.length === 1 ? "" : "s"} from ${result.bundles.join(", ")}:\n${skills.map((name) => `  ${name}`).join("\n")}`,
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
