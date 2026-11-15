import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { stringify } from "smol-toml";
import { z } from "zod";
import { ResponseError, responseError } from "../response.ts";
import {
	hashPatchPack,
	hashTree,
	patchSchema,
	pendingIntents,
	readManifest,
	type PatchManifest,
} from "../workspace/patches.ts";
import { discover, isLocalSource, type Bundles } from "../workspace/bundles.ts";
import {
	bundleSchema,
	contributionIdentity,
	readConfig,
	refSchema,
	type Config,
} from "../workspace/config.ts";
import { jsonText, lockPath, lockSchema, readLock, type Lock } from "../workspace/lock.ts";
import { statOptional } from "../workspace/paths.ts";
import { publish } from "../workspace/publish.ts";

const preparedSchema = z.strictObject({
	schema: z.literal(2),
	bundle: bundleSchema,
	configHash: z.string(),
	sources: lockSchema.shape.sources,
	sourceHash: z.string(),
	patchHash: z.string(),
	previousSources: lockSchema.shape.sources.optional(),
	conflicts: z
		.array(
			z.strictObject({
				skill: bundleSchema,
				target: patchSchema.shape.patches.element.shape.target,
				hash: z.string().nullable(),
			}),
		)
		.optional(),
});
type Prepared = z.infer<typeof preparedSchema>;
interface PatchInput {
	bundles: Bundles;
	workspace: string;
	bundle: string;
}

export async function patchPrepare(input: PatchInput & { output?: string }) {
	const { config, lock } = await managed(input);
	const output = editingDirectory(
		input.workspace,
		input.output ?? join("skillbox/.prepare", input.bundle, "edit"),
	);
	if (await statOptional(output))
		throw responseError("DESTINATION_EXISTS", `Editing directory already exists: ${output}.`, {
			input: output,
		});
	await mkdir(output, { recursive: true });
	try {
		return await prepare(input, config, lock, output);
	} catch (cause) {
		await rm(output, { recursive: true, force: true });
		throw cause;
	}
}

export async function patchUpdate(input: PatchInput & { ref?: string }) {
	if (input.ref !== undefined) refSchema.parse(input.ref);
	const { config, lock } = await managed(input);
	const refresh = new Map<string, string | undefined>();
	for (const contribution of config.sources.filter(
		(value) => value.id === input.bundle && !isLocalSource(value.source),
	))
		refresh.set(contributionIdentity(contribution), input.ref);
	if (!refresh.size && input.ref)
		throw responseError("REF_UNSUPPORTED", "This bundle has no Git source to update.");
	const candidate = await input.bundles.resolvePins(input.workspace, config, lock, refresh);
	const parent = join(input.workspace, "skillbox/.prepare", input.bundle);
	await mkdir(parent, { recursive: true });
	const output = await mkdtemp(join(parent, "update-"));
	let retain = false;
	try {
		const result = await prepare(input, config, candidate, output, lock.sources);
		retain = true;
		return { ...result, from: lock.sources, to: candidate.sources };
	} catch (cause) {
		if (
			cause instanceof ResponseError &&
			cause.errors.some((error) => error.code === "UPDATE_CONFLICT")
		)
			retain = true;
		throw cause;
	} finally {
		if (!retain) await rm(output, { recursive: true, force: true });
	}
}

export async function patchCapture(
	input: PatchInput & { from: string; skill?: string; maps?: string[] },
) {
	const { config, lock } = await managed(input);
	if (input.skill) bundleSchema.parse(input.skill);
	const mappings = parseMappings(input.maps ?? []);
	const outer = resolve(input.workspace, input.from);
	const manifest = preparedSchema.parse(
		JSON.parse(await readFile(join(outer, "manifest.json"), "utf8")),
	);
	const updating = manifest.previousSources !== undefined;
	if (updating && input.skill)
		throw responseError("REGEN_WORKSPACE_INVALID", "Capture the complete update candidate.");
	if (mappings.length && !updating)
		throw responseError("RENAME_MAP_INVALID", "Rename mappings apply to update workspaces.");
	const pack = join(input.workspace, "skillbox/patches", input.bundle);
	if (
		manifest.bundle !== input.bundle ||
		manifest.configHash !== configHash(config) ||
		jsonText(manifest.previousSources ?? manifest.sources) !== jsonText(lock.sources) ||
		manifest.patchHash !== (await hashPatchPack(pack))
	)
		throw responseError(
			"REGEN_WORKSPACE_INVALID",
			"Prepared workspace provenance or patch series is stale.",
			{ input: outer },
		);
	if (manifest.sourceHash !== (await hashTree(join(outer, "pristine"))))
		throw responseError("REGEN_WORKSPACE_INVALID", "Prepared pristine source was modified.", {
			input: outer,
		});
	for (const conflict of manifest.conflicts ?? []) {
		const mapping = mappings.find(
			(entry) => entry.skill === conflict.skill && entry.from === conflict.target,
		);
		const target = mapping?.to ?? conflict.target;
		const initial = mapping
			? await fileDigest(join(outer, "pristine/skills", conflict.skill, target))
			: conflict.hash;
		if ((await fileDigest(join(outer, "edited/skills", conflict.skill, target))) === initial)
			throw responseError(
				"UPDATE_CONFLICT_UNRESOLVED",
				`Review and change conflicted target ${conflict.skill}/${target}. If the patch is obsolete, remove its recorded artifact and intent explicitly, then prepare a new update.`,
				{ skill: conflict.skill, target },
			);
	}
	const staging = await mkdtemp(join(input.workspace, ".skillbox-capture-"));
	let retain = false;
	try {
		const stagedPack = join(staging, "pack");
		await mkdir(stagedPack);
		if (await statOptional(pack))
			await cp(pack, stagedPack, { recursive: true, preserveTimestamps: true });
		const rebasing =
			updating &&
			lock.bundles[input.bundle]?.sourceHash !==
				(await hashTree(join(outer, "pristine/skills")));
		const baseline = rebasing ? join(outer, "pristine") : join(staging, "recorded");
		const candidate: Lock = { ...lock, sources: manifest.sources };
		await mkdir(join(staging, "verify"));
		await input.bundles.compose(
			input.workspace,
			config,
			candidate,
			input.bundle,
			join(staging, "verify/skills"),
			false,
		);
		if ((await hashTree(join(staging, "verify"))) !== manifest.sourceHash)
			throw responseError(
				"REGEN_WORKSPACE_INVALID",
				"Prepared source changed since preparation. Prepare again.",
			);
		if (!rebasing) {
			await cp(join(staging, "verify"), baseline, {
				recursive: true,
				preserveTimestamps: true,
			});
			await input.bundles.replay(pack, join(baseline, "skills"));
		}
		const beforeRoot = join(baseline, "skills");
		const editedRoot = join(outer, "edited/skills");
		const candidates = [
			...new Set([
				...(await readdir(beforeRoot)),
				...(await readdir(editedRoot)),
				...(await readdir(stagedPack)),
			]),
		].sort();
		const names: string[] = [];
		for (const name of candidates) {
			bundleSchema.parse(name);
			if (
				(await statOptional(join(beforeRoot, name, "SKILL.md"))) ||
				(await statOptional(join(editedRoot, name, "SKILL.md"))) ||
				(await statOptional(join(stagedPack, name, "patch.toml")))
			)
				names.push(name);
		}
		if (input.skill && !names.includes(input.skill))
			throw responseError("SKILL_NOT_FOUND", `No editable skill: ${input.skill}.`, {
				skill: input.skill,
			});
		const differences = await input.bundles.diffFiles(baseline, join(outer, "edited"));
		for (const { target } of differences)
			if (
				!target.startsWith("skills/") ||
				!target.slice(7).includes("/") ||
				!names.includes(target.split("/")[1]!)
			)
				throw responseError(
					"CAPTURE_OUTSIDE_SKILLS",
					`Edit outside a distributable skill: ${target}.`,
					{ input: target },
				);
		const selected = input.skill ? [input.skill] : names;
		let changed = 0;
		for (const skill of selected) {
			const old = await readManifest(stagedPack, skill);
			const next: PatchManifest = rebasing
				? { schema: 1, files: {}, patches: [] }
				: structuredClone(old);
			if (rebasing) await rm(join(stagedPack, skill), { recursive: true, force: true });
			const diffs = await input.bundles.diffFiles(
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
						`No recorded file intent for ${skill}/${mapping.from}.`,
					);
				next.files[file] ??= old.files[mapping?.from ?? file] ?? { intent: "" };
				const artifact = `changes/${String(next.patches.length + 1).padStart(4, "0")}-captured.patch`;
				await mkdir(join(stagedPack, skill, "changes"), { recursive: true });
				await writeFile(join(stagedPack, skill, artifact), body);
				next.patches.push({ target: file, patch: artifact });
			}
			if (diffs.length) {
				await writeFile(
					join(stagedPack, skill, "patch.toml"),
					stringify(patchSchema.parse(next)),
				);
				changed += diffs.length;
			}
		}
		if (changed || updating) {
			const probe = join(staging, "probe");
			await cp(join(staging, "verify"), probe, { recursive: true, preserveTimestamps: true });
			await input.bundles.replay(stagedPack, join(probe, "skills"));
			for (const name of selected) {
				const expected = await statOptional(join(editedRoot, name));
				const actual = await statOptional(join(probe, "skills", name));
				const emptyHash = createHash("sha256").digest("hex");
				if (
					(expected ? await hashTree(join(editedRoot, name)) : emptyHash) !==
					(actual ? await hashTree(join(probe, "skills", name)) : emptyHash)
				)
					throw responseError(
						"PATCH_CAPTURE_MISMATCH",
						`Captured patches do not reproduce ${name}.`,
						{ skill: name },
					);
			}
			const patchHash = await hashPatchPack(stagedPack);
			const nextManifest: Prepared = { ...manifest, patchHash };
			delete nextManifest.previousSources;
			delete nextManifest.conflicts;
			await writeFile(join(staging, "manifest.json"), jsonText(nextManifest));
			const entries = [
				{ staged: join(staging, "manifest.json"), target: join(outer, "manifest.json") },
			];
			if ((await readdir(stagedPack)).length || (await statOptional(pack)))
				entries.unshift({ staged: stagedPack, target: pack });
			if (updating) {
				const composed = await input.bundles.compose(
					input.workspace,
					config,
					candidate,
					input.bundle,
					join(staging, "accepted"),
					false,
				);
				const outputMembers = await discover(
					join(probe, "skills"),
					".",
					`skillbox/${input.bundle}`,
				);
				candidate.bundles = {
					...candidate.bundles,
					[input.bundle]: {
						sourceHash: composed.sourceHash,
						members: outputMembers.map((member) => ({
							...(composed.members.find(
								(original) => original.directory === member.directory,
							) ?? member),
							name: member.name,
						})),
					},
				};
				await writeFile(join(staging, "lock.json"), jsonText(lockSchema.parse(candidate)));
				entries.push({
					staged: join(staging, "lock.json"),
					target: join(input.workspace, lockPath),
				});
			}
			try {
				await publish(staging, entries);
			} catch (cause) {
				retain = true;
				throw responseError(
					"PUBLISH_FAILED",
					`Publication failed; recovery retained at ${staging}.`,
					{ input: staging },
					cause,
				);
			}
		}
		const pending = await pendingIntents(pack);
		return {
			status: changed || updating ? "captured" : "unchanged",
			bundle: input.bundle,
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

async function prepare(
	input: PatchInput,
	config: Config,
	lock: Lock,
	output: string,
	previousSources?: Lock["sources"],
) {
	await mkdir(join(output, "pristine"));
	await input.bundles.compose(
		input.workspace,
		config,
		lock,
		input.bundle,
		join(output, "pristine/skills"),
		false,
	);
	await cp(join(output, "pristine"), join(output, "edited"), {
		recursive: true,
		preserveTimestamps: true,
	});
	const pack = join(input.workspace, "skillbox/patches", input.bundle);
	const manifest: Prepared = {
		schema: 2,
		bundle: input.bundle,
		configHash: configHash(config),
		sources: lock.sources,
		sourceHash: await hashTree(join(output, "pristine")),
		patchHash: await hashPatchPack(pack),
		...(previousSources ? { previousSources } : {}),
	};
	await writeFile(join(output, "manifest.json"), jsonText(manifest));
	const data = {
		status: "prepared",
		bundle: input.bundle,
		workspace: output,
		pristine: join(output, "pristine"),
		editable: join(output, "edited"),
	};
	try {
		await input.bundles.replay(pack, join(output, "edited/skills"));
	} catch (cause) {
		if (
			!(cause instanceof ResponseError) ||
			!previousSources ||
			cause.errors.some((error) => error.code !== "PATCH_APPLY_FAILED")
		)
			throw cause;
		manifest.conflicts = await Promise.all(
			cause.errors.map(async (error) => ({
				skill: error.skill!,
				target: error.target!,
				hash: await fileDigest(join(output, "edited/skills", error.skill!, error.target!)),
			})),
		);
		await writeFile(join(output, "manifest.json"), jsonText(manifest));
		throw new ResponseError(
			[
				{
					code: "UPDATE_CONFLICT",
					message: "Patches do not replay on the requested pins.",
					input: input.bundle,
				},
			],
			{ cause, data: { ...data, status: "conflicted", conflicts: cause.errors } },
		);
	}
	return data;
}
async function managed(input: PatchInput) {
	bundleSchema.parse(input.bundle);
	const config = await readConfig(input.workspace);
	const lock = await readLock(input.workspace);
	if (!config || !lock)
		throw responseError(
			"MANAGED_STATE_MISSING",
			"A managed config and root lock are required. Register sources with add first.",
		);
	return { config, lock };
}
async function fileDigest(path: string): Promise<string | null> {
	const entry = await statOptional(path);
	if (!entry) return null;
	if (!entry.isFile())
		throw responseError("PATCH_PATH_UNSAFE", `Expected a regular editable file: ${path}.`, {
			input: path,
		});
	return createHash("sha256")
		.update(`${entry.mode & 0o777}\0`)
		.update(await readFile(path))
		.digest("hex");
}
function configHash(config: Config): string {
	return createHash("sha256").update(jsonText(config)).digest("hex");
}
function editingDirectory(workspace: string, output: string): string {
	const directory = resolve(workspace, output);
	const tracking = join(workspace, "skillbox");
	if (
		(directory === tracking || directory.startsWith(tracking + sep)) &&
		!directory.startsWith(join(tracking, ".prepare") + sep)
	)
		throw responseError(
			"DESTINATION_INVALID",
			"Use skillbox/.prepare/<bundle>/ or a directory outside skillbox/ tracking files.",
			{ input: output },
		);
	return directory;
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
		)
			throw responseError(
				"RENAME_MAP_INVALID",
				"Use --map skill/old-path=skill/new-path within one skill.",
				{ input: value },
			);
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
