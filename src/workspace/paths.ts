import { lstat, readFile } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { isMatching } from "ts-pattern";
import { responseError } from "../response.ts";

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

export async function regularPath(root: string, path: string): Promise<string> {
	let current = root;
	for (const part of path.split("/")) {
		if (part === ".") continue;
		current = join(current, part);
		const entry = await statOptional(current);
		if (entry?.isSymbolicLink())
			throw responseError(
				"SOURCE_PATH_UNSAFE",
				`Paths cannot traverse symlinks: ${current}.`,
				{ input: current },
			);
		if (!entry) break;
	}
	return join(root, path);
}
