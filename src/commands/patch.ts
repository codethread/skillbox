import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { parse, stringify } from "smol-toml";
import {
	descriptorText,
	hashPatchPack,
	hashSkillOutputs,
	hashTree,
	lockText,
	patchSchema,
	pendingIntents,
	preparedSchema,
	readAdaptedBundle,
	type AdaptedBundles,
	type BundleDescriptor,
	type PatchManifest,
} from "../workspace/adapted.ts";
import { bundleSchema, configPath, readConfig, withBundles } from "../workspace/config.ts";
import { lockPath, readLock } from "../workspace/lock.ts";
import { readOptional, statOptional } from "../workspace/paths.ts";
import { publish } from "../workspace/publish.ts";
import { ResponseError, responseError } from "../response.ts";

export async function patchInit(input: {
	adapted: AdaptedBundles;
	workspace: string;
	bundle: string;
	source: string;
	root?: string;
	skillsRoot?: string;
	ref?: string;
	updateRef?: string;
	output?: string;
}) {
	const bundle = bundleSchema.parse(input.bundle);
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
	const requested = input.ref ?? inferred.ref ?? descriptor.update_ref;
	if (!requested)
		throw responseError("REVISION_REQUIRED", "Specify --ref for the imported revision.", {
			source: input.source,
		});
	const workspace = input.workspace;
	const packPath = join("skillbox/patches", bundle);
	if (await statOptional(join(workspace, packPath)))
		throw responseError("PATCH_PACK_EXISTS", "Patch pack already exists: " + bundle, {
			skill: bundle,
		});
	const output = resolveEditingDirectory(
		workspace,
		input.output ?? ".skillbox-prepare-" + bundle,
	);
	if (await statOptional(output))
		throw responseError("DESTINATION_EXISTS", "Editing directory already exists: " + output, {
			input: output,
		});
	const config = await readConfig(workspace);
	const existingLock = await readOptional(join(workspace, lockPath));
	if (config && existingLock === undefined)
		throw responseError("LOCK_MISSING", "Restore " + lockPath + " before importing a bundle.", {
			input: lockPath,
		});
	if (!config) {
		for (const path of [lockPath, ".agents/skills", ".claude/skills"]) {
			if (await statOptional(join(workspace, path)))
				throw responseError(
					"MANAGED_STATE_EXISTS",
					"Existing " + path + " requires its original Skillbox config.",
					{ input: path },
				);
		}
	}
	const current = config ?? { sources: [] };
	if (current.sources.some((entry) => entry.bundles.includes(bundle)))
		throw responseError("BUNDLE_EXISTS", "Bundle name is already configured: " + bundle, {
			skill: bundle,
		});
	const occupied = new Set(existingLock ? Object.keys(readLock(existingLock).skills) : []);
	const source = await input.adapted.acquireSource(descriptor, requested);
	const outputs = await hashSkillOutputs(source.root, descriptor.skills_root);
	const names = Object.keys(outputs);
	if (!names.length)
		throw responseError(
			"BUNDLE_EMPTY",
			"No skill directories found in the selected source subtree.",
			{ source: input.source },
		);
	const staging = await mkdtemp(join(workspace, ".skillbox-init-"));
	let retain = false;
	try {
		for (const entry of current.sources) {
			for (const name of entry.bundles) {
				if (!(await readAdaptedBundle(workspace, name))) continue;
				const directory = join(staging, "occupied", name);
				await mkdir(directory, { recursive: true });
				const materialized = await input.adapted.materializeBundle(
					workspace,
					name,
					join(directory, "edited"),
				);
				for (const skill of Object.keys(materialized.outputs)) occupied.add(skill);
			}
		}
		for (const skill of names)
			if (occupied.has(skill))
				throw responseError("SKILL_NAME_COLLISION", "Skill name collision: " + skill, {
					skill,
				});
		const pack = join(staging, packPath);
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
				patchHash: await hashPatchPack(pack),
			}),
		);
		await input.adapted.prepareBundle(staging, bundle, join(staging, "editing"));
		await writeFile(
			join(staging, configPath),
			JSON.stringify(withBundles(current, descriptor.source, [bundle]), null, 2) + "\n",
		);
		const entries = [configPath, packPath].map((path) => ({
			staged: join(staging, path),
			target: join(workspace, path),
		}));
		if (existingLock === undefined) {
			await writeFile(
				join(staging, lockPath),
				JSON.stringify({ version: 1, skills: {} }, null, 2) + "\n",
			);
			entries.push({ staged: join(staging, lockPath), target: join(workspace, lockPath) });
		}
		entries.push({ staged: join(staging, "editing"), target: output });
		try {
			await publish(staging, entries);
		} catch (cause) {
			retain = true;
			throw publicationError(staging, cause);
		}
		return {
			status: "initialized",
			bundle,
			source: descriptor.source,
			revision: source.revision,
			skills: names.length,
			workspace: output,
			editable: join(output, "edited"),
		};
	} finally {
		if (!retain) await rm(staging, { recursive: true, force: true });
	}
}

export async function patchPrepare(input: {
	adapted: AdaptedBundles;
	workspace: string;
	bundle: string;
	output?: string;
}) {
	return input.adapted.prepareBundle(
		input.workspace,
		input.bundle,
		resolveEditingDirectory(
			input.workspace,
			input.output ?? ".skillbox-prepare-" + input.bundle,
		),
	);
}

export async function patchUpdate(input: {
	adapted: AdaptedBundles;
	workspace: string;
	bundle: string;
	ref?: string;
}) {
	const pack = await requirePack(input.workspace, input.bundle);
	const { descriptor, lock: current } = pack;
	const requested = input.ref ?? descriptor.update_ref;
	if (!requested)
		throw responseError("REVISION_REQUIRED", "Specify --ref or configure update_ref.", {
			skill: input.bundle,
		});
	const source = await input.adapted.acquireSource(descriptor, requested);
	const staging = await mkdtemp(join(input.workspace, ".skillbox-update-" + input.bundle + "-"));
	let retain = false;
	try {
		await cp(source.root, join(staging, "pristine"), {
			recursive: true,
			preserveTimestamps: true,
		});
		let conflict: ResponseError | undefined;
		try {
			const materialized = await input.adapted.materializeBundle(
				input.workspace,
				input.bundle,
				join(staging, "edited"),
				source.revision,
			);
			await rm(materialized.canonical, { recursive: true });
		} catch (cause) {
			if (
				!(cause instanceof ResponseError) ||
				cause.errors.some((error) => error.code !== "PATCH_APPLY_FAILED")
			)
				throw cause;
			conflict = cause;
		}
		await writeFile(
			join(staging, "manifest.json"),
			JSON.stringify(
				{
					schema: 1,
					bundle: input.bundle,
					source: descriptor.source,
					revision: source.revision,
					sourceHash: source.sourceHash,
					patchHash: current.patchHash,
					previous_revision: current.revision,
				},
				null,
				2,
			) + "\n",
		);
		const data = {
			status: conflict ? "conflicted" : "prepared",
			bundle: input.bundle,
			source: descriptor.source,
			from: current.revision,
			to: source.revision,
			workspace: staging,
			pristine: join(staging, "pristine"),
			editable: join(staging, "edited"),
			conflicts:
				conflict?.errors.map((error) => ({
					skill: error.skill,
					target: error.target,
					patch: error.patch,
					reason: error.reason,
				})) ?? [],
		};
		retain = true;
		if (conflict)
			throw new ResponseError(
				[
					{
						code: "UPDATE_CONFLICT",
						message: "Patches do not replay on " + source.revision,
						source: descriptor.source,
						skill: input.bundle,
					},
				],
				{ cause: conflict, data },
			);
		return data;
	} finally {
		if (!retain) await rm(staging, { recursive: true, force: true });
	}
}

export async function patchCapture(input: {
	adapted: AdaptedBundles;
	workspace: string;
	bundle: string;
	from: string;
	skill?: string;
	maps?: string[];
}) {
	bundleSchema.parse(input.bundle);
	if (input.skill) bundleSchema.parse(input.skill);
	const mappings = parseMappings(input.maps ?? []);
	const outer = resolve(input.workspace, input.from);
	const manifest = preparedSchema.parse(
		JSON.parse(await readFile(join(outer, "manifest.json"), "utf8")),
	);
	const live = await requirePack(input.workspace, input.bundle);
	const { descriptor, lock } = live;
	const updating = manifest.previous_revision !== undefined;
	if (updating && input.skill)
		throw responseError("REGEN_WORKSPACE_INVALID", "Capture the complete update candidate.", {
			input: input.from,
		});
	if (mappings.length && !updating)
		throw responseError("RENAME_MAP_INVALID", "Rename mappings apply to update workspaces.");
	if (
		manifest.bundle !== input.bundle ||
		manifest.source !== descriptor.source ||
		(manifest.previous_revision ?? manifest.revision) !== lock.revision ||
		manifest.patchHash !== lock.patchHash
	) {
		throw responseError(
			"REGEN_WORKSPACE_INVALID",
			"Prepared workspace provenance or patch series is stale.",
			{ input: input.from },
		);
	}
	const source = await input.adapted.acquireSource(descriptor, manifest.revision);
	if (
		manifest.sourceHash !== source.sourceHash ||
		manifest.sourceHash !== (await hashTree(join(outer, "pristine")))
	) {
		throw responseError("REGEN_WORKSPACE_INVALID", "Prepared pristine source was modified.", {
			input: input.from,
		});
	}
	if ((await hashPatchPack(live.directory)) !== lock.patchHash)
		throw responseError(
			"BUNDLE_LOCK_DRIFT",
			"Recorded patch artifacts changed after preparation.",
			{ skill: input.bundle },
		);
	const staging = await mkdtemp(join(input.workspace, ".skillbox-capture-" + input.bundle + "-"));
	let retain = false;
	try {
		const stagedPack = join(staging, "pack");
		await cp(live.directory, stagedPack, { recursive: true, preserveTimestamps: true });
		const baseline = updating ? join(outer, "pristine") : join(staging, "recorded");
		if (!updating)
			await input.adapted.materializeBundle(input.workspace, input.bundle, baseline);
		const skillsRoot = descriptor.skills_root;
		const beforeRoot = join(baseline, skillsRoot);
		const editedRoot = join(outer, "edited", skillsRoot);
		const candidates = [
			...new Set([...(await readdir(beforeRoot)), ...(await readdir(editedRoot))]),
		].sort();
		const names: string[] = [];
		for (const name of candidates) {
			if (
				(await statOptional(join(beforeRoot, name, "SKILL.md"))) ||
				(await statOptional(join(editedRoot, name, "SKILL.md"))) ||
				(await statOptional(join(outer, "pristine", skillsRoot, name, "SKILL.md"))) ||
				(await statOptional(join(stagedPack, name, "patch.toml")))
			)
				names.push(name);
		}
		if (input.skill && !names.includes(input.skill))
			throw responseError("SKILL_NOT_FOUND", "No editable skill: " + input.skill, {
				skill: input.skill,
			});
		const differences = await input.adapted.diffFiles(baseline, join(outer, "edited"));
		for (const { target } of differences) {
			const prefix = skillsRoot === "." ? "" : skillsRoot + "/";
			const local = target.startsWith(prefix) ? target.slice(prefix.length) : "";
			if (!local.includes("/") || !names.includes(local.split("/")[0]!))
				throw responseError(
					"CAPTURE_OUTSIDE_SKILLS",
					"Edit outside a distributable skill: " + target,
					{ input: target },
				);
		}
		const selected = input.skill ? [input.skill] : names;
		let changed = 0;
		for (const skill of selected) {
			const old = await readManifest(stagedPack, skill);
			const next: PatchManifest = updating
				? { schema: 1, files: {}, patches: [] }
				: structuredClone(old);
			if (updating) await rm(join(stagedPack, skill), { recursive: true, force: true });
			const diffs = await input.adapted.diffFiles(
				join(beforeRoot, skill),
				join(editedRoot, skill),
			);
			for (const { target, body } of diffs) {
				const file = "./" + target;
				const mapping = mappings.find(
					(entry) => entry.skill === skill && entry.to === file,
				);
				if (mapping && !Object.hasOwn(old.files, mapping.from))
					throw responseError(
						"RENAME_MAP_INVALID",
						"No recorded file intent for " + skill + "/" + mapping.from,
						{ skill },
					);
				next.files[file] ??= old.files[mapping?.from ?? file] ?? { intent: "" };
				const artifact =
					"changes/" +
					String(next.patches.length + 1).padStart(4, "0") +
					"-captured.patch";
				await mkdir(join(stagedPack, skill, "changes"), { recursive: true });
				await writeFile(join(stagedPack, skill, artifact), body);
				next.patches.push({
					target: file,
					patch: artifact,
				});
			}
			if (diffs.length) {
				await writeFile(
					join(stagedPack, skill, "patch.toml"),
					stringify(patchSchema.parse(next)),
				);
				changed += diffs.length;
			}
		}
		if (updating) {
			for (const entry of await readdir(stagedPack, { withFileTypes: true })) {
				if (entry.isDirectory() && !selected.includes(entry.name))
					await rm(join(stagedPack, entry.name), { recursive: true });
			}
		}
		if (changed || updating) {
			const patchHash = await hashPatchPack(stagedPack);
			const nextLock = {
				...lock,
				revision: source.revision,
				tree: source.tree,
				sourceHash: source.sourceHash,
				patchHash,
			};
			await writeFile(join(stagedPack, "lock.json"), lockText(nextLock));
			const probeWorkspace = join(staging, "probe");
			await mkdir(join(probeWorkspace, "skillbox/patches"), { recursive: true });
			await cp(stagedPack, join(probeWorkspace, "skillbox/patches", input.bundle), {
				recursive: true,
				preserveTimestamps: true,
			});
			const outputs = (
				await input.adapted.materializeBundle(
					probeWorkspace,
					input.bundle,
					join(probeWorkspace, "output"),
					manifest.revision,
				)
			).outputs;
			const desired = await hashSkillOutputs(join(outer, "edited"), skillsRoot);
			for (const name of selected) {
				if (outputs[name] !== desired[name])
					throw responseError(
						"PATCH_CAPTURE_MISMATCH",
						"Captured patches do not reproduce edited skill " + name,
						{ skill: name },
					);
			}
			await writeFile(
				join(staging, "manifest.json"),
				JSON.stringify(
					{
						schema: 1,
						bundle: input.bundle,
						source: descriptor.source,
						revision: source.revision,
						sourceHash: source.sourceHash,
						patchHash,
					},
					null,
					2,
				) + "\n",
			);
			try {
				await publish(staging, [
					{ staged: stagedPack, target: live.directory },
					{
						staged: join(staging, "manifest.json"),
						target: join(outer, "manifest.json"),
					},
				]);
			} catch (cause) {
				retain = true;
				throw publicationError(staging, cause);
			}
		}
		const pending = await pendingIntents(live.directory);
		return {
			status: changed || updating ? "captured" : "unchanged",
			bundle: input.bundle,
			source: manifest.source,
			revision: manifest.revision,
			skills: selected.length,
			changed,
			pendingIntents: pending.length,
			intentFiles: [
				...new Set(pending.map((item) => relative(input.workspace, item.manifest))),
			],
		};
	} finally {
		if (!retain) await rm(staging, { recursive: true, force: true });
	}
}

// -----------------------------------------------------------------------------

function resolveEditingDirectory(workspace: string, output: string): string {
	const directory = resolve(workspace, output);
	const tracking = join(workspace, "skillbox");
	if (directory === tracking || directory.startsWith(tracking + sep))
		throw responseError(
			"DESTINATION_INVALID",
			"Keep the editing directory outside skillbox/ tracking files.",
			{
				input: output,
			},
		);
	return directory;
}

async function requirePack(workspace: string, bundle: string) {
	const pack = await readAdaptedBundle(workspace, bundle);
	if (!pack)
		throw responseError("PATCH_PACK_NOT_FOUND", "Patch pack not found: " + bundle, {
			skill: bundle,
		});
	return pack;
}

async function readManifest(pack: string, skill: string): Promise<PatchManifest> {
	const text = await readOptional(join(pack, skill, "patch.toml"));
	return text === undefined
		? { schema: 1, files: {}, patches: [] }
		: patchSchema.parse(parse(text));
}

function parseMappings(values: string[]) {
	const paths = new Set<string>();
	return values.map((value) => {
		const parts = value.split("=");
		const from = parts[0]?.split("/");
		const to = parts[1]?.split("/");
		if (
			parts.length !== 2 ||
			!from ||
			!to ||
			from.length < 2 ||
			to.length < 2 ||
			from[0] !== to[0]
		) {
			throw responseError(
				"RENAME_MAP_INVALID",
				"Use --map skill/old-path=skill/new-path within one skill.",
				{ input: value },
			);
		}
		const skill = bundleSchema.parse(from[0]);
		const oldTarget = "./" + from.slice(1).join("/");
		const newTarget = "./" + to.slice(1).join("/");
		patchSchema.shape.patches.element.shape.target.parse(oldTarget);
		patchSchema.shape.patches.element.shape.target.parse(newTarget);
		if (paths.has(skill + "/" + newTarget))
			throw responseError("RENAME_MAP_INVALID", "Repeated rename destination.", {
				input: value,
			});
		paths.add(skill + "/" + newTarget);
		return { skill, from: oldTarget, to: newTarget };
	});
}

function publicationError(staging: string, cause: unknown) {
	return responseError(
		"PUBLISH_FAILED",
		"Publication failed. Recovery files retained at " + staging + ".",
		{ input: staging },
		cause,
	);
}

function inferSource(source: string) {
	const match = /^(.*?)(?:\.git)?\/tree\/([^/]+)\/(.+)$/.exec(source);
	return match ? { source: match[1]!, ref: match[2]!, root: match[3]! } : { source };
}
