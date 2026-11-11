import {
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
import { installSkills } from "skills";
import { configPath, readConfig } from "../workspace/config.ts";
import { lockPath, readLock, relocateLock } from "../workspace/lock.ts";
import { readOptional, statOptional } from "../workspace/paths.ts";
import { publish } from "../workspace/publish.ts";
import { ResponseError, responseError } from "../response.ts";
import { resolveBundleSource, sdkConfig, sdkLockPath } from "../workspace/sdk.ts";

export interface SyncInput {
	cwd: string;
	workspace?: string;
}

export interface SyncResult {
	status: "synced" | "unchanged";
	installed: number;
	unchanged: number;
	/** Deselected lock entries, including skills already absent from disk. */
	removed: number;
}

export async function sync(input: SyncInput): Promise<SyncResult> {
	const workspace = await realpath(resolve(input.cwd, input.workspace ?? "."));
	const config = await readConfig(workspace);
	if (!config) {
		throw responseError("CONFIG_NOT_FOUND", `Missing ${configPath}; nothing to sync.`, {
			input: configPath,
		});
	}

	const lockText = await readOptional(join(workspace, lockPath));
	if (lockText === undefined) {
		throw responseError("LOCK_NOT_FOUND", `Missing ${lockPath}; cannot sync.`, {
			input: lockPath,
		});
	}
	const lock = readLock(lockText);
	const configText = await readFile(join(workspace, configPath), "utf8");

	const staging = await mkdtemp(join(workspace, ".skillbox-sync-"));
	let retainStaging = false;
	try {
		const selectedNames = new Set<string>();
		for (const source of config.sources) {
			const resolved = await resolveBundleSource({
				source: source.source,
				bundles: source.bundles,
				cwd: workspace,
				workspace,
			});
			try {
				for (const skill of resolved.skills) {
					if (selectedNames.has(skill.name)) {
						throw responseError(
							"SKILL_NAME_COLLISION",
							`Skill name collision: ${skill.name}. No skills were changed.`,
							{ source: resolved.source, skill: skill.name },
						);
					}
					selectedNames.add(skill.name);
				}

				const result = await installSkills(resolved.handle, {
					cwd: staging,
					config: sdkConfig,
					skills: resolved.skills.map((skill) => skill.name),
					onWarning: (warning) => {
						throw warning;
					},
				});
				if (result.failed.length > 0) {
					throw new ResponseError(
						result.failed.map((failure) => ({
							code: failure.code,
							message: failure.message,
							source: resolved.source,
							skill: failure.skill,
						})),
					);
				}
				if (
					result.skipped.length > 0 ||
					result.installed.length !== resolved.skills.length
				) {
					throw new Error(
						"The library did not install every selected skill. No skills were changed.",
					);
				}
			} finally {
				await resolved.handle.dispose();
			}
		}

		const expectedNames = [...selectedNames].sort();
		const lockedNames = Object.keys(lock.skills);
		const removed = lockedNames.filter((name) => !selectedNames.has(name)).length;
		const lockChanged =
			removed > 0 || expectedNames.some((name) => !Object.hasOwn(lock.skills, name));

		const generatedText =
			expectedNames.length === 0
				? `${JSON.stringify({ version: 1, skills: {} })}\n`
				: await readOptional(join(staging, sdkLockPath));
		if (generatedText === undefined) {
			throw responseError(
				"SDK_LOCK_NOT_GENERATED",
				"The SDK did not generate its staging lockfile. No skills were changed.",
				{ input: lockPath },
			);
		}
		const generated = readLock(relocateLock(generatedText, staging, workspace));
		const generatedNames = Object.keys(generated.skills).sort();
		if (!sameStrings(expectedNames, generatedNames)) {
			throw responseError(
				"SDK_SKILL_MISMATCH",
				"The SDK generated a different skill set from the configured selections. No skills were changed.",
			);
		}
		const nextSkills = { ...generated.skills };
		for (const [name, skill] of Object.entries(generated.skills)) {
			if (!Object.hasOwn(lock.skills, name)) continue;
			const locked = lock.skills[name];
			if (skill.computedHash !== locked.computedHash) {
				throw responseError(
					"LOCK_HASH_MISMATCH",
					`Content hash mismatch for ${name}; ${lockPath} was not changed.`,
					{ skill: name },
				);
			}
			nextSkills[name] = locked;
		}

		const nextLock = { ...lock, skills: nextSkills };
		const nextLockText = lockChanged ? `${JSON.stringify(nextLock, null, 2)}\n` : lockText;

		await rejectUnmanagedSkills(workspace, lockedNames);
		await rejectConflictingClaudeSkills(workspace);

		let unchanged = 0;
		for (const name of expectedNames) {
			if (
				await sameTree(
					join(staging, ".agents/skills", name),
					join(workspace, ".agents/skills", name),
				)
			) {
				unchanged += 1;
			}
		}
		const claudeMatches = await hasClaudeSkillsLink(workspace);
		const skillsDirectory = await statOptional(join(workspace, ".agents/skills"));
		if (
			!lockChanged &&
			unchanged === expectedNames.length &&
			claudeMatches &&
			skillsDirectory?.isDirectory()
		) {
			return { status: "unchanged", installed: 0, unchanged, removed: 0 };
		}

		await mkdir(join(staging, ".agents/skills"), { recursive: true });
		await mkdir(join(staging, "skillbox"), { recursive: true });
		await writeFile(join(staging, configPath), configText);
		await writeFile(join(staging, lockPath), nextLockText);
		await mkdir(join(staging, ".claude"), { recursive: true });
		await symlink("../.agents/skills", join(staging, ".claude/skills"));
		try {
			await publish(staging, workspace);
		} catch (cause) {
			retainStaging = true;
			throw responseError(
				"PUBLISH_FAILED",
				`Could not publish sync: ${cause instanceof Error ? cause.message : String(cause)} Recovery files retained at ${staging}.`,
				{ input: staging },
				cause,
			);
		}
		return {
			status: "synced",
			installed: expectedNames.length - unchanged,
			unchanged,
			removed,
		};
	} finally {
		if (!retainStaging) await rm(staging, { recursive: true, force: true });
	}
}

// -----------------------------------------------------------------------------

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

async function rejectUnmanagedSkills(workspace: string, lockedNames: readonly string[]) {
	const skillsPath = join(workspace, ".agents/skills");
	const directory = await statOptional(skillsPath);
	if (!directory) return;
	if (!directory.isDirectory()) {
		throw responseError(
			"MANAGED_SKILLS_INVALID",
			"Managed .agents/skills must be a real directory. Remove the conflict before syncing.",
			{ input: ".agents/skills" },
		);
	}
	const tracked = new Set(lockedNames);
	const unmanaged = (await readdir(skillsPath)).filter((name) => !tracked.has(name)).sort();
	if (unmanaged.length > 0) {
		throw new ResponseError(
			unmanaged.map((skill) => ({
				code: "UNMANAGED_SKILL",
				message: `Unmanaged skill would be replaced: ${skill}. No skills were changed.`,
				skill,
			})),
		);
	}
}

async function rejectConflictingClaudeSkills(workspace: string) {
	const path = join(workspace, ".claude/skills");
	const entry = await statOptional(path);
	if (!entry || (entry.isSymbolicLink() && (await hasClaudeSkillsLink(workspace)))) return;
	throw responseError(
		"CLAUDE_SKILLS_LINK_INVALID",
		"Existing .claude/skills does not link to .agents/skills. No skills were changed.",
		{ input: ".claude/skills" },
	);
}

async function hasClaudeSkillsLink(workspace: string): Promise<boolean> {
	const path = join(workspace, ".claude/skills");
	const entry = await statOptional(path);
	return (
		entry?.isSymbolicLink() === true &&
		resolve(dirname(path), await readlink(path)) === join(workspace, ".agents/skills")
	);
}

async function sameTree(left: string, right: string): Promise<boolean> {
	const [leftEntry, rightEntry] = await Promise.all([statOptional(left), statOptional(right)]);
	if (!leftEntry || !rightEntry) return false;
	if (
		leftEntry.isDirectory() !== rightEntry.isDirectory() ||
		leftEntry.isFile() !== rightEntry.isFile() ||
		leftEntry.isSymbolicLink() !== rightEntry.isSymbolicLink()
	) {
		return false;
	}
	if (leftEntry.isSymbolicLink()) {
		const [leftTarget, rightTarget] = await Promise.all([readlink(left), readlink(right)]);
		return leftTarget === rightTarget;
	}
	if (leftEntry.isFile()) {
		const [leftContents, rightContents] = await Promise.all([readFile(left), readFile(right)]);
		return leftContents.equals(rightContents);
	}
	if (!leftEntry.isDirectory()) return false;

	const [leftNames, rightNames] = await Promise.all([readdir(left), readdir(right)]);
	leftNames.sort();
	rightNames.sort();
	if (!sameStrings(leftNames, rightNames)) return false;
	return (
		await Promise.all(leftNames.map((name) => sameTree(join(left, name), join(right, name))))
	).every(Boolean);
}
