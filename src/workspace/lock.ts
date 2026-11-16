import { join } from "node:path";
import { z } from "zod";
import { contributionSchema, relativePathSchema, bundleSchema } from "./config.ts";
import { readOptional } from "./paths.ts";
import { responseError } from "../response.ts";

export const lockPath = "skillbox/lock.json";
export const pinSchema = z.discriminatedUnion("type", [
	z.strictObject({
		type: z.literal("git"),
		revision: z.string().regex(/^[0-9a-f]{40}$/),
		tree: z.string().regex(/^[0-9a-f]{40}$/),
	}),
	z.strictObject({ type: z.literal("local") }),
]);
export type Pin = z.infer<typeof pinSchema>;
export const memberSchema = z.strictObject({
	name: bundleSchema,
	directory: bundleSchema,
	source: z.string(),
	path: relativePathSchema,
	revision: z.string().optional(),
});
export type Member = z.infer<typeof memberSchema>;
export const lockSchema = z.strictObject({
	version: z.literal(2),
	sources: z.record(
		z.string(),
		z.strictObject({ contribution: contributionSchema, pin: pinSchema }),
	),
	bundles: z.record(
		bundleSchema,
		z.strictObject({ members: z.array(memberSchema), sourceHash: z.string() }),
	),
	installed: z.record(
		bundleSchema,
		z.strictObject({ bundle: bundleSchema, directory: bundleSchema, hash: z.string() }),
	),
});
export type Lock = z.infer<typeof lockSchema>;
export function emptyLock(): Lock {
	return { version: 2, sources: {}, bundles: {}, installed: {} };
}
export async function readLock(root: string, path: string): Promise<Lock | undefined> {
	const text = await readOptional(join(root, path));
	if (text === undefined) return undefined;
	try {
		return lockSchema.parse(JSON.parse(text));
	} catch (cause) {
		throw responseError("LOCK_INVALID", `Invalid ${path}.`, { input: path }, cause);
	}
}
export function jsonText(value: unknown): string {
	return JSON.stringify(value, null, 2) + "\n";
}
