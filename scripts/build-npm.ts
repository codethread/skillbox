import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";

const root = resolve(import.meta.dirname, "..");
const result = await Bun.build({
	entrypoints: [join(root, "src/cli.ts")],
	outdir: join(root, "dist"),
	naming: "cli.mjs",
	target: "node",
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
		files.push(join(root, "node_modules/@simple-git/args-pathspec/LICENSE"));
	}
	if (files.length === 0) throw new Error(`No license notice found for ${metadata.name}.`);
	notices.push(`\n${"=".repeat(72)}\n${metadata.name}@${metadata.version}\n`);
	for (const file of files) notices.push(await readFile(file, "utf8"));
}
await Bun.write(join(root, "dist/THIRD-PARTY-NOTICES.txt"), notices.join("\n"));
