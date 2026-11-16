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
import { exportIds, isLocalSource, type Bundles } from "../workspace/bundles.ts";
import { contributionIdentity, type Config } from "../workspace/config.ts";
import { emptyLock, jsonText, lockSchema, readLock, type Lock } from "../workspace/lock.ts";
import { z } from "zod";
import {
	selectWorkspace,
	sharedPaths,
	localPaths,
	type WorkspaceContext,
} from "../workspace/context.ts";
import { applyInvocationPolicy } from "../workspace/invocation.ts";
import { readOptional, regularPath, statOptional } from "../workspace/paths.ts";
import { publish } from "../workspace/publish.ts";

export const receiptPath = "skillbox/.local/install-state.json";
const receiptSchema = z.strictObject({
	version: z.literal(1),
	owner: z.enum(["shared", "local"]),
	personalInitialized: z.boolean(),
	installed: lockSchema.shape.installed,
});
export type InstallationReceipt = z.infer<typeof receiptSchema>;

export interface SyncResult {
	status: "synced" | "unchanged";
	config: string;
	installed: number;
	unchanged: number;
	removed: number;
}
export async function sync(input: {
	bundles: Bundles;
	cwd: string;
	workspace?: string;
}): Promise<SyncResult> {
	const context = await selectWorkspace(
		await realpath(resolve(input.cwd, input.workspace ?? ".")),
	);
	const { config, paths } = context;
	if (!config)
		throw responseError("CONFIG_NOT_FOUND", `Missing ${paths.config}.`, {
			input: paths.config,
		});
	const receipt = await installationState(context);
	let lock = context.lock;
	if (!lock && paths.kind === "local")
		lock = await input.bundles.resolvePins({ ...context, config, lock: emptyLock() });
	if (!lock && config.sources.length)
		throw responseError("LOCK_MISSING", `Missing ${paths.lock}. Register sources with add.`, {
			input: paths.lock,
		});
	return reconcile(input.bundles, { context, config, candidate: lock ?? emptyLock(), receipt });
}

/** Stage exports, selected installation and metadata together; publish only after all checks pass. */
export async function reconcile(
	bundles: Bundles,
	input: {
		context: WorkspaceContext;
		config: Config;
		candidate: Lock;
		receipt: InstallationReceipt;
		writeConfig?: boolean;
	},
): Promise<SyncResult> {
	const { context, config, receipt, writeConfig = false } = input;
	const { root, paths, lock: current } = context;
	let candidate = input.candidate;
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
	await preflight(root, receipt);
	const staging = await mkdtemp(join(root, ".skillbox-sync-"));
	let retain = false;
	try {
		const ids = new Set([...(await exportIds({ ...context, config })), ...config.install]);
		const next: Lock = { ...candidate, bundles: {}, installed: {} };
		await mkdir(join(staging, ".agents/skills"), { recursive: true });
		for (const id of [...ids].sort()) {
			const directory = join(staging, "exports", id);
			await mkdir(dirname(directory), { recursive: true });
			const composed = await bundles.compose(
				{ ...context, config, lock: candidate },
				id,
				directory,
			);
			next.bundles[id] = composed;
			if (!config.install.includes(id)) continue;
			for (const member of composed.members) {
				if (Object.hasOwn(next.installed, member.name))
					throw responseError(
						"SKILL_NAME_COLLISION",
						`Installed skill collision: ${member.name}.`,
						{ skill: member.name },
					);
				const installed = join(staging, ".agents/skills", member.name);
				await cp(join(directory, member.directory), installed, {
					recursive: true,
					preserveTimestamps: true,
				});
				await applyInvocationPolicy(installed);
				next.installed[member.name] = {
					bundle: id,
					directory: member.directory,
					hash: await hashTree(installed),
				};
			}
		}
		let unchanged = 0;
		for (const [name, entry] of Object.entries(next.installed)) {
			const path = join(root, ".agents/skills", name);
			if ((await statOptional(path))?.isDirectory() && (await hashTree(path)) === entry.hash)
				unchanged++;
		}
		const removed = Object.keys(receipt.installed).filter(
			(name) => !Object.hasOwn(next.installed, name),
		).length;
		const nextReceipt: InstallationReceipt = {
			version: 1,
			owner: paths.kind,
			personalInitialized: receipt.personalInitialized || paths.kind === "local",
			installed: next.installed,
		};
		const receiptText = jsonText(nextReceipt);
		const configText = jsonText(config);
		const nextText = jsonText(lockSchema.parse(next));
		const sameConfig =
			!writeConfig || (await readOptional(join(root, paths.config))) === configText;
		if (
			(await readOptional(join(root, receiptPath))) === receiptText &&
			jsonText(current) === nextText &&
			sameConfig &&
			unchanged === Object.keys(next.installed).length &&
			(await statOptional(join(root, ".agents/skills")))?.isDirectory() &&
			(await hasClaudeLink(root))
		)
			return {
				status: "unchanged",
				config: paths.config,
				installed: 0,
				unchanged,
				removed: 0,
			};
		await mkdir(dirname(join(staging, receiptPath)), { recursive: true });
		await writeFile(join(staging, paths.lock), nextText);
		await writeFile(join(staging, receiptPath), receiptText);
		await mkdir(join(staging, ".claude"));
		await symlink("../.agents/skills", join(staging, ".claude/skills"));
		const targets = [".agents/skills", ".claude/skills", paths.lock, receiptPath];
		if (writeConfig) {
			await writeFile(join(staging, paths.config), configText);
			targets.push(paths.config);
		}
		try {
			await publish(
				staging,
				targets.map((path) => ({ staged: join(staging, path), target: join(root, path) })),
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
			config: paths.config,
			installed: Object.keys(next.installed).length - unchanged,
			unchanged,
			removed,
		};
	} finally {
		if (!retain) await rm(staging, { recursive: true, force: true });
	}
}

async function preflight(root: string, receipt: InstallationReceipt): Promise<void> {
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
			if (!Object.hasOwn(receipt.installed, name))
				throw responseError(
					"UNMANAGED_SKILL",
					`Unmanaged skill would be replaced: ${name}.`,
					{ skill: name },
				);
	}
	for (const [name, managed] of Object.entries(receipt.installed)) {
		const path = join(skills, name);
		const entry = await statOptional(path);
		if (entry && (!entry.isDirectory() || (await hashTree(path)) !== managed.hash))
			throw responseError(
				"MANAGED_SKILL_MODIFIED",
				`Managed skill was edited: ${path}. Back up or capture your edits before syncing.`,
				{ skill: name, input: path },
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

export async function installationState(context: WorkspaceContext): Promise<InstallationReceipt> {
	const { root, paths, lock } = context;
	const text = await readOptional(await regularPath(root, receiptPath));
	let receipt: InstallationReceipt;
	if (text !== undefined) {
		try {
			receipt = receiptSchema.parse(JSON.parse(text));
		} catch (cause) {
			throw responseError(
				"INSTALL_STATE_INVALID",
				`Invalid ${receiptPath}.`,
				{ input: receiptPath },
				cause,
			);
		}
	} else {
		const privateLock = await statOptional(join(root, localPaths.lock));
		const output = join(root, ".agents/skills");
		const outputEntry = await statOptional(output);
		if (outputEntry && !outputEntry.isDirectory())
			throw responseError(
				"MANAGED_SKILLS_INVALID",
				"Managed skills must be a real directory.",
				{ input: ".agents/skills" },
			);
		if (privateLock && outputEntry && (await readdir(output)).length)
			throw responseError(
				"INSTALL_STATE_MISSING",
				`Missing ${receiptPath} for an existing personal installation.`,
				{ input: receiptPath },
			);
		const shared = privateLock
			? undefined
			: paths.kind === "shared"
				? lock
				: await readLock(root, sharedPaths.lock);
		receipt = {
			version: 1,
			owner: "shared",
			personalInitialized: privateLock !== undefined,
			installed: privateLock ? {} : (shared?.installed ?? {}),
		};
	}
	if (paths.kind === "local" && !lock && receipt.personalInitialized)
		throw responseError(
			"LOCK_MISSING",
			`Restore ${paths.lock} before using this initialized personal workspace.`,
			{ input: paths.lock },
		);
	return receipt;
}
