import { resolve } from "node:path";
import { z } from "zod";
import { localPath } from "./paths.ts";

export const lockPath = "skillbox/lock.json";

// Retain SDK-owned fields, including fields added by upstream.
const lockSchema = z.looseObject({
	version: z.literal(1),
	skills: z.record(
		z.string(),
		z.looseObject({
			source: z.string(),
			sourceType: z.string(),
			computedHash: z.string(),
		}),
	),
});

export function readLock(text: string) {
	try {
		return lockSchema.parse(JSON.parse(text));
	} catch (cause) {
		throw new Error(`Invalid ${lockPath}. Fix it before adding skills.`, { cause });
	}
}

// The SDK writes local sources relative to its cwd. Moving a staged lock must
// preserve those targets; hashes, ordering, and every other field stay SDK-owned.
export function relocateLock(text: string, from: string, to: string) {
	const lock = readLock(text);
	for (const entry of Object.values(lock.skills)) {
		if (entry.sourceType === "local") {
			entry.source = localPath(to, resolve(from, entry.source));
		}
	}
	return `${JSON.stringify(lock, null, 2)}\n`;
}
