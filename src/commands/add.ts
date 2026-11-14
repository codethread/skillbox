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
import { installSkills, type SkillInfo } from "skills";
import { z } from "zod";
import { configPath, readConfig, withBundles } from "../workspace/config.ts";
import { lockPath, readLock, relocateLock } from "../workspace/lock.ts";
import { readOptional, statOptional } from "../workspace/paths.ts";
import { publish } from "../workspace/publish.ts";
import { ResponseError, responseError } from "../response.ts";
import { resolveBundleSource, sdkConfig, sdkLockPath } from "../workspace/sdk.ts";

const inputSchema = z.object({
	cwd: z.string().min(1),
	source: z.string().min(1),
	bundles: z.array(z.string()).default([]),
	workspace: z.string().min(1).default("."),
});

export interface AddResult {
	status: "added" | "unchanged";
	source: string;
	bundles: string[];
	installed: number;
}

export async function add(input: z.input<typeof inputSchema>): Promise<AddResult> {
	const parsed = inputSchema.parse(input);
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

	const resolved = await resolveBundleSource({
		source: parsed.source,
		bundles: parsed.bundles,
		cwd: parsed.cwd,
		workspace,
	});
	try {
		const current = config ?? { sources: [] };
		const existing = current.sources.find((entry) => entry.source === resolved.source);
		const bundles = resolved.bundles.filter((bundle) => !existing?.bundles.includes(bundle));
		if (bundles.length === 0) {
			return {
				status: "unchanged",
				source: parsed.source,
				bundles: resolved.bundles,
				installed: 0,
			};
		}
		const next = withBundles(current, resolved.source, bundles);
		const local = resolved.handle.source.type === "local";
		const skills = resolved.skills.filter((skill) =>
			bundles.some((bundle) => inBundle(skill, bundle, local)),
		);

		for (const skill of skills) {
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
			const result = await installSkills(resolved.handle, {
				cwd: staging,
				config: sdkConfig,
				skills: skills.map((skill) => skill.name),
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
			if (result.skipped.length > 0 || result.installed.length !== skills.length) {
				throw responseError(
					"INSTALL_INCOMPLETE",
					"The library did not install every selected skill. No skills were changed.",
					{ source: parsed.source },
				);
			}

			await mkdir(dirname(join(staging, configPath)), { recursive: true });
			await writeFile(join(staging, configPath), `${JSON.stringify(next, null, 2)}\n`);
			await writeFile(
				join(staging, lockPath),
				relocateLock(
					await readFile(join(staging, sdkLockPath), "utf8"),
					staging,
					workspace,
				),
			);
			await mkdir(join(staging, ".claude"));
			await symlink("../.agents/skills", join(staging, ".claude/skills"));
			try {
				await publish(
					staging,
					[".agents/skills", ".claude/skills", lockPath, configPath].map((path) => ({
						staged: join(staging, path),
						target: join(workspace, path),
					})),
				);
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
				bundles: resolved.bundles,
				installed: skills.length,
			};
		} finally {
			if (!retainStaging) await rm(staging, { recursive: true, force: true });
		}
	} finally {
		await resolved.handle.dispose();
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

function inBundle(skill: SkillInfo, bundle: string, local: boolean): boolean {
	const prefix = `${local ? "" : "skillbox/"}${bundle}/`;
	return [skill.path, ...(skill.duplicates ?? [])].some((path) => path?.startsWith(prefix));
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
