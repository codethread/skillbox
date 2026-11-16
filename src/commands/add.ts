import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { responseError } from "../response.ts";
import { isLocalSource, type Bundles } from "../workspace/bundles.ts";
import { contributionIdentity, contributionSchema, withContribution } from "../workspace/config.ts";
import { emptyLock, readLock } from "../workspace/lock.ts";
import { localPath } from "../workspace/paths.ts";
import { selectWorkspace } from "../workspace/context.ts";
import { installationState, reconcile } from "./sync.ts";

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
	const context = await selectWorkspace(workspace);
	const { config, lock, paths } = context;
	const receipt = await installationState(context);
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
	if (paths.kind === "shared" && config?.sources.length && !lock)
		throw responseError(
			"LOCK_MISSING",
			`Restore ${paths.lock} before adding to a managed workspace.`,
			{ input: paths.lock },
		);
	if (!config && lock)
		throw responseError(
			"CONFIG_MISSING",
			`Restore ${paths.config} before adding to a managed workspace.`,
			{ input: paths.config },
		);
	const next = withContribution(
		config ?? { sources: [], install: [] },
		contribution,
		input.install,
	);
	const candidate = await input.bundles.resolvePins({
		...context,
		config: next,
		lock: lock ?? emptyLock(),
	});
	const result = await reconcile(input.bundles, {
		context,
		config: next,
		candidate,
		receipt,
		writeConfig: true,
	});
	return {
		status: result.status === "unchanged" ? "unchanged" : "added",
		bundle: contribution.id,
		config: paths.config,
		skills: Object.values(
			(await readLock(workspace, paths.lock))!.bundles[contribution.id]!.members,
		).length,
		installed: result.installed,
	};
}
