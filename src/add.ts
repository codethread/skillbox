import { lstat, mkdir, mkdtemp, rename, rm, symlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { installSkills, resolveSource } from "skills";
import { isMatching } from "ts-pattern";
import { z } from "zod";

const inputSchema = z.object({
	cwd: z.string().min(1),
	source: z.string().min(1),
	bundles: z
		.array(
			z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/, {
				error: "Bundle names must be single directory names (letters, numbers, hyphens or underscores).",
			}),
		)
		.min(1),
});

async function requireAbsent(cwd: string, path: string) {
	try {
		await lstat(join(cwd, path));
	} catch (error) {
		if (isMatching({ code: "ENOENT" }, error)) return;
		throw error;
	}
	throw new Error(`Existing ${path}; migration is not implemented yet. No skills were changed.`);
}

export async function add(input: z.input<typeof inputSchema>) {
	const { cwd, source, bundles: requested } = inputSchema.parse(input);
	const bundles = [...new Set(requested)];
	await requireAbsent(cwd, ".agents/skills");
	await requireAbsent(cwd, ".claude/skills");

	const handle = await resolveSource(join(resolve(cwd, source), "skillbox"), {
		cwd,
		fullDepth: true,
		onWarning: (warning) => {
			throw warning;
		},
	});
	try {
		const skills = handle.skills.filter((skill) =>
			bundles.some((bundle) => skill.path?.startsWith(`${bundle}/`)),
		);
		const missing = bundles.filter(
			(bundle) => !skills.some((skill) => skill.path?.startsWith(`${bundle}/`)),
		);
		if (missing.length > 0)
			throw new Error(`No skills found in bundles: ${missing.join(", ")}.`);

		const staging = await mkdtemp(join(cwd, ".skillbox-add-"));
		try {
			const result = await installSkills(handle, {
				cwd: staging,
				skills: skills.map((skill) => skill.name),
				agents: ["universal"],
				mode: "copy",
				lockfile: false,
				telemetry: false,
				duplicates: "error",
				symlinks: "reject",
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

			await mkdir(join(cwd, ".agents"), { recursive: true });
			await mkdir(join(cwd, ".claude"), { recursive: true });
			const installed = join(cwd, ".agents/skills");
			const staged = join(staging, ".agents/skills");
			await rename(staged, installed);
			try {
				await symlink("../.agents/skills", join(cwd, ".claude/skills"));
			} catch (error) {
				await rename(installed, staged);
				throw error;
			}
			return skills.map((skill) => skill.name).sort();
		} finally {
			await rm(staging, { recursive: true, force: true });
		}
	} finally {
		await handle.dispose();
	}
}
