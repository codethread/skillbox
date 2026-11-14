import { createHash } from "node:crypto";
import {
	cp,
	lstat,
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	realpath,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, posix, resolve, sep } from "node:path";
import { xdgCache } from "xdg-basedir";
import { parse, stringify } from "smol-toml";
import { z } from "zod";
import { ResponseError, responseError, type ResponseErrorItem } from "../response.ts";
import { bundleSchema } from "./config.ts";
import { localPath, statOptional } from "./paths.ts";
import { createPatchGit, type PatchGit } from "./patch-git.ts";
import { inspectRepositorySource } from "./sdk.ts";

const revisionSchema = z.string().regex(/^[0-9a-f]{40}$/);
const digestSchema = z.string().regex(/^[0-9a-f]{64}$/);
const sourceSchema = z
	.string()
	.min(1)
	.refine((value) => !value.startsWith("-") && !/[\0\r\n]/.test(value));
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

export const sourcePinSchema = z.discriminatedUnion("type", [
	z.strictObject({ type: z.literal("git"), revision: revisionSchema, tree: revisionSchema }),
	z.strictObject({ type: z.literal("local"), digest: digestSchema }),
]);
const gitDescriptorSchema = z.strictObject({
	schema: z.literal(1),
	bundle: bundleSchema,
	source_type: z.literal("git"),
	source: sourceSchema,
	upstream: z.string().min(1),
	root: relativePath,
	skills_root: relativePath,
	update_ref: z.string().min(1).optional(),
});
const importedDescriptorSchema = z.strictObject({
	schema: z.literal(1),
	bundle: bundleSchema,
	source_type: z.literal("bundle"),
	source: sourceSchema,
	repository: sourceSchema,
	root: relativePath,
	source_bundle: bundleSchema,
	skills_root: relativePath,
	update_ref: z.string().min(1).optional(),
});
export const descriptorSchema = z.discriminatedUnion("source_type", [
	gitDescriptorSchema,
	importedDescriptorSchema,
]);
export const bundleLockSchema = z.strictObject({
	schema: z.literal(1),
	source: z.string().min(1),
	root: relativePath,
	pin: sourcePinSchema,
	sourceHash: digestSchema,
	patchHash: digestSchema,
});
export const patchSchema = z.strictObject({
	schema: z.literal(1),
	files: z.record(targetSchema, z.strictObject({ intent: z.string() })),
	patches: z.array(
		z.strictObject({
			target: targetSchema,
			patch: relativePath,
		}),
	),
});
const cacheSchema = z.strictObject({
	schema: z.literal(1),
	source: z.string().min(1),
	root: relativePath,
	source_bundle: bundleSchema.optional(),
	pin: sourcePinSchema,
	sourceHash: digestSchema,
});
export const preparedSchema = z.strictObject({
	schema: z.literal(1),
	bundle: bundleSchema,
	source: z.string().min(1),
	pin: sourcePinSchema,
	sourceHash: digestSchema,
	patchHash: digestSchema,
	previous_pin: sourcePinSchema.optional(),
});

export type SourcePin = z.infer<typeof sourcePinSchema>;
export type BundleDescriptor = z.infer<typeof descriptorSchema>;
export type BundleLock = z.infer<typeof bundleLockSchema>;
export type PatchManifest = z.infer<typeof patchSchema>;
export interface BundleSource {
	root: string;
	pin: SourcePin;
	sourceHash: string;
}
export interface MaterializedBundle extends Omit<BundleSource, "root"> {
	descriptor: BundleDescriptor;
	patchHash: string;
	outputs: Record<string, string>;
	canonical: string;
}
export interface ResolvedExportedBundle {
	source: string;
	bundle: string;
	descriptor: BundleDescriptor;
	lock: BundleLock;
	canonical: string;
	dispose(): Promise<void>;
}
export interface AdaptedBundles {
	diffFiles(before: string, after: string): Promise<{ target: string; body: string }[]>;
	acquireSource(
		descriptor: BundleDescriptor,
		requested: SourcePin | string,
		workspace: string,
	): Promise<BundleSource>;
	resolveExportedBundle(input: {
		source: string;
		bundle: string;
		cwd: string;
		workspace: string;
	}): Promise<ResolvedExportedBundle | undefined>;
	materializeBundle(
		workspace: string,
		bundle: string,
		destination: string,
		requested?: SourcePin | string,
	): Promise<MaterializedBundle>;
	prepareBundle(
		workspace: string,
		bundle: string,
		output: string,
	): Promise<{ workspace: string; editable: string; pin: SourcePin; source: string }>;
}
interface BundleRuntime {
	cacheDirectory: string;
	git: PatchGit;
	activeImports: Set<string>;
}
interface ProducerCheckout {
	root: string;
	source: string;
	repository: string;
	pin: SourcePin;
	updateRef: string;
	dispose(): Promise<void>;
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
		activeImports: new Set(),
	};
	return {
		diffFiles: runtime.git.diffFiles,
		acquireSource: (descriptor, requested, workspace) =>
			acquireSource(descriptor, requested, workspace, runtime),
		resolveExportedBundle: (input) => resolveExportedBundle(input, runtime),
		materializeBundle: (workspace, bundle, destination, requested) =>
			materializeBundle(workspace, bundle, destination, runtime, requested),
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

async function resolveExportedBundle(
	input: { source: string; bundle: string; cwd: string; workspace: string },
	runtime: BundleRuntime,
): Promise<ResolvedExportedBundle | undefined> {
	const bundle = bundleSchema.parse(input.bundle);
	await mkdir(runtime.cacheDirectory, { recursive: true });
	const checkout = await checkoutProducer(
		input.source,
		bundle,
		input.cwd,
		input.workspace,
		runtime,
	);
	if (!checkout) return undefined;
	let retained = false;
	try {
		const pack = await readAdaptedBundle(checkout.root, bundle);
		if (!pack) return undefined;
		if (await hasNativeBundle(checkout.root, bundle))
			throw responseError(
				"BUNDLE_SOURCE_AMBIGUOUS",
				`Source exports both a native and adapted bundle named ${bundle}.`,
				{ source: input.source, skill: bundle },
			);
		await requireProducerIntents(pack.directory);
		const staging = await mkdtemp(join(runtime.cacheDirectory, "exports-"));
		try {
			const materialized = await materializeBundle(
				checkout.root,
				bundle,
				join(staging, "producer"),
				runtime,
			);
			await rm(materialized.canonical, { recursive: true, force: true });
			await normalizeImportedBaseline(
				join(staging, "producer"),
				pack.descriptor.skills_root,
				join(staging, "tree"),
			);
			const sourceHash = await hashTree(join(staging, "tree"));
			const descriptor: BundleDescriptor = {
				schema: 1,
				bundle,
				source_type: "bundle",
				source: checkout.source,
				repository: checkout.repository,
				root: ".",
				source_bundle: bundle,
				skills_root: "skills",
				update_ref: checkout.updateRef,
			};
			const cached = await cacheSource(
				descriptor,
				checkout.pin,
				join(staging, "tree"),
				sourceHash,
				runtime,
			);
			const canonical = join(staging, "canonical");
			await createCanonical(cached.root, descriptor.skills_root, bundle, canonical);
			const lock: BundleLock = {
				schema: 1,
				source: descriptor.source,
				root: descriptor.root,
				pin: checkout.pin,
				sourceHash,
				patchHash: await hashPatchPackEmpty(),
			};
			retained = true;
			return {
				source: checkout.source,
				bundle,
				descriptor,
				lock,
				canonical,
				dispose: async () => {
					await rm(staging, { recursive: true, force: true });
					await checkout.dispose();
				},
			};
		} finally {
			if (!retained) await rm(staging, { recursive: true, force: true });
		}
	} finally {
		if (!retained) await checkout.dispose();
	}
}

async function checkoutProducer(
	source: string,
	bundle: string,
	cwd: string,
	workspace: string,
	runtime: BundleRuntime,
): Promise<ProducerCheckout | undefined> {
	const local = isLocalSource(source);
	if (local) {
		let root: string;
		try {
			root = await realpath(resolve(cwd, source));
		} catch (cause) {
			throw responseError(
				"SOURCE_NOT_FOUND",
				`Local source does not exist: ${source}`,
				{ source },
				cause,
			);
		}
		const recorded = localPath(workspace, root);
		return {
			root,
			source: recorded,
			repository: recorded,
			pin: { type: "local", digest: await producerDigest(root, bundle) },
			updateRef: "WORKTREE",
			dispose: async () => {},
		};
	}
	const inspected = await inspectRepositorySource(source, cwd);
	if (inspected.kind === "other") return undefined;
	const parsed =
		inspected.kind === "repository"
			? { repository: inspected.repository, ref: inspected.ref }
			: parseAdaptedRemoteSource(source);
	if (!parsed) return undefined;
	const staging = await mkdtemp(join(runtime.cacheDirectory, "producer-"));
	try {
		const root = join(staging, "tree");
		const fetched = await runtime.git.fetchTree(
			sourceRepository(parsed.repository),
			parsed.ref,
			".",
			root,
		);
		return {
			root,
			source,
			repository: parsed.repository,
			pin: {
				type: "git",
				revision: revisionSchema.parse(fetched.revision),
				tree: revisionSchema.parse(fetched.tree),
			},
			updateRef: parsed.ref,
			dispose: async () => rm(staging, { recursive: true, force: true }),
		};
	} catch (cause) {
		await rm(staging, { recursive: true, force: true });
		if (cause instanceof ResponseError) throw cause;
		throw responseError(
			"SOURCE_RESOLUTION_FAILED",
			`Could not inspect source ${source}.`,
			{ source },
			cause,
		);
	}
}

async function acquireSource(
	descriptor: BundleDescriptor,
	requested: SourcePin | string,
	workspace: string,
	runtime: BundleRuntime,
): Promise<BundleSource> {
	descriptorSchema.parse(descriptor);
	await mkdir(runtime.cacheDirectory, { recursive: true });
	if (descriptor.source_type === "git") return acquireGitSubtree(descriptor, requested, runtime);
	return acquireImportedBundle(descriptor, requested, workspace, runtime);
}

async function acquireGitSubtree(
	descriptor: z.infer<typeof gitDescriptorSchema>,
	requested: SourcePin | string,
	runtime: BundleRuntime,
): Promise<BundleSource> {
	if (typeof requested !== "string" && requested.type !== "git")
		throw responseError("PIN_TYPE_MISMATCH", "A Git source requires a Git pin.", {
			source: descriptor.source,
		});
	const ref = typeof requested === "string" ? requested : requested.revision;
	requireRef(ref);
	const expected = typeof requested === "string" ? undefined : requested;
	const cached = expected
		? await readCachedSource(cachePath(descriptor, expected, runtime), descriptor, expected)
		: undefined;
	if (cached) return cached;
	const staging = await mkdtemp(join(runtime.cacheDirectory, "fetch-"));
	try {
		const root = join(staging, "tree");
		const fetched = await runtime.git.fetchTree(
			sourceRepository(descriptor.source),
			ref,
			descriptor.root,
			root,
		);
		const pin: SourcePin = {
			type: "git",
			revision: revisionSchema.parse(fetched.revision),
			tree: revisionSchema.parse(fetched.tree),
		};
		if (expected && !samePin(expected, pin))
			throw new Error("Fetched Git tree differs from the requested pin.");
		return await cacheSource(descriptor, pin, root, await hashTree(root), runtime);
	} catch (cause) {
		if (cause instanceof ResponseError) throw cause;
		throw responseError(
			"PINNED_SOURCE_UNAVAILABLE",
			`Could not fetch source revision ${ref}.`,
			{ source: descriptor.source },
			cause,
		);
	} finally {
		await rm(staging, { recursive: true, force: true });
	}
}

async function acquireImportedBundle(
	descriptor: z.infer<typeof importedDescriptorSchema>,
	requested: SourcePin | string,
	workspace: string,
	runtime: BundleRuntime,
): Promise<BundleSource> {
	const local = isLocalSource(descriptor.source);
	if (typeof requested !== "string") {
		if ((local && requested.type !== "local") || (!local && requested.type !== "git"))
			throw responseError(
				"PIN_TYPE_MISMATCH",
				"Producer source and recorded pin use different identity types.",
				{ source: descriptor.source },
			);
		const cached = await readCachedSource(
			cachePath(descriptor, requested, runtime),
			descriptor,
			requested,
		);
		if (cached) return cached;
	}
	if (local) {
		const producerRoot = resolve(workspace, descriptor.source, descriptor.root);
		const pin =
			typeof requested === "string"
				? {
						type: "local" as const,
						digest: await producerDigest(producerRoot, descriptor.source_bundle),
					}
				: requested;
		return materializeProducerSource(descriptor, producerRoot, pin, runtime);
	}
	if (typeof requested !== "string" && requested.type !== "git")
		throw responseError("PIN_TYPE_MISMATCH", "A Git producer requires a Git pin.", {
			source: descriptor.source,
		});
	const ref = typeof requested === "string" ? requested : requested.revision;
	requireRef(ref);
	const staging = await mkdtemp(join(runtime.cacheDirectory, "producer-fetch-"));
	try {
		const producerRoot = join(staging, "tree");
		const fetched = await runtime.git.fetchTree(
			descriptor.repository,
			ref,
			descriptor.root,
			producerRoot,
		);
		const pin: SourcePin = {
			type: "git",
			revision: revisionSchema.parse(fetched.revision),
			tree: revisionSchema.parse(fetched.tree),
		};
		if (typeof requested !== "string" && !samePin(requested, pin))
			throw new Error("Fetched producer tree differs from the requested pin.");
		return await materializeProducerSource(descriptor, producerRoot, pin, runtime);
	} catch (cause) {
		if (cause instanceof ResponseError) throw cause;
		throw responseError(
			"PRODUCER_SNAPSHOT_UNAVAILABLE",
			`Could not resolve producer snapshot ${ref}.`,
			{ source: descriptor.source, skill: descriptor.source_bundle },
			cause,
		);
	} finally {
		await rm(staging, { recursive: true, force: true });
	}
}

async function materializeProducerSource(
	descriptor: z.infer<typeof importedDescriptorSchema>,
	producerRoot: string,
	pin: SourcePin,
	runtime: BundleRuntime,
): Promise<BundleSource> {
	const pack = await readAdaptedBundle(producerRoot, descriptor.source_bundle);
	if (!pack)
		throw responseError(
			"PRODUCER_BUNDLE_NOT_FOUND",
			`Producer snapshot does not contain adapted bundle ${descriptor.source_bundle}.`,
			{ source: descriptor.source, skill: descriptor.source_bundle },
		);
	if (pin.type === "local") {
		const actual = await producerDigest(producerRoot, descriptor.source_bundle);
		if (actual !== pin.digest)
			throw responseError(
				"PRODUCER_SNAPSHOT_UNAVAILABLE",
				"Local producer changed and the recorded snapshot is not cached.",
				{ source: descriptor.source, skill: descriptor.source_bundle },
			);
	}
	await requireProducerIntents(pack.directory);
	const activeKey = `${descriptor.source}\0${descriptor.source_bundle}\0${pinKey(pin)}`;
	if (runtime.activeImports.has(activeKey))
		throw responseError("BUNDLE_IMPORT_CYCLE", "Adapted bundle imports form a cycle.", {
			source: descriptor.source,
			skill: descriptor.source_bundle,
		});
	runtime.activeImports.add(activeKey);
	const staging = await mkdtemp(join(runtime.cacheDirectory, "materialize-"));
	try {
		const materialized = await materializeBundle(
			producerRoot,
			descriptor.source_bundle,
			join(staging, "producer"),
			runtime,
		);
		await rm(materialized.canonical, { recursive: true, force: true });
		await normalizeImportedBaseline(
			join(staging, "producer"),
			pack.descriptor.skills_root,
			join(staging, "tree"),
		);
		const sourceHash = await hashTree(join(staging, "tree"));
		return await cacheSource(descriptor, pin, join(staging, "tree"), sourceHash, runtime);
	} catch (cause) {
		if (cause instanceof ResponseError) throw cause;
		throw responseError(
			"PRODUCER_REPLAY_FAILED",
			`Could not materialize producer bundle ${descriptor.source_bundle}.`,
			{ source: descriptor.source, skill: descriptor.source_bundle },
			cause,
		);
	} finally {
		runtime.activeImports.delete(activeKey);
		await rm(staging, { recursive: true, force: true });
	}
}

async function cacheSource(
	descriptor: BundleDescriptor,
	pin: SourcePin,
	root: string,
	sourceHash: string,
	runtime: BundleRuntime,
): Promise<BundleSource> {
	const destination = cachePath(descriptor, pin, runtime);
	const cached = await readCachedSource(destination, descriptor, pin);
	if (cached) return cached;
	await mkdir(dirname(destination), { recursive: true });
	const staging = await mkdtemp(join(dirname(destination), ".cache-"));
	try {
		await cp(root, join(staging, "tree"), { recursive: true, preserveTimestamps: true });
		await writeFile(
			join(staging, "manifest.json"),
			`${JSON.stringify(
				{
					schema: 1,
					source: descriptor.source,
					root: descriptor.root,
					...(descriptor.source_type === "bundle"
						? { source_bundle: descriptor.source_bundle }
						: {}),
					pin,
					sourceHash,
				},
				null,
				2,
			)}\n`,
		);
		try {
			await rename(staging, destination);
		} catch (cause) {
			if (!["EEXIST", "ENOTEMPTY"].includes((cause as NodeJS.ErrnoException).code ?? ""))
				throw cause;
			const concurrent = await readCachedSource(destination, descriptor, pin);
			if (!concurrent) throw cause;
			return concurrent;
		}
		return { root: join(destination, "tree"), pin, sourceHash };
	} finally {
		await rm(staging, { recursive: true, force: true });
	}
}

async function readCachedSource(
	directory: string,
	descriptor: BundleDescriptor,
	pin: SourcePin,
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
			manifest.source_bundle !==
				(descriptor.source_type === "bundle" ? descriptor.source_bundle : undefined) ||
			!samePin(manifest.pin, pin) ||
			manifest.sourceHash !== (await hashTree(root))
		)
			throw new Error("Cached identity or content differs from its manifest.");
		return { root, pin: manifest.pin, sourceHash: manifest.sourceHash };
	} catch (cause) {
		throw responseError(
			"SOURCE_CACHE_CORRUPT",
			`Invalid cached source for ${pinKey(pin)}.`,
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

async function hashPatchPackEmpty(): Promise<string> {
	return createHash("sha256").digest("hex");
}

async function materializeBundle(
	workspace: string,
	bundle: string,
	destination: string,
	runtime: BundleRuntime,
	requested?: SourcePin | string,
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
	const source = await acquireSource(
		pack.descriptor,
		requested ?? pack.lock.pin,
		workspace,
		runtime,
	);
	if (
		requested === undefined &&
		(!samePin(source.pin, pack.lock.pin) || source.sourceHash !== pack.lock.sourceHash)
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
	const canonical = join(dirname(destination), "canonical");
	await createCanonical(destination, pack.descriptor.skills_root, bundle, canonical);
	return {
		descriptor: pack.descriptor,
		pin: source.pin,
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
		const source = await acquireSource(pack.descriptor, pack.lock.pin, workspace, runtime);
		await cp(source.root, join(target, "pristine"), {
			recursive: true,
			preserveTimestamps: true,
		});
		await materializeBundle(workspace, bundle, join(target, "edited"), runtime);
		await rm(join(target, "canonical"), { recursive: true });
		await writeFile(
			join(target, "manifest.json"),
			`${JSON.stringify(
				{
					schema: 1,
					bundle,
					source: pack.descriptor.source,
					pin: source.pin,
					sourceHash: source.sourceHash,
					patchHash: pack.lock.patchHash,
				},
				null,
				2,
			)}\n`,
		);
		return {
			workspace: target,
			editable: join(target, "edited"),
			pin: source.pin,
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

async function createCanonical(
	root: string,
	skillsRoot: string,
	bundle: string,
	canonical: string,
): Promise<void> {
	await mkdir(join(canonical, "skillbox", bundle), { recursive: true });
	await cp(join(root, skillsRoot), join(canonical, "skillbox", bundle), {
		recursive: true,
		preserveTimestamps: true,
	});
}

async function normalizeImportedBaseline(
	producerRoot: string,
	producerSkillsRoot: string,
	destination: string,
): Promise<void> {
	await mkdir(destination, { recursive: true });
	await cp(join(producerRoot, producerSkillsRoot), join(destination, "skills"), {
		recursive: true,
		preserveTimestamps: true,
	});
}

async function hasNativeBundle(root: string, bundle: string): Promise<boolean> {
	const directory = join(root, "skillbox", bundle);
	const entry = await statOptional(directory);
	if (!entry?.isDirectory()) return false;
	for (const skill of await readdir(directory, { withFileTypes: true })) {
		if (skill.isDirectory() && (await statOptional(join(directory, skill.name, "SKILL.md"))))
			return true;
	}
	return false;
}

async function requireProducerIntents(directory: string): Promise<void> {
	const missing = await pendingIntents(directory);
	if (!missing.length) return;
	throw new ResponseError(
		missing.map(({ skill, target, manifest }) => ({
			code: "PRODUCER_INTENT_REQUIRED",
			message: `Producer must add intent for ${skill}/${target} before export.`,
			skill,
			target,
			input: manifest,
		})),
	);
}

async function producerDigest(root: string, bundle: string): Promise<string> {
	const pack = join(root, "skillbox", "patches", bundle);
	const entry = await statOptional(pack);
	if (!entry?.isDirectory()) return createHash("sha256").digest("hex");
	return hashTree(pack);
}

function cachePath(descriptor: BundleDescriptor, pin: SourcePin, runtime: BundleRuntime): string {
	const sourceBundle = descriptor.source_type === "bundle" ? descriptor.source_bundle : "";
	const repository = descriptor.source_type === "bundle" ? descriptor.repository : "";
	const key = createHash("sha256")
		.update(`${descriptor.source}\0${descriptor.root}\0${sourceBundle}\0${repository}`)
		.digest("hex");
	return join(runtime.cacheDirectory, "sources", key, pinKey(pin));
}

function pinKey(pin: SourcePin): string {
	return pin.type === "git" ? pin.revision : pin.digest;
}

export function samePin(left: SourcePin, right: SourcePin): boolean {
	return (
		left.type === right.type &&
		(left.type === "git"
			? left.revision === (right as typeof left).revision &&
				left.tree === (right as typeof left).tree
			: left.digest === (right as typeof left).digest)
	);
}

function isLocalSource(source: string): boolean {
	return isAbsolute(source) || source.startsWith(".");
}

function parseAdaptedRemoteSource(source: string): { repository: string; ref: string } | undefined {
	const hash = source.indexOf("#");
	const sourceWithoutFragment = hash < 0 ? source : source.slice(0, hash);
	const fragment = hash < 0 ? undefined : source.slice(hash + 1).split("@", 1)[0];
	const fragmentRef = fragment ? decodePathPart(fragment) : undefined;

	if (/^[\w.-]+\/[\w.-]+$/.test(sourceWithoutFragment))
		return {
			repository: sourceRepository(sourceWithoutFragment),
			ref: fragmentRef ?? "HEAD",
		};
	if (
		sourceWithoutFragment.startsWith("git@") ||
		sourceWithoutFragment.startsWith("ssh://") ||
		sourceWithoutFragment.startsWith("file://") ||
		/^https?:\/\/.+\.git\/?$/i.test(sourceWithoutFragment)
	)
		return { repository: sourceWithoutFragment, ref: fragmentRef ?? "HEAD" };

	let url: URL;
	try {
		url = new URL(sourceWithoutFragment);
	} catch {
		return undefined;
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
	const path = url.pathname.replace(/^\/+|\/+$/g, "");
	const segments = path.split("/").filter(Boolean);
	if (url.hostname === "github.com") {
		if (segments.length < 2) return undefined;
		const tree = segments[2] === "tree" ? segments[3] : undefined;
		return {
			repository: `${url.protocol}//${url.host}/${segments[0]}/${segments[1]!.replace(/\.git$/, "")}.git`,
			ref: tree ? decodePathPart(tree) : (fragmentRef ?? "HEAD"),
		};
	}
	const gitLabTree = segments.findIndex(
		(segment, index) => segment === "-" && segments[index + 1] === "tree",
	);
	if (gitLabTree >= 2 && segments[gitLabTree + 2])
		return {
			repository: `${url.protocol}//${url.host}/${segments
				.slice(0, gitLabTree)
				.join("/")
				.replace(/\.git$/, "")}.git`,
			ref: decodePathPart(segments[gitLabTree + 2]!),
		};
	if (url.hostname === "gitlab.com" && segments.length >= 2)
		return {
			repository: `${url.protocol}//${url.host}/${segments.join("/").replace(/\.git$/, "")}.git`,
			ref: fragmentRef ?? "HEAD",
		};
	return undefined;
}

function decodePathPart(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

function requireRef(ref: string): void {
	if (!ref || ref.startsWith("-") || /[\0\r\n]/.test(ref))
		throw responseError("REVISION_INVALID", "Specify a Git ref or immutable commit.", {
			input: ref,
		});
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
