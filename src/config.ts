import { join } from "node:path";
import { z } from "zod";
import { readOptional } from "./paths.ts";

export const defaultConfigPath = "skillbox/config.json";
export const bundleSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/, {
	error: "Bundle names must be single directory names (letters, numbers, hyphens or underscores).",
});

const configSchema = z.strictObject({
	sources: z.array(
		z.strictObject({
			source: z.string().min(1),
			bundles: z.array(bundleSchema).min(1),
		}),
	),
});

export type Config = z.infer<typeof configSchema>;

export async function readConfig(cwd: string, configPath: string) {
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
				? { source, bundles: [...new Set([...entry.bundles, ...bundles])].sort() }
				: entry,
		),
	};
}
