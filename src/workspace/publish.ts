import { mkdir, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { statOptional } from "./paths.ts";

export async function publish(staging: string, cwd: string, paths: readonly string[]) {
	const changes: { target: string; backup?: string; installed: boolean }[] = [];
	try {
		for (const path of paths) {
			const target = join(cwd, path);
			await mkdir(dirname(target), { recursive: true });
			const backup = (await statOptional(target))
				? join(staging, ".previous", path)
				: undefined;
			if (backup) {
				await mkdir(dirname(backup), { recursive: true });
				await rename(target, backup);
			}
			const change = { target, backup, installed: false };
			changes.push(change);
			await rename(join(staging, path), target);
			change.installed = true;
		}
	} catch (error) {
		const failures: unknown[] = [error];
		for (const change of changes.reverse()) {
			try {
				if (change.installed) await rm(change.target, { recursive: true, force: true });
				if (change.backup) await rename(change.backup, change.target);
			} catch (rollbackError) {
				failures.push(rollbackError);
			}
		}
		if (failures.length > 1) {
			throw new AggregateError(failures, "Publishing failed and rollback was incomplete.");
		}
		throw error;
	}
}
