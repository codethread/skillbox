import { isAbsolute, join, resolve } from "node:path";
import { realpath } from "node:fs/promises";
import { resolveSource, type SkillInfo, type SkillsConfig, type SkillSource } from "skills";
import { z } from "zod";
import { bundleSchema } from "./config.ts";
import { localPath } from "./paths.ts";
import { ResponseError, responseError } from "../response.ts";

// The SDK hardcodes this filename; use it only inside disposable staging directories.
export const sdkLockPath = "skills-lock.json";

const inputSchema = z.object({
	source: z.string().min(1),
	bundles: z.array(bundleSchema),
	cwd: z.string().min(1),
	workspace: z.string().min(1),
});

export const sdkConfig = {
	scope: "project",
	mode: "copy",
	lockfile: true,
	telemetry: false,
	duplicates: "error",
	symlinks: "reject",
	agents: { include: ["universal"], default: ["universal"] },
} satisfies SkillsConfig;

export type RepositorySourceInspection =
	| { kind: "repository"; repository: string; ref: string }
	| { kind: "other" }
	| { kind: "empty" };

/** Use the SDK's public source parser/fetcher as the first source interpretation. */
export async function inspectRepositorySource(
	source: string,
	cwd: string,
): Promise<RepositorySourceInspection> {
	let handle: SkillSource;
	try {
		handle = await resolveSource(source, {
			cwd,
			config: sdkConfig,
			fullDepth: true,
			onWarning: (warning) => {
				throw warning;
			},
		});
	} catch (cause) {
		if (isSdkDiagnostic(cause) && cause.code === "SKILLS_NO_VALID_SKILLS")
			return { kind: "empty" };
		throw cause;
	}
	try {
		if (!["github", "gitlab", "git"].includes(handle.source.type)) return { kind: "other" };
		return {
			kind: "repository",
			repository: handle.source.url,
			ref: handle.source.ref ?? "HEAD",
		};
	} finally {
		await handle.dispose();
	}
}

export async function resolveBundleSource(input: {
	source: string;
	bundles: readonly string[];
	cwd: string;
	workspace: string;
}): Promise<{
	source: string;
	bundles: string[];
	handle: SkillSource;
	skills: readonly SkillInfo[];
}> {
	const parsed = inputSchema.parse(input);
	const local = isAbsolute(parsed.source) || parsed.source.startsWith(".");
	let source = parsed.source;
	if (local) {
		try {
			source = localPath(
				parsed.workspace,
				await realpath(resolve(parsed.cwd, parsed.source)),
			);
		} catch (cause) {
			throw responseError(
				"SOURCE_NOT_FOUND",
				`Local source does not exist: ${parsed.source}`,
				{ source: parsed.source },
				cause,
			);
		}
	}

	let handle: SkillSource;
	try {
		handle = await resolveSource(local ? join(parsed.workspace, source, "skillbox") : source, {
			cwd: parsed.workspace,
			config: sdkConfig,
			fullDepth: true,
			onWarning: (warning) => {
				throw warning;
			},
		});
	} catch (cause) {
		if (cause instanceof ResponseError) throw cause;
		if (isSdkDiagnostic(cause)) {
			throw responseError(cause.code, cause.message, { source }, cause);
		}
		throw responseError("SOURCE_RESOLUTION_FAILED", errorMessage(cause), { source }, cause);
	}

	try {
		const inferred = /^skillbox\/([^/]+)\/?$/.exec(handle.source.subpath ?? "")?.[1];
		const bundles = [
			...new Set(
				parsed.bundles.length > 0
					? parsed.bundles
					: inferred
						? [bundleSchema.parse(inferred)]
						: [],
			),
		];
		if (bundles.length === 0) {
			throw responseError(
				"BUNDLE_REQUIRED",
				"Specify bundle names, or use a URL pointing to skillbox/<bundle>.",
				{ source },
			);
		}

		const skills = handle.skills.filter((skill) =>
			bundles.some((bundle) => inBundle(skill, bundle, local)),
		);
		const missing = bundles.filter(
			(bundle) => !skills.some((skill) => inBundle(skill, bundle, local)),
		);
		if (missing.length > 0) {
			throw new ResponseError(
				missing.map((bundle) => ({
					code: "BUNDLE_NOT_FOUND",
					message: `No skills found in bundle: ${bundle}.`,
					source,
					input: bundle,
				})),
			);
		}

		for (const skill of skills) {
			if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill.name)) {
				throw responseError(
					"INVALID_SKILL_NAME",
					`Skill names must be lowercase kebab-case: ${skill.name}.`,
					{ source, skill: skill.name },
				);
			}
		}
		return { source, bundles, handle, skills };
	} catch (error) {
		await handle.dispose();
		throw error;
	}
}

function inBundle(skill: SkillInfo, bundle: string, local: boolean): boolean {
	const prefix = `${local ? "" : "skillbox/"}${bundle}/`;
	return [skill.path, ...(skill.duplicates ?? [])].some((path) => path?.startsWith(prefix));
}

interface SdkDiagnostic {
	code: string;
	message: string;
}

function isSdkDiagnostic(error: unknown): error is SdkDiagnostic {
	return (
		error instanceof Error &&
		"code" in error &&
		typeof error.code === "string" &&
		error.code.startsWith("SKILLS_")
	);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
