import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";

const root = resolve(import.meta.dirname, "..");
const nodeRequire = createRequire(import.meta.url);
const result = await Bun.build({
	entrypoints: [join(root, "src/cli.ts")],
	outdir: join(root, "dist"),
	naming: "cli.mjs",
	target: "node",
	// cli-changelog accepts only stable X.Y.Z versions. Replace its Bun-only
	// comparator in the Node bundle; source and standalone builds use Bun's API.
	banner: skillboxCompareReleaseVersions.toString(),
	define: { "Bun.semver.order": "skillboxCompareReleaseVersions" },
	metafile: true,
});
if (!result.success) throw new AggregateError(result.logs, "CLI build failed.");

const packages = new Set<string>();
for (const input of Object.keys(result.metafile!.inputs)) {
	const path = resolve(root, input);
	const marker = "/node_modules/";
	const index = path.lastIndexOf(marker);
	if (index === -1) continue;
	const parts = path.slice(index + marker.length).split("/");
	const name = parts.slice(0, parts[0]!.startsWith("@") ? 2 : 1).join("/");
	packages.add(join(path.slice(0, index), "node_modules", name));
}

const packageSchema = z.object({ name: z.string(), version: z.string() });
const notices = ["Third-party software bundled with Skillbox.\n"];
for (const directory of [...packages].sort()) {
	const metadata = packageSchema.parse(
		JSON.parse(await readFile(join(directory, "package.json"), "utf8")),
	);
	const files = (await readdir(directory, { withFileTypes: true }))
		.filter(
			(file) => file.isFile() && /^(licen[cs]e|copying|notice)([._-].*)?$/i.test(file.name),
		)
		.map((file) => join(directory, file.name))
		.sort();

	// These git-js packages omit the license file from their npm tarballs.
	// Their sibling package ships the same repository's MIT license.
	if (metadata.name === "simple-git" || metadata.name === "@simple-git/argv-parser") {
		const siblingModule = nodeRequire.resolve("@simple-git/args-pathspec", {
			paths: [directory],
		});
		files.push(join(dirname(dirname(siblingModule)), "LICENSE"));
	}
	if (files.length === 0) throw new Error(`No license notice found for ${metadata.name}.`);
	notices.push(`\n${"=".repeat(72)}\n${metadata.name}@${metadata.version}\n`);
	for (const file of files) notices.push(await readFile(file, "utf8"));
}
await Bun.write(join(root, "dist/THIRD-PARTY-NOTICES.txt"), notices.join("\n"));

function skillboxCompareReleaseVersions(left: string, right: string): number {
	const a = left.split(".").map(Number);
	const b = right.split(".").map(Number);
	for (let index = 0; index < 3; index++) {
		const difference = a[index]! - b[index]!;
		if (difference !== 0) return difference;
	}
	return 0;
}
