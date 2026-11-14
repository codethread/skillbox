import { createHash } from "node:crypto";
import {
	cp,
	lstat,
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, posix, resolve, sep } from "node:path";
import { xdgCache } from "xdg-basedir";
import { parse, stringify } from "smol-toml";
import { z } from "zod";
import { ResponseError, responseError, type ResponseErrorItem } from "../response.ts";
import { bundleSchema } from "./config.ts";
import { statOptional } from "./paths.ts";
import { createPatchGit, type PatchGit } from "./patch-git.ts";

const revisionSchema = z.string().regex(/^[0-9a-f]{40}$/);
const digestSchema = z.string().regex(/^[0-9a-f]{64}$/);
const relativePath = z
	.string()
	.min(1)
	.refine((value) => {
		const path = value.replace(/^\.\//, "");
		return (
			!value.includes("\\") &&
			!/[\0\r\n]/.test(value) &&
			!posix.isAbsolute(path) &&
			path.split("/").every((part) => part !== ".." && part !== ".git" && part !== "")
		);
	}, "Expected a relative path without traversal or .git components.");
const targetSchema = relativePath.refine(
	(value) => value.startsWith("./") && value !== "./",
	"Patch targets start with ./ and name a file.",
);
export const descriptorSchema = z.strictObject({
	schema: z.literal(1),
	bundle: bundleSchema,
	source: z
		.string()
		.min(1)
		.refine((value) => !value.startsWith("-") && !/[\0\r\n]/.test(value)),
	upstream: z.string().min(1),
	root: relativePath,
	skills_root: relativePath,
	update_ref: z.string().min(1).optional(),
});
export const bundleLockSchema = z.strictObject({
	schema: z.literal(1),
	source: z.string().min(1),
	root: relativePath,
	revision: revisionSchema,
	tree: revisionSchema,
	sourceHash: digestSchema,
	patchHash: digestSchema,
	outputs: z.record(bundleSchema, digestSchema),
});
export const patchSchema = z.strictObject({
	schema: z.literal(1),
	files: z.record(targetSchema, z.strictObject({ intent: z.string() })),
	patches: z.array(
		z.strictObject({
			target: targetSchema,
			patch: relativePath,
			base_revision: revisionSchema,
		}),
	),
});
const cacheSchema = bundleLockSchema
	.pick({ source: true, root: true, revision: true, tree: true, sourceHash: true })
	.extend({ schema: z.literal(1) });
export const preparedSchema = z.strictObject({
	schema: z.literal(1),
	bundle: bundleSchema,
	source: z.string().min(1),
	revision: revisionSchema,
	sourceHash: digestSchema,
	patchHash: digestSchema,
	previous_revision: revisionSchema.optional(),
});
export type BundleDescriptor = z.infer<typeof descriptorSchema>;
export type BundleLock = z.infer<typeof bundleLockSchema>;
export type PatchManifest = z.infer<typeof patchSchema>;
export interface BundleSource {
	root: string;
	revision: string;
	tree: string;
	sourceHash: string;
}
export interface MaterializedBundle extends Omit<BundleSource, "root"> {
	descriptor: BundleDescriptor;
	patchHash: string;
	outputs: Record<string, string>;
	canonical: string;
}
export interface AdaptedBundles {
	diffFiles(before: string, after: string): Promise<{ target: string; body: string }[]>;
	acquireSource(descriptor: BundleDescriptor, revision: string): Promise<BundleSource>;
	materializeBundle(
		workspace: string,
		bundle: string,
		destination: string,
		revision?: string,
	): Promise<MaterializedBundle>;
	prepareBundle(
		workspace: string,
		bundle: string,
		output: string,
	): Promise<{ workspace: string; editable: string; revision: string; source: string }>;
}
interface BundleRuntime {
	cacheDirectory: string;
	git: PatchGit;
}

/** Compose this live filesystem/Git adapter once at the CLI entry point. */
export function createAdaptedBundles(): AdaptedBundles {
	const configured = process.env.SKILLBOX_CACHE_DIR;
	if (configured !== undefined && configured.trim() === "")
		throw new Error("SKILLBOX_CACHE_DIR must not be empty.");
	const runtime: BundleRuntime = {
		cacheDirectory: resolve(
			configured ?? join(xdgCache ?? join(homedir(), ".cache"), "skillbox"),
		),
		git: createPatchGit(),
	};
	return {
		diffFiles: runtime.git.diffFiles,
		acquireSource: (descriptor, revision) => acquireSource(descriptor, revision, runtime),
		materializeBundle: (workspace, bundle, destination, revision) =>
			materializeBundle(workspace, bundle, destination, runtime, revision),
		prepareBundle: (workspace, bundle, output) =>
			prepareBundle(workspace, bundle, output, runtime),
	};
}

export async function readAdaptedBundle(
	workspace: string,
	bundle: string,
): Promise<{ descriptor: BundleDescriptor; lock: BundleLock; directory: string } | undefined> {
	bundleSchema.parse(bundle);
	const directory = join(workspace, "skillbox/patches", bundle);
	if (!(await statOptional(directory))) return undefined;
	try {
		await regularTree(directory);
		const descriptor = descriptorSchema.parse(
			parse(await readFile(join(directory, "bundle.toml"), "utf8")),
		);
		const lock = bundleLockSchema.parse(
			JSON.parse(await readFile(join(directory, "lock.json"), "utf8")),
		);
		if (
			descriptor.bundle !== bundle ||
			descriptor.source !== lock.source ||
			descriptor.root !== lock.root
		)
			throw new Error("Descriptor and lock identify different sources or bundles.");
		return { descriptor, lock, directory };
	} catch (cause) {
		throw responseError(
			"PATCH_PACK_INVALID",
			`Invalid patch pack for ${bundle}.`,
			{ skill: bundle },
			cause,
		);
	}
}

async function acquireSource(
	descriptor: BundleDescriptor,
	requested: string,
	runtime: BundleRuntime,
): Promise<BundleSource> {
	descriptorSchema.parse(descriptor);
	if (!requested || requested.startsWith("-") || /[\0\r\n]/.test(requested))
		throw responseError("REVISION_INVALID", "Specify a Git ref or immutable commit.", {
			input: requested,
		});
	const key = createHash("sha256")
		.update(`${descriptor.source}\0${descriptor.root}`)
		.digest("hex");
	const parent = join(runtime.cacheDirectory, "sources", key);
	const exact = revisionSchema.safeParse(requested);
	if (exact.success) {
		const cached = await readCachedSource(join(parent, exact.data), descriptor, exact.data);
		if (cached) return cached;
	}
	await mkdir(parent, { recursive: true });
	const staging = await mkdtemp(join(parent, ".fetch-"));
	try {
		const root = join(staging, "tree");
		const fetched = await runtime.git.fetchTree(
			sourceRepository(descriptor.source),
			requested,
			descriptor.root,
			root,
		);
		const revision = revisionSchema.parse(fetched.revision);
		const tree = revisionSchema.parse(fetched.tree);
		if (exact.success && revision !== exact.data)
			throw new Error("Fetched commit differs from the requested pin.");
		const sourceHash = await hashTree(root);
		await writeFile(
			join(staging, "manifest.json"),
			`${JSON.stringify({ schema: 1, source: descriptor.source, root: descriptor.root, revision, tree, sourceHash }, null, 2)}\n`,
		);
		const destination = join(parent, revision);
		const cached = await readCachedSource(destination, descriptor, revision);
		if (cached) return cached;
		try {
			await rename(staging, destination);
		} catch (cause) {
			if (!["EEXIST", "ENOTEMPTY"].includes((cause as NodeJS.ErrnoException).code ?? ""))
				throw cause;
			const concurrent = await readCachedSource(destination, descriptor, revision);
			if (!concurrent) throw cause;
			return concurrent;
		}
		return { root: join(destination, "tree"), revision, tree, sourceHash };
	} catch (cause) {
		if (cause instanceof ResponseError) throw cause;
		throw responseError(
			"PINNED_SOURCE_UNAVAILABLE",
			`Could not fetch source revision ${requested}.`,
			{ source: descriptor.source },
			cause,
		);
	} finally {
		await rm(staging, { recursive: true, force: true });
	}
}

async function readCachedSource(
	directory: string,
	descriptor: BundleDescriptor,
	revision: string,
): Promise<BundleSource | undefined> {
	if (!(await statOptional(directory))) return undefined;
	try {
		const manifest = cacheSchema.parse(
			JSON.parse(await readFile(join(directory, "manifest.json"), "utf8")),
		);
		const root = join(directory, "tree");
		if (
			manifest.source !== descriptor.source ||
			manifest.root !== descriptor.root ||
			manifest.revision !== revision ||
			manifest.sourceHash !== (await hashTree(root))
		)
			throw new Error("Cached identity or content differs from its manifest.");
		return {
			root,
			revision: manifest.revision,
			tree: manifest.tree,
			sourceHash: manifest.sourceHash,
		};
	} catch (cause) {
		throw responseError(
			"SOURCE_CACHE_CORRUPT",
			`Invalid cached source for ${revision}.`,
			{ source: descriptor.source, input: directory },
			cause,
		);
	}
}

interface RecordedPatch {
	skill: string;
	change: PatchManifest["patches"][number];
	path: string;
	intent: string;
}
async function readPatches(directory: string): Promise<RecordedPatch[]> {
	const patches: RecordedPatch[] = [];
	for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
		a.name.localeCompare(b.name),
	)) {
		if (entry.name === "bundle.toml" || entry.name === "lock.json") continue;
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

export async function pendingIntents(
	directory: string,
): Promise<{ skill: string; target: string; manifest: string }[]> {
	const missing: { skill: string; target: string; manifest: string }[] = [];
	const seen = new Set<string>();
	for (const { skill, change, intent } of await readPatches(directory)) {
		const key = skill + "/" + change.target;
		if (seen.has(key)) continue;
		seen.add(key);
		if (!intent.trim())
			missing.push({
				skill,
				target: change.target,
				manifest: join(directory, skill, "patch.toml"),
			});
	}
	return missing;
}

export async function hashPatchPack(directory: string): Promise<string> {
	const patches = await readPatches(directory);
	const hash = createHash("sha256");
	for (const { skill, change, path } of patches) {
		hash.update(JSON.stringify({ skill, ...change })).update("\0");
		const body = await readFile(path);
		hash.update(`${body.length}\0`).update(body);
	}
	return hash.digest("hex");
}

async function materializeBundle(
	workspace: string,
	bundle: string,
	destination: string,
	runtime: BundleRuntime,
	revision?: string,
): Promise<MaterializedBundle> {
	const pack = await readAdaptedBundle(workspace, bundle);
	if (!pack)
		throw responseError("PATCH_PACK_NOT_FOUND", `Patch pack not found: ${bundle}.`, {
			skill: bundle,
		});
	const patchHash = await hashPatchPack(pack.directory);
	if (patchHash !== pack.lock.patchHash)
		throw responseError(
			"BUNDLE_LOCK_DRIFT",
			`Patch artifacts or replay metadata changed for ${bundle}.`,
			{ skill: bundle },
		);
	const source = await acquireSource(pack.descriptor, revision ?? pack.lock.revision, runtime);
	if (
		!revision &&
		(source.revision !== pack.lock.revision ||
			source.tree !== pack.lock.tree ||
			source.sourceHash !== pack.lock.sourceHash)
	)
		throw responseError(
			"BUNDLE_LOCK_DRIFT",
			`Pinned source differs from the lock for ${bundle}.`,
			{ skill: bundle },
		);
	await cp(source.root, destination, { recursive: true, preserveTimestamps: true });
	const conflicts: ResponseErrorItem[] = [];
	const failedFiles = new Set<string>();
	for (const { skill, change, path } of await readPatches(pack.directory)) {
		const fileKey = skill + "/" + change.target;
		if (failedFiles.has(fileKey)) continue;
		const body = await readFile(path, "utf8");
		for (const mode of body.matchAll(
			/^(?:old mode|new mode|new file mode|deleted file mode) (\d+)$/gm,
		)) {
			if (mode[1] !== "100644" && mode[1] !== "100755")
				throw responseError("PATCH_PATH_UNSAFE", "Patches may only change regular files.", {
					skill,
					input: change.target,
				});
		}
		const targets = await runtime.git.patchTargets(path);
		if (targets.length !== 1 || targets[0] !== change.target.slice(2))
			throw responseError(
				"PATCH_TARGET_MISMATCH",
				`Patch must change only ${skill}/${change.target}.`,
				{ skill, input: change.patch },
			);
		const skillRoot = join(destination, pack.descriptor.skills_root, skill);
		await mkdir(skillRoot, { recursive: true });
		try {
			await runtime.git.applyPatch(skillRoot, path);
		} catch (cause) {
			failedFiles.add(fileKey);
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
	const outputs = await hashSkillOutputs(destination, pack.descriptor.skills_root);
	if (
		!revision &&
		JSON.stringify(outputs) !==
			JSON.stringify(
				Object.fromEntries(
					Object.entries(pack.lock.outputs).sort(([a], [b]) => a.localeCompare(b)),
				),
			)
	)
		throw responseError(
			"BUNDLE_LOCK_DRIFT",
			`Patched output differs from the lock for ${bundle}.`,
			{ skill: bundle },
		);
	const canonical = join(dirname(destination), "canonical");
	await mkdir(join(canonical, "skillbox", bundle), { recursive: true });
	await cp(join(destination, pack.descriptor.skills_root), join(canonical, "skillbox", bundle), {
		recursive: true,
		preserveTimestamps: true,
	});
	return {
		descriptor: pack.descriptor,
		revision: source.revision,
		tree: source.tree,
		sourceHash: source.sourceHash,
		patchHash,
		outputs,
		canonical,
	};
}

async function prepareBundle(
	workspace: string,
	bundle: string,
	output: string,
	runtime: BundleRuntime,
) {
	const target = resolve(workspace, output);
	if (await statOptional(target))
		throw responseError("DESTINATION_EXISTS", `Destination already exists: ${output}.`, {
			input: output,
		});
	const pack = await readAdaptedBundle(workspace, bundle);
	if (!pack)
		throw responseError("PATCH_PACK_NOT_FOUND", `Patch pack not found: ${bundle}.`, {
			skill: bundle,
		});
	await mkdir(target, { recursive: true });
	try {
		const source = await acquireSource(pack.descriptor, pack.lock.revision, runtime);
		await cp(source.root, join(target, "pristine"), {
			recursive: true,
			preserveTimestamps: true,
		});
		await materializeBundle(workspace, bundle, join(target, "edited"), runtime);
		await rm(join(target, "canonical"), { recursive: true });
		await writeFile(
			join(target, "manifest.json"),
			`${JSON.stringify({ schema: 1, bundle, source: pack.descriptor.source, revision: source.revision, sourceHash: source.sourceHash, patchHash: pack.lock.patchHash }, null, 2)}\n`,
		);
		return {
			workspace: target,
			editable: join(target, "edited"),
			revision: source.revision,
			source: pack.descriptor.source,
		};
	} catch (cause) {
		await rm(target, { recursive: true, force: true });
		throw cause;
	}
}

export async function hashSkillOutputs(
	root: string,
	skillsRoot: string,
): Promise<Record<string, string>> {
	const directory = join(root, skillsRoot);
	const result: Record<string, string> = {};
	for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
		a.name.localeCompare(b.name),
	)) {
		if (!entry.isDirectory() || !(await statOptional(join(directory, entry.name, "SKILL.md"))))
			continue;
		bundleSchema.parse(entry.name);
		result[entry.name] = await hashTree(join(directory, entry.name));
	}
	return result;
}

export async function hashTree(root: string): Promise<string> {
	return hashFiles(root, await regularTree(root));
}
async function hashFiles(root: string, files: string[]): Promise<string> {
	const hash = createHash("sha256");
	for (const path of files) {
		const entry = await lstat(join(root, path));
		if (!entry.isFile())
			throw responseError("PATCH_PATH_UNSAFE", `Expected a regular file: ${path}.`, {
				input: path,
			});
		const body = await readFile(join(root, path));
		hash.update(`${path}\0${entry.mode & 0o111 ? "x" : "f"}\0${body.length}\0`).update(body);
	}
	return hash.digest("hex");
}
async function regularTree(root: string): Promise<string[]> {
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
function sourceRepository(source: string): string {
	return /^[\w.-]+\/[\w.-]+$/.test(source) ? `https://github.com/${source}.git` : source;
}
export function descriptorText(value: BundleDescriptor): string {
	return stringify(descriptorSchema.parse(value));
}
export function lockText(value: BundleLock): string {
	return `${JSON.stringify(bundleLockSchema.parse(value), null, 2)}\n`;
}
