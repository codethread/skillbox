import { realpath } from "node:fs/promises";
import { join } from "node:path";
import { responseError } from "../response.ts";
import { configPath, readConfig, type Config } from "./config.ts";
import { lockPath, readLock, type Lock } from "./lock.ts";
import { regularPath, statOptional } from "./paths.ts";

export const sharedPaths = {
	kind: "shared",
	config: configPath,
	lock: lockPath,
	patches: "skillbox/patches",
	prepare: "skillbox/.prepare",
} as const;
export const localPaths = {
	kind: "local",
	config: "skillbox/.local/config.json",
	lock: "skillbox/.local/lock.json",
	patches: "skillbox/.local/patches",
	prepare: sharedPaths.prepare,
} as const;
export type WorkspacePaths = typeof sharedPaths | typeof localPaths;
export interface WorkspaceContext {
	/** Canonical workspace identity, also used by prepared manifests and import cycles. */
	root: string;
	/** One fixed ownership family for all consumer state. */
	paths: WorkspacePaths;
	config: Config | undefined;
	/** Resolution state, not authority for the physical installation. */
	lock: Lock | undefined;
}
export type WorkspaceSnapshot = WorkspaceContext & { config: Config; lock: Lock };

export async function selectWorkspace(root: string): Promise<WorkspaceContext> {
	const context = await readWorkspace(
		root,
		(await statOptional(join(root, localPaths.config))) ? "local" : "shared",
	);
	if (context.paths.kind === "local" && !context.config)
		throw responseError("CONFIG_NOT_FOUND", `Missing selected ${context.paths.config}.`, {
			input: context.paths.config,
		});
	return context;
}

export async function readWorkspace(
	root: string,
	kind: WorkspacePaths["kind"],
): Promise<WorkspaceContext> {
	root = await realpath(root);
	const paths = kind === "shared" ? sharedPaths : localPaths;
	for (const path of [paths.config, paths.lock, paths.patches]) await regularPath(root, path);
	return {
		root,
		paths,
		config: await readConfig(root, paths.config),
		lock: await readLock(root, paths.lock),
	};
}
