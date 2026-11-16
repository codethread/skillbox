import { parseArgs } from "node:util";
import { changelogHistorySchema } from "@codethread/cli-changelog";
import { type FormatConfig, format } from "oxfmt";
import config from "../.oxfmtrc.json";
import history from "../src/changelog.json";

export async function markdown(recordedHistory: unknown): Promise<string> {
	const releases = changelogHistorySchema.parse(recordedHistory);
	const lines = [
		"# Changelog",
		"",
		"All notable changes to Skillbox since 0.1.0 are documented in this file.",
	];
	for (const release of releases.toSorted((a, b) => Bun.semver.order(b.version, a.version))) {
		lines.push("", `## ${release.version}`, "", "### Changes");
		for (const change of release.changes) {
			lines.push("", `- ${change.summary} (${change.commit.slice(0, 7)})`);
			if (change.body !== "") {
				lines.push("", ...change.body.split("\n").map((line) => `    ${line}`));
			}
			const notes = [
				...change.breaking.map((note) => `    - **Breaking:** ${note}`),
				...change.adoption.map(
					(note) => `    - **Adoption (${note.requirement}):** ${note.text}`,
				),
			];
			if (notes.length > 0) lines.push("", ...notes);
		}
	}
	const rendered = `${lines.join("\n")}\n`;
	const { code, errors } = await format("CHANGELOG.md", rendered, config as FormatConfig);
	if (errors.length > 0) throw new AggregateError(errors, "Cannot format CHANGELOG.md.");
	return code;
}

if (import.meta.main) {
	const { values } = parseArgs({
		args: Bun.argv.slice(2),
		options: { write: { type: "boolean" }, check: { type: "boolean" } },
		strict: true,
		allowPositionals: false,
	});
	if (values.write && values.check) throw new Error("Select --write or --check, not both.");
	const output = await markdown(history);
	const destination = Bun.file(new URL("../CHANGELOG.md", import.meta.url));
	if (values.check) {
		if ((await destination.text()) !== output) {
			throw new Error("CHANGELOG.md is stale; run bun run changelog:generate.");
		}
	} else if (values.write) {
		await Bun.write(destination, output);
	} else {
		process.stdout.write(output);
	}
}
