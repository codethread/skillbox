import { expect } from "bun:test";
import {
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	readlink,
	realpath,
	lstat,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
export interface Outcome {
	exitCode: number;
	response: {
		success: boolean;
		data: Record<string, any>;
		errors: { code: string; message: string }[];
	};
}
export async function fixture() {
	const root = await realpath(await mkdtemp(join(tmpdir(), "skillbox-compose-")));
	const client = join(root, "client");
	const cache = join(root, "cache");
	await mkdir(client);
	return { root, client, cache };
}
export async function run(cwd: string, cache: string, ...args: string[]): Promise<Outcome> {
	const child = Bun.spawn([process.execPath, cli, ...args], {
		cwd,
		env: { ...process.env, SKILLBOX_CACHE_DIR: cache, NO_COLOR: "1", DO_NOT_TRACK: "1" },
		stdout: "pipe",
		stderr: "pipe",
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	expect(stderr).toBe("");
	return { exitCode, response: JSON.parse(stdout) };
}
export function success(result: Outcome): Record<string, any> {
	expect(result.response.errors).toEqual([]);
	expect(result.exitCode).toBe(0);
	expect(result.response.success).toBe(true);
	return result.response.data;
}
export function failure(result: Outcome, code: string) {
	expect(result.exitCode).not.toBe(0);
	expect(result.response.success).toBe(false);
	expect(result.response.errors.map((error) => error.code)).toContain(code);
	return result.response.data;
}
export async function put(root: string, path: string, content: string | Uint8Array) {
	await mkdir(dirname(join(root, path)), { recursive: true });
	await writeFile(join(root, path), content);
}
export function skill(name: string, body = "original content") {
	return `---\nname: ${name}\ndescription: A test skill.\n---\n\n${body}\n`;
}
export async function json(path: string) {
	return JSON.parse(await readFile(path, "utf8"));
}
export async function git(cwd: string, ...args: string[]) {
	const child = Bun.spawn(["git", ...args], {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
		env: {
			...process.env,
			GIT_AUTHOR_NAME: "Test",
			GIT_AUTHOR_EMAIL: "test@example.com",
			GIT_COMMITTER_NAME: "Test",
			GIT_COMMITTER_EMAIL: "test@example.com",
		},
	});
	const [exit, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	if (exit) throw new Error(stderr);
	return stdout.trim();
}
export async function commit(root: string) {
	await git(root, "add", "--all");
	await git(root, "commit", "--quiet", "--allow-empty", "-m", "test");
	return git(root, "rev-parse", "HEAD");
}
export async function repository(root: string) {
	await mkdir(root, { recursive: true });
	await git(root, "init", "--quiet");
	return pathToFileURL(root).href;
}
export async function snapshot(root: string): Promise<Record<string, unknown>> {
	const result: Record<string, unknown> = {};
	for (const entry of await readdir(root, { withFileTypes: true })) {
		if (entry.name === ".git" || entry.name === ".prepare") continue;
		const path = join(root, entry.name);
		result[entry.name] = entry.isSymbolicLink()
			? { link: await readlink(path) }
			: entry.isDirectory()
				? await snapshot(path)
				: {
						bytes: (await readFile(path)).toString("hex"),
						mode: (await lstat(path)).mode & 0o777,
					};
	}
	return result;
}
