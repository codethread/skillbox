import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parse, stringify } from "smol-toml";
import { z } from "zod";
import { add } from "./add.ts";
import { sync } from "./sync.ts";
import {
	bundleLockSchema,
	descriptorSchema,
	descriptorText,
	hashPatchPack,
	hashSkillOutputs,
	hashTree,
	lockText,
	patchSchema,
	preparedSchema,
	type AdaptedBundles,
	type BundleDescriptor,
	type PatchManifest,
} from "../workspace/adapted.ts";
import { bundleSchema } from "../workspace/config.ts";
import { readOptional, statOptional } from "../workspace/paths.ts";
import { ResponseError, responseError } from "../response.ts";

export async function patchInit(input: {
	adapted: AdaptedBundles;
	cwd: string;
	workspace: string;
	bundle: string;
	source: string;
	root?: string;
	skillsRoot?: string;
	ref?: string;
	updateRef?: string;
}) {
	const bundle = input.bundle;
	const inferred = inferSource(input.source);
	const descriptor: BundleDescriptor = {
		schema: 1,
		bundle,
		source: inferred.source,
		upstream: input.source,
		root: input.root ?? inferred.root ?? bundle,
		skills_root: input.skillsRoot ?? "skills",
		...(input.updateRef
			? { update_ref: input.updateRef }
			: inferred.ref
				? { update_ref: inferred.ref }
				: {}),
	};
	const revision = input.ref ?? inferred.ref ?? descriptor.update_ref;
	if (!revision)
		throw responseError("REVISION_REQUIRED", "Specify --ref for an exact imported revision.", {
			source: input.source,
		});
	const workspace = input.workspace;
	const livePack = join(workspace, "skillbox/patches", bundle);
	if (await statOptional(livePack))
		throw responseError("PATCH_PACK_EXISTS", `Patch pack already exists: ${bundle}.`, {
			skill: bundle,
		});
	const source = await input.adapted.acquireSource(descriptor, revision);
	const temp = await mkdtemp(join(workspace, ".skillbox-init-"));
	const packWorkspace = join(temp, "workspace");
	const pack = join(packWorkspace, "skillbox/patches", bundle);
	await mkdir(pack, { recursive: true });
	await writeFile(join(pack, "bundle.toml"), descriptorText(descriptor));
	await writeFile(
		join(pack, "lock.json"),
		lockText({
			schema: 1,
			source: descriptor.source,
			root: descriptor.root,
			revision: source.revision,
			tree: source.tree,
			sourceHash: source.sourceHash,
			patchHash: await emptyHash(),
			outputs: {},
		}),
	);
	try {
		const materialized = await input.adapted.materializeBundle(
			packWorkspace,
			bundle,
			join(temp, "patched"),
			source.revision,
		);
		await writeFile(
			join(pack, "lock.json"),
			lockText({
				schema: 1,
				source: descriptor.source,
				root: descriptor.root,
				revision: source.revision,
				tree: source.tree,
				sourceHash: source.sourceHash,
				patchHash: await emptyHash(),
				outputs: materialized.outputs,
			}),
		);
		const result = await add({
			cwd: input.cwd,
			workspace,
			source: materialized.canonical,
			bundles: [bundle],
			publication: {
				bundle,
				pack,
				configuredSource: descriptor.source,
				revision: source.revision,
				root: descriptor.root,
				skillsRoot: descriptor.skills_root,
			},
		});
		return {
			status: result.status,
			bundle,
			source: descriptor.source,
			revision: source.revision,
			skills: result.installed,
			changed: result.installed,
		};
	} finally {
		await rm(temp, { recursive: true, force: true });
	}
}

export async function patchPrepare(input: {
	adapted: AdaptedBundles;
	workspace: string;
	bundle: string;
	output: string;
}) {
	return input.adapted.prepareBundle(input.workspace, input.bundle, input.output);
}

export async function patchUpdate(input: {
	adapted: AdaptedBundles;
	workspace: string;
	bundle: string;
	ref?: string;
}) {
	bundleSchema.parse(input.bundle);
	const pack = join(input.workspace, "skillbox/patches", input.bundle);
	const descriptor = descriptorSchema.parse(
		parse(await readFile(join(pack, "bundle.toml"), "utf8")),
	);
	const current = bundleLockSchema.parse(
		JSON.parse(await readFile(join(pack, "lock.json"), "utf8")),
	);
	const requested = input.ref ?? descriptor.update_ref;
	if (!requested)
		throw responseError("REVISION_REQUIRED", "Specify --ref or configure update_ref.", {
			skill: input.bundle,
		});
	const source = await input.adapted.acquireSource(descriptor, requested);
	const temp = await mkdtemp(join(input.workspace, `.skillbox-update-${input.bundle}-`));
	let probed: Awaited<ReturnType<AdaptedBundles["materializeBundle"]>>;
	try {
		probed = await input.adapted.materializeBundle(
			input.workspace,
			input.bundle,
			join(temp, "edited"),
			source.revision,
		);
	} catch (cause) {
		if (
			!(cause instanceof ResponseError) ||
			cause.errors.some((error) => error.code !== "PATCH_APPLY_FAILED")
		) {
			await rm(temp, { recursive: true, force: true });
			throw cause;
		}
		const pristine = join(temp, "pristine");
		const edited = join(temp, "edited");
		await cp(source.root, pristine, { recursive: true, preserveTimestamps: true });
		await writeFile(
			join(temp, "manifest.json"),
			`${JSON.stringify({ schema: 1, bundle: input.bundle, source: descriptor.source, revision: source.revision, sourceHash: source.sourceHash, patchHash: current.patchHash, previous_revision: current.revision }, null, 2)}\n`,
		);
		const conflicts = cause.errors.map((error) => ({
			skill: error.skill,
			target: error.target ?? error.input,
			patch: error.patch,
			reason: error.reason ?? error.message,
		}));
		throw new ResponseError(
			[
				{
					code: "UPDATE_CONFLICT",
					message: `Patches do not replay on ${source.revision}.`,
					source: descriptor.source,
					skill: input.bundle,
				},
			],
			{
				cause,
				data: {
					bundle: input.bundle,
					source: descriptor.source,
					from: current.revision,
					to: source.revision,
					workspace: temp,
					editable: edited,
					conflicts,
				},
			},
		);
	}
	await rm(temp, { recursive: true, force: true });
	const publication = await mkdtemp(
		join(input.workspace, `.skillbox-update-publish-${input.bundle}-`),
	);
	const stagedPack = join(publication, "pack");
	await cp(pack, stagedPack, { recursive: true, preserveTimestamps: true });
	await writeFile(
		join(stagedPack, "lock.json"),
		lockText({
			...current,
			revision: source.revision,
			tree: source.tree,
			sourceHash: source.sourceHash,
			outputs: probed.outputs,
		}),
	);
	try {
		await sync({
			adapted: input.adapted,
			cwd: input.workspace,
			workspace: input.workspace,
			acceptContentChangesForBundle: input.bundle,
			bundlePackOverrides: { [input.bundle]: stagedPack },
		});
	} finally {
		await rm(publication, { recursive: true, force: true });
	}
	return {
		status: current.revision === source.revision ? "unchanged" : "updated",
		bundle: input.bundle,
		source: descriptor.source,
		revision: source.revision,
		from: current.revision,
		to: source.revision,
		changed: current.revision === source.revision ? 0 : 1,
	};
}

export async function patchCapture(input: {
	adapted: AdaptedBundles;
	workspace: string;
	bundle: string;
	from: string;
	skill?: string;
	intent?: string;
	intentFile?: string;
	maps?: string[];
}) {
	bundleSchema.parse(input.bundle);
	if (input.skill) bundleSchema.parse(input.skill);
	if (input.intent !== undefined && input.intentFile !== undefined)
		throw responseError("INTENT_INPUT_CONFLICT", "Choose --intent or --intent-file, not both.");
	for (const mapping of input.maps ?? []) {
		const paths = mapping.split("=");
		if (
			paths.length !== 2 ||
			paths.some((path) => !path.includes("/")) ||
			paths[0]!.split("/")[0] !== paths[1]!.split("/")[0]
		)
			throw responseError(
				"RENAME_MAP_INVALID",
				"Use --map skill/old-path=skill/new-path within one skill.",
				{ input: mapping },
			);
		for (const path of paths) patchSchema.shape.change.element.shape.target.parse(`./${path}`);
	}
	const outer = resolve(input.workspace, input.from);
	const manifest = preparedSchema.parse(
		JSON.parse(await readFile(join(outer, "manifest.json"), "utf8")),
	);
	if (manifest.bundle !== input.bundle)
		throw responseError("REGEN_WORKSPACE_INVALID", "Workspace belongs to a different bundle.", {
			input: input.from,
		});
	let pack = join(input.workspace, "skillbox/patches", input.bundle);
	const intents = await readIntents(input);
	const descriptor = descriptorSchema.parse(
		parse(await readFile(join(pack, "bundle.toml"), "utf8")),
	);
	const bundleLock = bundleLockSchema.parse(
		JSON.parse(await readFile(join(pack, "lock.json"), "utf8")),
	);
	const expectedLockedRevision = manifest.previous_revision ?? manifest.revision;
	if (manifest.source !== descriptor.source || expectedLockedRevision !== bundleLock.revision)
		throw responseError(
			"REGEN_WORKSPACE_INVALID",
			"Prepared workspace provenance does not match the bundle lock.",
			{ input: input.from },
		);
	if (manifest.patchHash !== bundleLock.patchHash)
		throw responseError(
			"REGEN_WORKSPACE_INVALID",
			"Prepared workspace patch series is stale.",
			{ input: input.from },
		);
	const pinnedSource = await input.adapted.acquireSource(descriptor, manifest.revision);
	if (
		manifest.sourceHash !== pinnedSource.sourceHash ||
		manifest.sourceHash !== (await hashTree(join(outer, "pristine")))
	)
		throw responseError("REGEN_WORKSPACE_INVALID", "Prepared pristine source was modified.", {
			input: input.from,
		});
	if ((await hashPatchPack(pack)) !== bundleLock.patchHash)
		throw responseError(
			"BUNDLE_LOCK_DRIFT",
			"The recorded patch pack was changed after preparation.",
			{ skill: input.bundle },
		);
	const skillsRoot = descriptor.skills_root;
	const sourceChanges = (
		await input.adapted.diffFiles(join(outer, "pristine"), join(outer, "edited"))
	).map(({ target }) => target);
	const skillsPrefix = `${skillsRoot.replace(/\/$/, "")}/`;
	const outside =
		skillsRoot === "."
			? undefined
			: sourceChanges.find((path) => !path.startsWith(skillsPrefix));
	if (outside)
		throw responseError(
			"CAPTURE_OUTSIDE_SKILLS",
			`Edit outside distributable skills root: ${outside}.`,
			{ input: outside },
		);
	const pristine = join(outer, "pristine", skillsRoot);
	const edited = join(outer, "edited", skillsRoot);
	const candidates = input.skill
		? [input.skill]
		: [...new Set([...(await readdir(pristine)), ...(await readdir(edited))])].sort();
	const names: string[] = [];
	for (const name of candidates) {
		if (
			(await statOptional(join(pristine, name, "SKILL.md"))) ||
			(await statOptional(join(edited, name, "SKILL.md")))
		)
			names.push(name);
	}
	for (const path of sourceChanges) {
		const relative = skillsRoot === "." ? path : path.slice(skillsPrefix.length);
		const name = relative.split("/")[0]!;
		if (!relative.includes("/") || (!input.skill && !names.includes(name)))
			throw responseError(
				"CAPTURE_OUTSIDE_SKILLS",
				`Edit is not inside a distributable skill: ${path}.`,
				{ input: path },
			);
	}
	const staging = await mkdtemp(join(input.workspace, `.skillbox-capture-${input.bundle}-`));
	await cp(pack, join(staging, "pack"), { recursive: true, preserveTimestamps: true });
	pack = join(staging, "pack");
	try {
		let changed = 0;
		for (const skill of names) {
			const before = join(pristine, skill);
			const after = join(edited, skill);
			if (await treesEqual(before, after)) {
				if (await statOptional(join(pack, skill))) {
					await rm(join(pack, skill), { recursive: true, force: true });
					changed += 1;
				}
				continue;
			}
			const prior = await priorIntents(pack, skill);
			const mappings = (input.maps ?? []).flatMap((mapping) => {
				const [oldPath, newPath] = mapping.split("=");
				if (
					!oldPath ||
					!newPath ||
					!oldPath.startsWith(`${skill}/`) ||
					!newPath.startsWith(`${skill}/`)
				)
					return [];
				return [
					{
						oldTarget: oldPath.slice(skill.length + 1),
						newTarget: newPath.slice(skill.length + 1),
					},
				];
			});
			const intent = input.intent
				? { skill, target: ".", intent: input.intent, base_revision: manifest.revision }
				: undefined;
			const dir = join(pack, skill, "changes");
			await rm(join(pack, skill), { recursive: true, force: true });
			await mkdir(dir, { recursive: true });
			const diffs = await input.adapted.diffFiles(before, after);
			const changes: PatchManifest["change"] = [];
			for (const [index, { target, body }] of diffs.entries()) {
				const patch = `changes/${String(index + 1).padStart(4, "0")}-captured.patch`;
				await writeFile(join(pack, skill, patch), body);
				const mapping = mappings.find((item) => item.newTarget === target);
				const renamed = mapping
					? prior.find((item) => item.target.replace(/^\.\//, "") === mapping.oldTarget)
					: undefined;
				const previous = renamed ?? prior.find((item) => item.target === `./${target}`);
				const selected =
					intents.find(
						(item) =>
							item.skill === skill && item.target.replace(/^\.\//, "") === target,
					) ??
					intent ??
					previous;
				if (!selected)
					throw responseError(
						"INTENT_REQUIRED",
						`Intent required for ${skill}/${target}.`,
						{ skill, input: target },
					);
				const history = [...(previous?.history ?? [])];
				if (
					previous &&
					(previous.base_revision !== manifest.revision ||
						previous.target !== `./${target}` ||
						previous.intent !== selected.intent)
				)
					history.push({
						target: previous.target,
						intent: previous.intent,
						base_revision: previous.base_revision,
					});
				const renamedFrom =
					renamed && mapping ? `./${mapping.oldTarget}` : previous?.renamed_from;
				changes.push({
					intent: selected.intent,
					target: `./${target}`,
					patch,
					base_revision: manifest.revision,
					...(renamedFrom && { renamed_from: renamedFrom }),
					...(history.length && { history }),
				});
			}
			await writeFile(
				join(pack, skill, "patch.toml"),
				stringify(patchSchema.parse({ schema: 1, change: changes })),
			);
			changed += diffs.length;
		}
		if (changed > 0) {
			const descriptor = descriptorSchema.parse(
				parse(await readFile(join(pack, "bundle.toml"), "utf8")),
			);
			const current = bundleLockSchema.parse(
				JSON.parse(await readFile(join(pack, "lock.json"), "utf8")),
			);
			const source = await input.adapted.acquireSource(descriptor, manifest.revision);
			const patchHash = await hashPatchPack(pack);
			await writeFile(
				join(pack, "lock.json"),
				lockText({
					...current,
					revision: source.revision,
					tree: source.tree,
					sourceHash: source.sourceHash,
					patchHash,
				}),
			);
			const probe = await mkdtemp(
				join(input.workspace, `.skillbox-capture-probe-${input.bundle}-`),
			);
			const probeWorkspace = join(probe, "workspace");
			await mkdir(join(probeWorkspace, "skillbox/patches"), { recursive: true });
			await cp(pack, join(probeWorkspace, "skillbox/patches", input.bundle), {
				recursive: true,
				preserveTimestamps: true,
			});
			let outputs: Record<string, string>;
			try {
				outputs = (
					await input.adapted.materializeBundle(
						probeWorkspace,
						input.bundle,
						join(probe, "patched"),
						manifest.revision,
					)
				).outputs;
			} finally {
				await rm(probe, { recursive: true, force: true });
			}
			const desired = await hashSkillOutputs(join(outer, "edited"), skillsRoot);
			for (const name of names) {
				if (outputs[name] !== desired[name])
					throw responseError(
						"PATCH_CAPTURE_MISMATCH",
						`Captured patches do not reproduce the edited skill ${name}.`,
						{ skill: name },
					);
			}
			await writeFile(
				join(pack, "lock.json"),
				lockText({
					...current,
					revision: source.revision,
					tree: source.tree,
					sourceHash: source.sourceHash,
					patchHash,
					outputs,
				}),
			);
			await sync({
				adapted: input.adapted,
				cwd: input.workspace,
				workspace: input.workspace,
				acceptContentChangesForBundle: input.bundle,
				bundlePackOverrides: { [input.bundle]: pack },
			});
		}
		const result = {
			status: changed ? ("captured" as const) : ("unchanged" as const),
			bundle: input.bundle,
			source: manifest.source,
			revision: manifest.revision,
			skills: names.length,
			changed,
		};
		return result;
	} finally {
		await rm(staging, { recursive: true, force: true });
	}
}

async function treesEqual(a: string, b: string) {
	try {
		const { lstat } = await import("node:fs/promises");
		const [left, right] = await Promise.all([lstat(a), lstat(b)]);
		if (left.isFile() && right.isFile())
			return (
				(await readFile(a)).equals(await readFile(b)) &&
				(left.mode & 0o111) === (right.mode & 0o111)
			);
		if (left.isDirectory() && right.isDirectory())
			return (await hashTree(a)) === (await hashTree(b));
		return false;
	} catch (cause) {
		if ((cause as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw cause;
	}
}
async function priorIntents(pack: string, skill: string): Promise<PatchManifest["change"]> {
	const text = await readOptional(join(pack, skill, "patch.toml"));
	return text === undefined ? [] : patchSchema.parse(parse(text)).change;
}
async function readIntents(input: { workspace: string; intentFile?: string }) {
	if (!input.intentFile) return [] as { skill: string; target: string; intent: string }[];
	const schema = z.object({
		change: z.array(
			patchSchema.shape.change.element
				.pick({ target: true, intent: true })
				.extend({ skill: bundleSchema }),
		),
	});
	return schema.parse(parse(await readFile(resolve(input.workspace, input.intentFile), "utf8")))
		.change;
}
function inferSource(source: string) {
	const match = /^(.*?)(?:\.git)?\/tree\/([^/]+)\/(.+)$/.exec(source);
	return match ? { source: match[1], ref: match[2], root: match[3] } : { source };
}
async function emptyHash() {
	const { createHash } = await import("node:crypto");
	return createHash("sha256").digest("hex");
}
