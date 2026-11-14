import {
	cp,
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	readlink,
	realpath,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { installSkills, type SkillInfo, type SkillSource } from "skills";
import { z } from "zod";
import { bundleSchema, configPath, readConfig, withBundles } from "../workspace/config.ts";
import { lockPath, readLock, relocateLock } from "../workspace/lock.ts";
import { readOptional, statOptional } from "../workspace/paths.ts";
import { publish } from "../workspace/publish.ts";
import { ResponseError, responseError } from "../response.ts";
import { resolveBundleSource, sdkConfig, sdkLockPath } from "../workspace/sdk.ts";
import {
	descriptorText,
	lockText as bundleLockText,
	readAdaptedBundle,
	type AdaptedBundles,
	type ResolvedExportedBundle,
} from "../workspace/adapted.ts";

const inputSchema = z.object({
	cwd: z.string().min(1),
	source: z.string().min(1),
	bundles: z.array(bundleSchema).default([]),
	workspace: z.string().min(1).default("."),
});

export interface AddResult {
	status: "added" | "unchanged";
	source: string;
	bundles: string[];
	installed: number;
}

interface InstallSelection {
	bundle: string;
	handle: SkillSource;
	skills: readonly SkillInfo[];
}

export async function add(
	input: z.input<typeof inputSchema> & { adapted: AdaptedBundles },
): Promise<AddResult> {
	const parsed = inputSchema.parse(input);
	const adapted = input.adapted;
	const requestedBundles = [...new Set(parsed.bundles)];
	const workspace = await resolveWorkspace(parsed.cwd, parsed.workspace);
	const config = await readConfig(workspace);
	const lockText = await readOptional(join(workspace, lockPath));
	const lock = lockText === undefined ? undefined : readLock(lockText);
	if (!config) {
		await requireAbsent(workspace, ".agents/skills");
		await requireAbsent(workspace, ".claude/skills");
		await requireAbsent(workspace, lockPath);
	} else {
		if (!lock) {
			throw responseError(
				"LOCK_MISSING",
				`Missing ${lockPath}; cannot add to a managed installation.`,
				{ input: lockPath },
			);
		}
		const tracked = lock.skills;
		const directory = await statOptional(join(workspace, ".agents/skills"));
		if (!directory?.isDirectory()) {
			throw responseError(
				"MANAGED_SKILLS_MISSING",
				"Managed .agents/skills must be a real directory. Run skillbox sync to restore it before adding skills.",
				{ input: ".agents/skills" },
			);
		}
		for (const name of await readdir(join(workspace, ".agents/skills"))) {
			if (!Object.hasOwn(tracked, name)) {
				throw responseError(
					"UNMANAGED_SKILL",
					`Unmanaged skill: ${name}; migration is not implemented yet. No skills were changed.`,
					{ skill: name },
				);
			}
		}
		const link = join(workspace, ".claude/skills");
		if (await statOptional(link)) {
			if (
				resolve(dirname(link), await readlink(link)) !== join(workspace, ".agents/skills")
			) {
				throw responseError(
					"CLAUDE_SKILLS_LINK_INVALID",
					"Existing .claude/skills does not link to .agents/skills. No skills were changed.",
					{ input: ".claude/skills" },
				);
			}
		}
	}

	const exported: ResolvedExportedBundle[] = [];
	const selections: InstallSelection[] = [];
	let canonicalSource: string | undefined;
	try {
		for (const bundle of requestedBundles) {
			const resolved = await adapted.resolveExportedBundle({
				source: parsed.source,
				bundle,
				cwd: parsed.cwd,
				workspace,
			});
			if (!resolved) continue;
			exported.push(resolved);
			canonicalSource ??= resolved.source;
			if (canonicalSource !== resolved.source)
				throw responseError(
					"SOURCE_RESOLUTION_FAILED",
					"Selected bundles resolved to different producer sources.",
					{ source: parsed.source },
				);
		}

		const exportedNames = new Set(exported.map((entry) => entry.bundle));
		const nativeNames = requestedBundles.filter((bundle) => !exportedNames.has(bundle));
		if (requestedBundles.length === 0 || nativeNames.length > 0) {
			const native = await resolveBundleSource({
				source: parsed.source,
				bundles: requestedBundles.length === 0 ? [] : nativeNames,
				cwd: parsed.cwd,
				workspace,
			});
			canonicalSource ??= native.source;
			if (canonicalSource !== native.source) {
				await native.handle.dispose();
				throw responseError(
					"SOURCE_RESOLUTION_FAILED",
					"Native and adapted selections resolved to different producer sources.",
					{ source: parsed.source },
				);
			}
			const localNative = native.handle.source.type === "local";
			for (const bundle of native.bundles) {
				selections.push({
					bundle,
					handle: native.handle,
					skills: native.skills.filter((skill) =>
						inResolvedBundle(skill, bundle, localNative),
					),
				});
			}
			if (native.bundles.length === 0) await native.handle.dispose();
		}
		for (const entry of exported) {
			const resolved = await resolveBundleSource({
				source: entry.canonical,
				bundles: [entry.bundle],
				cwd: workspace,
				workspace,
			});
			selections.push({
				bundle: entry.bundle,
				handle: resolved.handle,
				skills: resolved.skills,
			});
		}

		const resolvedBundles = selections.map((selection) => selection.bundle);
		const source = canonicalSource ?? parsed.source;
		const current = config ?? { sources: [] };
		const existing = current.sources.find((entry) => entry.source === source);
		const bundles = resolvedBundles.filter((bundle) => !existing?.bundles.includes(bundle));
		for (const entry of exported.filter((candidate) =>
			existing?.bundles.includes(candidate.bundle),
		)) {
			await validateExistingExportedBundle(adapted, workspace, entry);
		}
		if (bundles.length === 0) {
			return {
				status: "unchanged",
				source: parsed.source,
				bundles: resolvedBundles,
				installed: 0,
			};
		}
		const next = withBundles(current, source, bundles);
		const selected = selections.filter((selection) => bundles.includes(selection.bundle));
		const skills = selected.flatMap((selection) => [...selection.skills]);
		const names = new Set<string>();
		for (const skill of skills) {
			if (names.has(skill.name)) {
				throw responseError(
					"SKILL_NAME_COLLISION",
					`Skill name collision: ${skill.name}. No skills were changed.`,
					{ source: parsed.source, skill: skill.name },
				);
			}
			names.add(skill.name);
			if (
				(lock && Object.hasOwn(lock.skills, skill.name)) ||
				(await statOptional(join(workspace, ".agents/skills", skill.name)))
			) {
				throw responseError(
					"SKILL_NAME_COLLISION",
					`Skill name collision: ${skill.name}. No skills were changed.`,
					{ source: parsed.source, skill: skill.name },
				);
			}
		}
		for (const entry of exported.filter((candidate) => bundles.includes(candidate.bundle))) {
			if (await statOptional(join(workspace, "skillbox/patches", entry.bundle)))
				throw responseError(
					"PATCH_PACK_EXISTS",
					`Patch pack already exists: ${entry.bundle}. No skills were changed.`,
					{ skill: entry.bundle },
				);
		}

		const staging = await mkdtemp(join(workspace, ".skillbox-add-"));
		let retainStaging = false;
		try {
			if (lockText !== undefined) {
				await mkdir(join(staging, ".agents"));
				await cp(join(workspace, ".agents/skills"), join(staging, ".agents/skills"), {
					recursive: true,
				});
				await writeFile(
					join(staging, sdkLockPath),
					relocateLock(lockText, workspace, staging),
				);
			}
			for (const selection of selected) {
				const result = await installSkills(selection.handle, {
					cwd: staging,
					config: sdkConfig,
					skills: selection.skills.map((skill) => skill.name),
					onWarning: (warning) => {
						throw warning;
					},
				});
				if (result.failed.length > 0) {
					throw new ResponseError(
						result.failed.map((failure) => ({
							code: failure.code,
							message: failure.message,
							source: parsed.source,
							skill: failure.skill,
						})),
					);
				}
				if (
					result.skipped.length > 0 ||
					result.installed.length !== selection.skills.length
				) {
					throw responseError(
						"INSTALL_INCOMPLETE",
						"The library did not install every selected skill. No skills were changed.",
						{ source: parsed.source },
					);
				}
			}

			await mkdir(dirname(join(staging, configPath)), { recursive: true });
			await writeFile(join(staging, configPath), `${JSON.stringify(next, null, 2)}\n`);
			const installedLockText = relocateLock(
				await readFile(join(staging, sdkLockPath), "utf8"),
				staging,
				workspace,
			);
			const installedLock = readLock(installedLockText);
			for (const entry of exported.filter((candidate) =>
				bundles.includes(candidate.bundle),
			)) {
				const selection = selected.find((candidate) => candidate.bundle === entry.bundle);
				for (const skill of selection?.skills ?? []) {
					const provenance = installedLock.skills[skill.name] as Record<string, unknown>;
					provenance.source = entry.descriptor.source;
					provenance.sourceType = entry.lock.pin.type;
					delete provenance.skillPath;
					if (entry.lock.pin.type === "git") {
						provenance.ref = entry.lock.pin.revision;
						delete provenance.snapshot;
					} else {
						provenance.snapshot = entry.lock.pin.digest;
						delete provenance.ref;
					}
				}
			}
			await writeFile(join(staging, lockPath), `${JSON.stringify(installedLock, null, 2)}\n`);
			await mkdir(join(staging, ".claude"));
			await symlink("../.agents/skills", join(staging, ".claude/skills"));
			const publishEntries = [".agents/skills", ".claude/skills", lockPath, configPath].map(
				(path) => ({ staged: join(staging, path), target: join(workspace, path) }),
			);
			for (const entry of exported.filter((candidate) =>
				bundles.includes(candidate.bundle),
			)) {
				const path = join("skillbox/patches", entry.bundle);
				await mkdir(join(staging, path), { recursive: true });
				await writeFile(
					join(staging, path, "bundle.toml"),
					descriptorText(entry.descriptor),
				);
				await writeFile(join(staging, path, "lock.json"), bundleLockText(entry.lock));
				publishEntries.push({ staged: join(staging, path), target: join(workspace, path) });
			}
			try {
				await publish(staging, publishEntries);
			} catch (cause) {
				retainStaging = true;
				throw responseError(
					"PUBLISH_FAILED",
					`Could not publish installation: ${errorMessage(cause)} Recovery files retained at ${staging}.`,
					{ source: parsed.source },
					cause,
				);
			}
			return {
				status: "added",
				source: parsed.source,
				bundles: resolvedBundles,
				installed: skills.length,
			};
		} finally {
			if (!retainStaging) await rm(staging, { recursive: true, force: true });
		}
	} finally {
		const handles = new Set(selections.map((selection) => selection.handle));
		await Promise.all([...handles].map((handle) => handle.dispose()));
		await Promise.all(exported.map((entry) => entry.dispose()));
	}
}

async function validateExistingExportedBundle(
	adapted: AdaptedBundles,
	workspace: string,
	entry: ResolvedExportedBundle,
): Promise<void> {
	const pack = await readAdaptedBundle(workspace, entry.bundle);
	if (!pack)
		throw responseError("PATCH_PACK_NOT_FOUND", `Patch pack not found: ${entry.bundle}.`, {
			skill: entry.bundle,
		});
	if (
		pack.descriptor.source_type !== "bundle" ||
		pack.descriptor.source !== entry.source ||
		pack.descriptor.source_bundle !== entry.bundle
	)
		throw responseError(
			"BUNDLE_SOURCE_MISMATCH",
			`Patch bundle ${entry.bundle} belongs to a different source.`,
			{ source: entry.source, skill: entry.bundle },
		);
	const validation = await mkdtemp(join(workspace, ".skillbox-add-check-"));
	try {
		await adapted.materializeBundle(workspace, entry.bundle, join(validation, "materialized"));
	} finally {
		await rm(validation, { recursive: true, force: true });
	}
}

async function resolveWorkspace(cwd: string, input: string): Promise<string> {
	try {
		return await realpath(resolve(cwd, input));
	} catch (cause) {
		throw responseError(
			"WORKSPACE_NOT_FOUND",
			`Workspace does not exist: ${input}`,
			{ input },
			cause,
		);
	}
}

async function requireAbsent(workspace: string, path: string): Promise<void> {
	if (await statOptional(join(workspace, path))) {
		throw responseError(
			"MIGRATION_REQUIRED",
			`Existing ${path}; migration is not implemented yet. No skills were changed.`,
			{ input: path },
		);
	}
}

function inResolvedBundle(skill: SkillInfo, bundle: string, local: boolean): boolean {
	const prefix = `${local ? "" : "skillbox/"}${bundle}/`;
	return [skill.path, ...(skill.duplicates ?? [])].some((path) => path?.startsWith(prefix));
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
