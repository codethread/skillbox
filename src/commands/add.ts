import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { responseError } from "../response.ts";
import { isLocalSource, type Bundles } from "../workspace/bundles.ts";
import {
	contributionIdentity,
	contributionSchema,
	readConfig,
	withContribution,
} from "../workspace/config.ts";
import { emptyLock, readLock } from "../workspace/lock.ts";
import { localPath } from "../workspace/paths.ts";
import { reconcile } from "./sync.ts";

export async function add(input: {
	bundles: Bundles;
	cwd: string;
	workspace: string;
	contribution: unknown;
	install: boolean;
}) {
	const workspace = await realpath(resolve(input.cwd, input.workspace));
	const contribution = contributionSchema.parse(input.contribution);
	if (isLocalSource(contribution.source))
		contribution.source = localPath(
			workspace,
			await realpath(resolve(input.cwd, contribution.source)),
		);
	const config = await readConfig(workspace);
	const lock = await readLock(workspace);
	if (isLocalSource(contribution.source) && contribution.ref)
		throw responseError(
			"REF_UNSUPPORTED",
			"Local authored sources do not accept --ref; use file:// for pinned Git.",
			{ source: contribution.source },
		);
	const current = lock?.sources[contributionIdentity(contribution)];
	if (
		current &&
		contribution.ref !== undefined &&
		contribution.ref !== (current.contribution.ref ?? "HEAD")
	)
		throw responseError(
			"UPDATE_REQUIRED",
			"This contribution is already pinned. Use update --ref and patch capture to review a different ref.",
			{ source: contribution.source, input: contribution.ref },
		);
	if (config?.sources.length && !lock)
		throw responseError(
			"LOCK_MISSING",
			"Restore skillbox/lock.json before adding to a managed workspace.",
		);
	if (!config && lock)
		throw responseError(
			"CONFIG_MISSING",
			"Restore skillbox/config.json before adding to a managed workspace.",
		);
	const next = withContribution(
		config ?? { sources: [], install: [] },
		contribution,
		input.install,
	);
	const candidate = await input.bundles.resolvePins(workspace, next, lock ?? emptyLock());
	const result = await reconcile(input.bundles, workspace, next, candidate, true);
	return {
		status: result.status === "unchanged" ? "unchanged" : "added",
		bundle: contribution.id,
		skills: Object.values((await readLock(workspace))!.bundles[contribution.id]!.members)
			.length,
		installed: result.installed,
	};
}
