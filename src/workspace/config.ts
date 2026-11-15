import { join } from "node:path";
import { z } from "zod";
import { match, P } from "ts-pattern";
import { readOptional } from "./paths.ts";
import { ResponseError } from "../response.ts";

export const configPath = "skillbox/config.json";
export const bundleSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/, {
	error: "Bundle names must be single directory names (letters, numbers, hyphens or underscores).",
});

const bundleSelectionSchema = z.union([
	bundleSchema,
	z.strictObject({
		bundle: bundleSchema,
		skills: z.array(z.string().min(1)).min(1),
	}),
]);

const configSchema = z.strictObject({
	sources: z.array(
		z.strictObject({
			source: z.string().min(1),
			bundles: z.array(bundleSelectionSchema).min(1),
		}),
	),
});

export type BundleSelection = z.infer<typeof bundleSelectionSchema>;
export type Config = z.infer<typeof configSchema>;

export function bundleName(selection: BundleSelection): string {
	return match(selection)
		.with(P.string, (bundle) => bundle)
		.with({ bundle: P.string }, ({ bundle }) => bundle)
		.exhaustive();
}

export function selectBundleSkills<Member extends { name: string }>(
	selection: BundleSelection,
	members: readonly Member[],
	source: string,
): readonly Member[] {
	return match(selection)
		.with(P.string, () => members)
		.with({ bundle: P.string }, ({ bundle, skills }) => {
			const requested = new Set(skills);
			const available = new Set(members.map((member) => member.name));
			const missing = [...requested].filter((name) => !available.has(name));
			if (missing.length)
				throw new ResponseError(
					missing.map((skill) => ({
						code: "SKILL_NOT_FOUND",
						message: `No skill named ${skill} in bundle: ${bundle}.`,
						source,
						input: bundle,
						skill,
					})),
				);
			return members.filter((member) => requested.has(member.name));
		})
		.exhaustive();
}

export async function readConfig(cwd: string) {
	const text = await readOptional(join(cwd, configPath));
	if (text === undefined) return undefined;
	try {
		return configSchema.parse(JSON.parse(text));
	} catch (cause) {
		throw new Error(`Invalid ${configPath}. Fix it before adding skills.`, { cause });
	}
}

export function withBundles(config: Config, source: string, bundles: string[]): Config {
	const current = config.sources.find((entry) => entry.source === source);
	if (!current) return { sources: [...config.sources, { source, bundles: [...bundles].sort() }] };
	return {
		sources: config.sources.map((entry) =>
			entry === current
				? {
						source,
						bundles: [
							...entry.bundles,
							...bundles.filter(
								(bundle) =>
									!entry.bundles.some(
										(selection) => bundleName(selection) === bundle,
									),
							),
						].sort((left, right) => bundleName(left).localeCompare(bundleName(right))),
					}
				: entry,
		),
	};
}
