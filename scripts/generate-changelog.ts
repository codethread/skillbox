import { changelogHistorySchema } from "@codethread/cli-changelog";
import history from "../src/changelog.json";

const releases = changelogHistorySchema.parse(history);
const lines = [
	"# Changelog",
	"",
	"<!-- Generated from src/changelog.json by bun run changelog:generate. -->",
	"",
	"Recorded history starts at 0.1.0. Earlier development history is not included.",
];
for (const release of releases.toSorted((a, b) => Bun.semver.order(b.version, a.version))) {
	lines.push("", `## ${release.version}`);
	for (const change of release.changes) {
		lines.push(
			"",
			`- ${change.summary} ([${change.commit.slice(0, 7)}](https://github.com/codethread/skillbox/commit/${change.commit}))`,
		);
		if (change.body) lines.push("", `  ${change.body}`);
		for (const note of change.breaking) lines.push("", `  **BREAKING:** ${note}`);
		for (const note of change.adoption) {
			lines.push("", `  **Adoption (${note.requirement}):** ${note.text}`);
		}
	}
}
await Bun.write(new URL("../CHANGELOG.md", import.meta.url), `${lines.join("\n")}\n`);
