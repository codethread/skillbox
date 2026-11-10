import { lstat, readFile } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";
import { isMatching } from "ts-pattern";

export function localPath(from: string, to: string) {
	const path = relative(from, to).split(sep).join("/");
	if (!path) return ".";
	if (isAbsolute(path) || path === ".." || path.startsWith("../")) return path;
	return `./${path}`;
}

export async function readOptional(path: string) {
	try {
		return await readFile(path, "utf8");
	} catch (error) {
		if (isMatching({ code: "ENOENT" }, error)) return undefined;
		throw error;
	}
}

export async function statOptional(path: string) {
	try {
		return await lstat(path);
	} catch (error) {
		if (isMatching({ code: "ENOENT" }, error)) return undefined;
		throw error;
	}
}
