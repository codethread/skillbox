import {
	cp,
	mkdir,
	mkdtemp,
	readlink,
	readdir,
	realpath,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { responseError } from "../response.ts";
import { hashTree } from "../workspace/patches.ts";
import { discover, isLocalSource, type Bundles } from "../workspace/bundles.ts";
import { configPath, contributionIdentity, readConfig, type Config } from "../workspace/config.ts";
import {
	emptyLock,
	jsonText,
	lockPath,
	lockSchema,
	readLock,
	type Lock,
} from "../workspace/lock.ts";
import { readOptional, statOptional } from "../workspace/paths.ts";
import { publish } from "../workspace/publish.ts";

export interface SyncResult {
	status: "synced" | "unchanged";
	installed: number;
	unchanged: number;
	removed: number;
}
export async function sync(input: {
	bundles: Bundles;
	cwd: string;
	workspace?: string;
}): Promise<SyncResult> {
	const root = await realpath(resolve(input.cwd, input.workspace ?? "."));
	const config = await readConfig(root);
	if (!config)
		throw responseError("CONFIG_NOT_FOUND", `Missing ${configPath}.`, { input: configPath });
	const lock = await readLock(root);
	if (!lock && config.sources.length)
		throw responseError("LOCK_MISSING", `Missing ${lockPath}. Register sources with add.`, {
			input: lockPath,
		});
	return reconcile(input.bundles, root, config, lock ?? emptyLock());
}

/** Stage exports, selected installation and metadata together; publish only after all checks pass. */
export async function reconcile(
	bundles: Bundles,
	root: string,
	config: Config,
	candidate: Lock,
	writeConfig = false,
): Promise<SyncResult> {
	const current = await readLock(root);
	const sources: Lock["sources"] = {};
	for (const contribution of config.sources) {
		const key = contributionIdentity(contribution);
		const entry = candidate.sources[key];
		if (!entry)
			throw responseError(
				"PIN_MISSING",
				`Missing source pin for ${contribution.source}. Register it with add.`,
				{ source: contribution.source },
			);
		if (isLocalSource(contribution.source) && contribution.ref)
			throw responseError("REF_UNSUPPORTED", "Local authored sources do not accept ref.", {
				source: contribution.source,
			});
		sources[key] = { contribution, pin: entry.pin };
	}
	candidate = { ...candidate, sources };
	await preflight(root, current ?? emptyLock());
	const staging = await mkdtemp(join(root, ".skillbox-sync-"));
	let retain = false;
	try {
		const ids = new Set([...config.sources.map((source) => source.id), ...config.install]);
		if (await statOptional(join(root, "skillbox")))
			for (const entry of await readdir(join(root, "skillbox"), { withFileTypes: true })) {
				if (
					entry.isDirectory() &&
					!["patches", ".prepare"].includes(entry.name) &&
					(
						await discover(
							join(root, "skillbox", entry.name),
							".",
							`skillbox/${entry.name}`,
						)
					).length
				)
					ids.add(entry.name);
			}
		const next: Lock = { ...candidate, bundles: {}, installed: {} };
		await mkdir(join(staging, ".agents/skills"), { recursive: true });
		for (const id of [...ids].sort()) {
			const directory = join(staging, "exports", id);
			await mkdir(dirname(directory), { recursive: true });
			const composed = await bundles.compose(root, config, candidate, id, directory);
			next.bundles[id] = composed;
			if (!config.install.includes(id)) continue;
			for (const member of composed.members) {
				if (Object.hasOwn(next.installed, member.name))
					throw responseError(
						"SKILL_NAME_COLLISION",
						`Installed skill collision: ${member.name}.`,
						{ skill: member.name },
					);
				const skill = join(directory, member.directory);
				next.installed[member.name] = {
					bundle: id,
					directory: member.directory,
					hash: await hashTree(skill),
				};
				await cp(skill, join(staging, ".agents/skills", member.name), {
					recursive: true,
					preserveTimestamps: true,
				});
			}
		}
		let unchanged = 0;
		for (const [name, entry] of Object.entries(next.installed)) {
			const path = join(root, ".agents/skills", name);
			if ((await statOptional(path))?.isDirectory() && (await hashTree(path)) === entry.hash)
				unchanged++;
		}
		const removed = Object.keys(current?.installed ?? {}).filter(
			(name) => !Object.hasOwn(next.installed, name),
		).length;
		const configText = jsonText(config);
		const nextText = jsonText(lockSchema.parse(next));
		const sameConfig =
			!writeConfig || (await readOptional(join(root, configPath))) === configText;
		if (
			current &&
			jsonText(current) === nextText &&
			sameConfig &&
			unchanged === Object.keys(next.installed).length &&
			(await statOptional(join(root, ".agents/skills")))?.isDirectory() &&
			(await hasClaudeLink(root))
		)
			return { status: "unchanged", installed: 0, unchanged, removed: 0 };
		await mkdir(join(staging, "skillbox"), { recursive: true });
		await writeFile(join(staging, lockPath), nextText);
		await mkdir(join(staging, ".claude"));
		await symlink("../.agents/skills", join(staging, ".claude/skills"));
		const paths = [".agents/skills", ".claude/skills", lockPath];
		if (writeConfig) {
			await writeFile(join(staging, configPath), configText);
			paths.push(configPath);
		}
		try {
			await publish(
				staging,
				paths.map((path) => ({ staged: join(staging, path), target: join(root, path) })),
			);
		} catch (cause) {
			retain = true;
			throw responseError(
				"PUBLISH_FAILED",
				`Publication failed; recovery retained at ${staging}.`,
				{ input: staging },
				cause,
			);
		}
		return {
			status: "synced",
			installed: Object.keys(next.installed).length - unchanged,
			unchanged,
			removed,
		};
	} finally {
		if (!retain) await rm(staging, { recursive: true, force: true });
	}
}

async function preflight(root: string, lock: Lock): Promise<void> {
	const skills = join(root, ".agents/skills");
	const entry = await statOptional(skills);
	if (entry) {
		if (!entry.isDirectory())
			throw responseError(
				"MANAGED_SKILLS_INVALID",
				"Managed skills must be a real directory.",
				{ input: ".agents/skills" },
			);
		for (const name of await readdir(skills))
			if (!Object.hasOwn(lock.installed, name))
				throw responseError(
					"UNMANAGED_SKILL",
					`Unmanaged skill would be replaced: ${name}.`,
					{ skill: name },
				);
	}
	if ((await statOptional(join(root, ".claude/skills"))) && !(await hasClaudeLink(root)))
		throw responseError(
			"CLAUDE_SKILLS_LINK_INVALID",
			"Existing .claude/skills does not link to .agents/skills.",
			{ input: ".claude/skills" },
		);
}
async function hasClaudeLink(root: string): Promise<boolean> {
	const path = join(root, ".claude/skills");
	return (
		(await statOptional(path))?.isSymbolicLink() === true &&
		resolve(dirname(path), await readlink(path)) === join(root, ".agents/skills")
	);
}
