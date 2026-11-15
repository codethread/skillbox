import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir } from "node:fs/promises";
import { join, posix, sep } from "node:path";
import { parse } from "smol-toml";
import { z } from "zod";
import { ResponseError, responseError, type ResponseErrorItem } from "../response.ts";
import { bundleSchema, relativePathSchema } from "./config.ts";
import { statOptional, readOptional } from "./paths.ts";
import type { PatchGit } from "./patch-git.ts";

const targetSchema = relativePathSchema.refine(
	(value) => value.startsWith("./") && value !== "./",
	"Patch targets start with ./ and name a file.",
);
export const patchSchema = z.strictObject({
	schema: z.literal(1),
	files: z.record(targetSchema, z.strictObject({ intent: z.string() })),
	patches: z.array(z.strictObject({ target: targetSchema, patch: relativePathSchema })),
});
export type PatchManifest = z.infer<typeof patchSchema>;
interface RecordedPatch {
	skill: string;
	change: PatchManifest["patches"][number];
	path: string;
	intent: string;
}

export async function readManifest(pack: string, skill: string): Promise<PatchManifest> {
	const text = await readOptional(join(pack, skill, "patch.toml"));
	return text === undefined
		? { schema: 1, files: {}, patches: [] }
		: patchSchema.parse(parse(text));
}

export async function pendingIntents(
	directory: string,
): Promise<{ skill: string; target: string; manifest: string }[]> {
	const missing = new Map<string, { skill: string; target: string; manifest: string }>();
	for (const { skill, change, intent } of await readPatches(directory))
		if (!intent.trim())
			missing.set(skill + "/" + change.target, {
				skill,
				target: change.target,
				manifest: join(directory, skill, "patch.toml"),
			});
	return [...missing.values()];
}

export async function requireIntents(directory: string): Promise<void> {
	const pending = await pendingIntents(directory);
	if (pending.length)
		throw new ResponseError(
			pending.map(({ skill, target, manifest }) => ({
				code: "INTENT_REQUIRED",
				message: `Add intent for ${skill}/${target} in ${manifest}.`,
				skill,
				target,
				input: manifest,
			})),
		);
}

export async function hashPatchPack(directory: string): Promise<string> {
	const hash = createHash("sha256");
	for (const { skill, change, path } of await readPatches(directory)) {
		hash.update(JSON.stringify({ skill, ...change })).update("\0");
		const body = await readFile(path);
		hash.update(`${body.length}\0`).update(body);
	}
	return hash.digest("hex");
}

/** Replay is relative to the original skill directory, preserving existing PSTACK payloads. */
export async function replayPatches(
	directory: string,
	skills: string,
	git: PatchGit,
): Promise<void> {
	const conflicts: ResponseErrorItem[] = [];
	const failed = new Set<string>();
	for (const { skill, change, path } of await readPatches(directory)) {
		const key = skill + "/" + change.target;
		if (failed.has(key)) continue;
		const body = await readFile(path, "utf8");
		for (const mode of body.matchAll(
			/^(?:old mode|new mode|new file mode|deleted file mode) (\d+)$/gm,
		))
			if (mode[1] !== "100644" && mode[1] !== "100755")
				throw responseError("PATCH_PATH_UNSAFE", "Patches may only change regular files.", {
					skill,
					target: change.target,
				});
		const targets = await git.patchTargets(path);
		if (targets.length !== 1 || targets[0] !== change.target.slice(2))
			throw responseError(
				"PATCH_TARGET_MISMATCH",
				`Patch must change only ${skill}/${change.target}.`,
				{ skill, input: change.patch },
			);
		const root = join(skills, skill);
		await mkdir(root, { recursive: true });
		await regularTree(root);
		try {
			await git.applyPatch(root, path);
		} catch (cause) {
			failed.add(key);
			conflicts.push({
				code: "PATCH_APPLY_FAILED",
				message: `Patch failed for ${skill}/${change.target}.`,
				skill,
				target: change.target,
				patch: change.patch,
				reason: cause instanceof Error ? cause.message : String(cause),
			});
		}
	}
	if (conflicts.length) throw new ResponseError(conflicts);
}

export async function hashTree(root: string): Promise<string> {
	const hash = createHash("sha256");
	for (const path of await regularTree(root)) {
		const entry = await lstat(join(root, path));
		const body = await readFile(join(root, path));
		hash.update(`${path}\0${entry.mode & 0o777}\0${body.length}\0`).update(body);
	}
	return hash.digest("hex");
}

export async function regularTree(root: string): Promise<string[]> {
	const paths: string[] = [];
	if (!(await lstat(root)).isDirectory())
		throw responseError("PATCH_PATH_UNSAFE", `Expected a real directory: ${root}.`, {
			input: root,
		});
	async function visit(relative: string): Promise<void> {
		for (const name of (await readdir(join(root, relative))).sort()) {
			const path = join(relative, name);
			const entry = await lstat(join(root, path));
			if (name === ".git" || (!entry.isFile() && !entry.isDirectory()))
				throw responseError(
					"PATCH_PATH_UNSAFE",
					`Only regular source files and directories are supported: ${path}.`,
					{ input: path },
				);
			if (entry.isDirectory()) await visit(path);
			else paths.push(path.split(sep).join("/"));
		}
	}
	await visit("");
	return paths.sort();
}

async function readPatches(directory: string): Promise<RecordedPatch[]> {
	if (!(await statOptional(directory))) return [];
	await regularTree(directory);
	const patches: RecordedPatch[] = [];
	for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
		a.name.localeCompare(b.name),
	)) {
		if (!entry.isDirectory())
			throw responseError(
				"PATCH_PACK_INVALID",
				`Unexpected patch pack file: ${entry.name}.`,
				{ input: entry.name },
			);
		const skill = bundleSchema.parse(entry.name);
		try {
			const manifest = patchSchema.parse(
				parse(await readFile(join(directory, skill, "patch.toml"), "utf8")),
			);
			const referenced = new Set(["patch.toml"]);
			for (const change of manifest.patches) {
				if (!Object.hasOwn(manifest.files, change.target))
					throw new Error(`Missing file intent record for ${change.target}.`);
				const path = posix.normalize(change.patch);
				if (!path.startsWith("changes/") || !path.endsWith(".patch"))
					throw new Error(
						"Patch artifacts must be under changes/ with .patch extensions.",
					);
				if (referenced.has(path)) throw new Error(`Repeated patch artifact ${path}.`);
				referenced.add(path);
				patches.push({
					skill,
					change,
					path: join(directory, skill, path),
					intent: manifest.files[change.target]!.intent,
				});
			}
			const paths = await regularTree(join(directory, skill));
			if (paths.length !== referenced.size || paths.some((path) => !referenced.has(path)))
				throw new Error("Patch pack contains missing or unreferenced files.");
		} catch (cause) {
			throw responseError(
				"PATCH_PACK_INVALID",
				`Invalid patch manifest for ${skill}.`,
				{ skill },
				cause,
			);
		}
	}
	return patches;
}
