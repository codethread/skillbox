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
import { dirname, isAbsolute, join, resolve } from "node:path";
import { installSkills, resolveSource, type SkillInfo, type SkillsConfig } from "skills";
import { z } from "zod";
import { bundleSchema, configPath, readConfig, withBundles } from "./config.ts";
import { lockPath, readLock, relocateLock } from "./lock.ts";
import { localPath, readOptional, statOptional } from "./paths.ts";
import { publish } from "./publish.ts";

const inputSchema = z.object({
	cwd: z.string().min(1),
	source: z.string().min(1),
	bundles: z.array(bundleSchema).default([]),
	config: z.string().min(1).default("."),
});

const sdkConfig = {
	scope: "project",
	mode: "copy",
	lockfile: true,
	telemetry: false,
	duplicates: "error",
	symlinks: "reject",
	agents: { include: ["universal"], default: ["universal"] },
} satisfies SkillsConfig;

async function requireAbsent(cwd: string, path: string) {
	if (await statOptional(join(cwd, path))) {
		throw new Error(
			`Existing ${path}; migration is not implemented yet. No skills were changed.`,
		);
	}
}

function inBundle(skill: SkillInfo, bundle: string, local: boolean) {
	const prefix = `${local ? "" : "skillbox/"}${bundle}/`;
	return [skill.path, ...(skill.duplicates ?? [])].some((path) => path?.startsWith(prefix));
}

export async function add(input: z.input<typeof inputSchema>) {
	const parsed = inputSchema.parse(input);
	const cwd = await realpath(resolve(parsed.cwd, parsed.config));
	const local = isAbsolute(parsed.source) || parsed.source.startsWith(".");
	const source = local
		? localPath(cwd, await realpath(resolve(parsed.cwd, parsed.source)))
		: parsed.source;
	const config = await readConfig(cwd);
	const lockText = await readOptional(join(cwd, lockPath));
	const lock = lockText === undefined ? undefined : readLock(lockText);
	if (!config) {
		await requireAbsent(cwd, ".agents/skills");
		await requireAbsent(cwd, ".claude/skills");
		await requireAbsent(cwd, lockPath);
	} else {
		if (!lock) throw new Error(`Missing ${lockPath}; cannot add to a managed installation.`);
		const tracked = lock.skills;
		const directory = await statOptional(join(cwd, ".agents/skills"));
		if (!directory?.isDirectory()) {
			throw new Error(
				"Managed .agents/skills must be a real directory. Restore it before adding skills.",
			);
		}
		for (const name of await readdir(join(cwd, ".agents/skills"))) {
			if (!Object.hasOwn(tracked, name)) {
				throw new Error(
					`Unmanaged skill: ${name}; migration is not implemented yet. No skills were changed.`,
				);
			}
		}
		const link = join(cwd, ".claude/skills");
		if (await statOptional(link)) {
			if (resolve(dirname(link), await readlink(link)) !== join(cwd, ".agents/skills")) {
				throw new Error(
					"Existing .claude/skills does not link to .agents/skills. No skills were changed.",
				);
			}
		}
	}

	const handle = await resolveSource(local ? join(cwd, source, "skillbox") : source, {
		cwd,
		config: sdkConfig,
		fullDepth: true,
		onWarning: (warning) => {
			throw warning;
		},
	});
	try {
		const inferred = /^skillbox\/([^/]+)\/?$/.exec(handle.source.subpath ?? "")?.[1];
		const requested = [
			...new Set(
				parsed.bundles.length > 0
					? parsed.bundles
					: inferred
						? [bundleSchema.parse(inferred)]
						: [],
			),
		];
		if (requested.length === 0) {
			throw new Error("Specify bundle names, or use a URL pointing to skillbox/<bundle>.");
		}
		const current = config ?? { sources: [] };
		const existing = current.sources.find((entry) => entry.source === source);
		const bundles = requested.filter((bundle) => !existing?.bundles.includes(bundle));
		if (bundles.length === 0) return { skills: [], bundles: requested };
		const next = withBundles(current, source, bundles);

		const skills = handle.skills.filter((skill) =>
			bundles.some((bundle) => inBundle(skill, bundle, local)),
		);
		const missing = bundles.filter(
			(bundle) => !skills.some((skill) => inBundle(skill, bundle, local)),
		);
		if (missing.length > 0)
			throw new Error(`No skills found in bundles: ${missing.join(", ")}.`);

		for (const skill of skills) {
			if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill.name)) {
				throw new Error(`Skill names must be lowercase kebab-case: ${skill.name}.`);
			}
			if (
				(lock && Object.hasOwn(lock.skills, skill.name)) ||
				(await statOptional(join(cwd, ".agents/skills", skill.name)))
			) {
				throw new Error(`Skill name collision: ${skill.name}. No skills were changed.`);
			}
		}

		const staging = await mkdtemp(join(cwd, ".skillbox-add-"));
		let retainStaging = false;
		try {
			if (lockText !== undefined) {
				await mkdir(join(staging, ".agents"));
				await cp(join(cwd, ".agents/skills"), join(staging, ".agents/skills"), {
					recursive: true,
				});
				await writeFile(join(staging, lockPath), relocateLock(lockText, cwd, staging));
			}
			const result = await installSkills(handle, {
				cwd: staging,
				config: sdkConfig,
				skills: skills.map((skill) => skill.name),
				onWarning: (warning) => {
					throw warning;
				},
			});
			if (result.failed.length > 0) {
				throw new Error(result.failed.map((failure) => failure.message).join("\n"));
			}
			if (result.skipped.length > 0 || result.installed.length !== skills.length) {
				throw new Error(
					"The library did not install every selected skill. No skills were changed.",
				);
			}

			await mkdir(dirname(join(staging, configPath)), { recursive: true });
			await writeFile(join(staging, configPath), `${JSON.stringify(next, null, 2)}\n`);
			await writeFile(
				join(staging, lockPath),
				relocateLock(await readFile(join(staging, lockPath), "utf8"), staging, cwd),
			);
			await mkdir(join(staging, ".claude"));
			await symlink("../.agents/skills", join(staging, ".claude/skills"));
			try {
				await publish(staging, cwd);
			} catch (cause) {
				retainStaging = true;
				throw new Error(
					`Could not publish installation: ${cause instanceof Error ? cause.message : String(cause)} Recovery files retained at ${staging}.`,
					{ cause },
				);
			}
			return { skills: skills.map((skill) => skill.name).sort(), bundles };
		} finally {
			if (!retainStaging) await rm(staging, { recursive: true, force: true });
		}
	} finally {
		await handle.dispose();
	}
}
