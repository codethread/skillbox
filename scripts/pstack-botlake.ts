#!/usr/bin/env bun
/**
 * PSTACK to Botlake authoring helper.
 *
 * Deterministic, offline, and never run by sync: it rewrites a prepared
 * pristine pstack copy with anchored edits, writes the intent manifest, and
 * verifies the distributed prose, links, and identities.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { ToolError, applyPlan } from "./pstack-botlake/apply.ts";
import { PROVENANCE, SKILL_NAMES, buildPlan } from "./pstack-botlake/model.ts";
import { verifyTarget } from "./pstack-botlake/verify.ts";

const USAGE = `pstack-botlake — adapt and verify the official PSTACK skills for Botlake

Usage:
  bun scripts/pstack-botlake.ts apply --source <pristine-pstack-root> --target <edited-pstack-root> --intents <out.toml> [--report <out.json>]
  bun scripts/pstack-botlake.ts check --target <patched-tree-or-installed-skills> [--skills-root skills] [--report <out.json>]

apply  Rewrites the prepared target tree with anchored per-file edits, then verifies it.
       The target must start as a byte-identical copy of --source before applying the plan.
check  Verifies skill identities, the Cursor residue gate, retained local links, and adapter pointers.

Both commands print one JSON object and exit nonzero on failure. Run apply after
the product CLI exposes its editable workspace; nothing here is executed by sync.`;

type Args = Record<string, string | boolean>;

function parse(argv: string[]): { command: string; args: Args } {
	const [command, ...rest] = argv;
	const args: Args = {};
	for (let index = 0; index < rest.length; index += 1) {
		const token = rest[index];
		if (!token.startsWith("--")) throw new ToolError("ARGV", `unexpected argument: ${token}`);
		const [rawKey, inline] = token.slice(2).split("=", 2);
		if (inline !== undefined) {
			args[rawKey] = inline;
			continue;
		}
		const next = rest[index + 1];
		if (next === undefined || next.startsWith("--")) {
			args[rawKey] = true;
		} else {
			args[rawKey] = next;
			index += 1;
		}
	}
	return { command: command ?? "", args };
}

function required(args: Args, name: string): string {
	const value = args[name];
	if (typeof value !== "string" || value.length === 0) {
		throw new ToolError("ARGV", `--${name} is required`, { flag: name });
	}
	return value;
}

function emit(value: unknown): void {
	process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function writeReport(path: string, value: unknown): void {
	const full = resolve(path);
	mkdirSync(dirname(full), { recursive: true });
	writeFileSync(full, `${JSON.stringify(value, null, 2)}\n`);
}

function main(): number {
	const argv = process.argv.slice(2);
	if (argv.length === 0 || argv[0] === "-h" || argv[0] === "--help" || argv[0] === "help") {
		process.stdout.write(`${USAGE}\n`);
		return 0;
	}
	const { command, args } = parse(argv);

	if (command === "plan") {
		const plan = buildPlan();
		emit({
			ok: true,
			base_revision: PROVENANCE.baseRevision,
			skills: SKILL_NAMES.length,
			changes: plan.changes.map((change) => ({
				skill: change.skill,
				target: change.target,
				kind: change.delete
					? "delete"
					: change.copyFrom
						? "copy"
						: change.content
							? "add"
							: "edit",
				intent: change.intent,
			})),
		});
		return 0;
	}

	if (command === "apply") {
		const source = required(args, "source");
		const target = required(args, "target");
		const intents = required(args, "intents");
		const result = applyPlan({ source, target, intents });
		const report = verifyTarget({ target });
		const payload = {
			ok: report.ok,
			base_revision: PROVENANCE.baseRevision,
			source: resolve(source),
			target: resolve(target),
			intents: result.intentsPath,
			applied: result.applied,
			removed_links: result.removedLinks,
			verification: report,
		};
		if (typeof args.report === "string") writeReport(args.report, payload);
		emit(payload);
		return report.ok ? 0 : 1;
	}

	if (command === "check") {
		const target = required(args, "target");
		const skillsRoot =
			typeof args["skills-root"] === "string" ? args["skills-root"] : undefined;
		const report = verifyTarget({ target, skillsRootFlag: skillsRoot });
		if (typeof args.report === "string") writeReport(args.report, report);
		emit(report);
		return report.ok ? 0 : 1;
	}

	throw new ToolError("ARGV", `unknown command: ${command}`, { command });
}

try {
	process.exitCode = main();
} catch (error) {
	if (error instanceof ToolError) {
		emit({ ok: false, error: error.failure });
	} else {
		emit({
			ok: false,
			error: {
				code: "INTERNAL",
				message: error instanceof Error ? error.message : String(error),
			},
		});
	}
	process.exitCode = 1;
}
