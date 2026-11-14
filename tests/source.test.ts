import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const temporary: string[] = [];

interface Repository {
	author: string;
	remote: string;
	revision: string;
}

afterEach(async () => {
	await Promise.all(
		temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })),
	);
});

test("an explicit native GitLab tree URL keeps the SDK source interpretation", async () => {
	const root = await mkdtemp(join(tmpdir(), "skillbox-source-"));
	temporary.push(root);
	const author = join(root, "author");
	const remote = join(root, "remote.git");
	const client = join(root, "client");
	await mkdir(author);
	await mkdir(client);
	await git(root, "init", "--bare", remote);
	await git(author, "init", "--initial-branch=main");
	await git(author, "config", "user.email", "source-test@example.com");
	await git(author, "config", "user.name", "Source Test");
	await put(
		author,
		"skillbox/dev/gitlab-native/SKILL.md",
		"---\nname: gitlab-native\ndescription: Native GitLab fixture.\n---\n\n# GitLab native\n",
	);
	await git(author, "add", ".");
	await git(author, "commit", "-m", "Add native skill");
	await git(author, "remote", "add", "origin", remote);
	await git(author, "push", "origin", "main");

	const gitConfig = join(root, "gitconfig");
	await git(
		root,
		"config",
		"--file",
		gitConfig,
		`url.${pathToFileURL(remote).href}.insteadOf`,
		"https://gitlab.com/group/repo.git",
	);
	const env = {
		...process.env,
		DO_NOT_TRACK: "1",
		GIT_CONFIG_GLOBAL: gitConfig,
		GIT_CONFIG_NOSYSTEM: "1",
		NO_COLOR: "1",
		SKILLBOX_CACHE_DIR: join(root, "cache"),
	};
	const source = "https://gitlab.com/group/repo/-/tree/main/skillbox/dev";
	const added = await run(client, env, "add", source, "dev");
	expect(added.exitCode).toBe(0);
	expect(added.stderr).toBe("");
	expect(JSON.parse(added.stdout)).toMatchObject({
		success: true,
		data: { status: "added", bundles: ["dev"], installed: 1 },
	});
	expect(await readFile(join(client, ".agents/skills/gitlab-native/SKILL.md"), "utf8")).toContain(
		"# GitLab native",
	);
	expect(await exists(join(client, "skillbox/patches/dev"))).toBe(false);

	const synced = await run(client, env, "sync");
	expect(synced.exitCode).toBe(0);
	expect(JSON.parse(synced.stdout)).toMatchObject({
		success: true,
		data: { status: "unchanged", unchanged: 1 },
	});

	const missingClient = join(root, "missing-client");
	await mkdir(missingClient);
	const unavailable = await run(
		missingClient,
		env,
		"add",
		"https://gitlab.com/group/repo/-/tree/missing/skillbox/dev",
		"dev",
	);
	expect(unavailable.exitCode).not.toBe(0);
	expect(JSON.parse(unavailable.stdout).errors[0].code).toStartWith("SKILLS_");
});

test("a zero-native-skill GitLab producer uses the explicit adapted-source fallback", async () => {
	const root = await mkdtemp(join(tmpdir(), "skillbox-source-patches-"));
	temporary.push(root);
	const upstream = await repository(root, "upstream");
	await put(
		upstream.author,
		"plugin/skills/patch-only/SKILL.md",
		"---\nname: patch-only\ndescription: Adapted-only fixture.\n---\n\n# Patch only\n",
	);
	await commitAndPush(upstream, "Add upstream skill");

	const producer = await repository(root, "producer");
	const producerCache = join(root, "producer-cache");
	const initialized = await run(
		producer.author,
		{ ...process.env, DO_NOT_TRACK: "1", NO_COLOR: "1", SKILLBOX_CACHE_DIR: producerCache },
		"patch",
		"init",
		"pstack",
		"--source",
		pathToFileURL(upstream.remote).href,
		"--root",
		"plugin",
		"--skills-root",
		"skills",
		"--ref",
		upstream.revision,
	);
	expect(initialized.exitCode).toBe(0);
	await git(producer.author, "add", "skillbox");
	await git(producer.author, "commit", "-m", "Export adapted bundle");
	await git(producer.author, "push", "origin", "main");

	const client = join(root, "client");
	await mkdir(client);
	const gitConfig = join(root, "gitconfig");
	await git(
		root,
		"config",
		"--file",
		gitConfig,
		`url.${pathToFileURL(producer.remote).href}.insteadOf`,
		"https://gitlab.com/group/patches.git",
	);
	const env = {
		...process.env,
		DO_NOT_TRACK: "1",
		GIT_CONFIG_GLOBAL: gitConfig,
		GIT_CONFIG_NOSYSTEM: "1",
		NO_COLOR: "1",
		SKILLBOX_CACHE_DIR: join(root, "consumer-cache"),
	};
	const source = "https://gitlab.com/group/patches/-/tree/main";
	const added = await run(client, env, "add", source, "pstack");
	expect(added.exitCode).toBe(0);
	expect(added.stderr).toBe("");
	expect(JSON.parse(added.stdout)).toMatchObject({
		success: true,
		data: { status: "added", bundles: ["pstack"], installed: 1 },
	});
	expect(await readFile(join(client, ".agents/skills/patch-only/SKILL.md"), "utf8")).toContain(
		"# Patch only",
	);
	const descriptor = await readFile(join(client, "skillbox/patches/pstack/bundle.toml"), "utf8");
	expect(descriptor).toContain('repository = "https://gitlab.com/group/patches.git"');

	await rm(join(client, ".agents"), { recursive: true, force: true });
	await rm(join(client, ".claude"), { recursive: true, force: true });
	const restored = await run(
		client,
		{ ...env, SKILLBOX_CACHE_DIR: join(root, "restore-cache") },
		"sync",
	);
	expect(restored.exitCode).toBe(0);
	expect(JSON.parse(restored.stdout)).toMatchObject({
		success: true,
		data: { status: "synced", installed: 1 },
	});
});

async function repository(root: string, name: string): Promise<Repository> {
	const author = join(root, `${name}-author`);
	const remote = join(root, `${name}.git`);
	await mkdir(author);
	await git(root, "init", "--bare", remote);
	await git(author, "init", "--initial-branch=main");
	await git(author, "config", "user.email", "source-test@example.com");
	await git(author, "config", "user.name", "Source Test");
	await git(author, "remote", "add", "origin", remote);
	return { author, remote, revision: "" };
}

async function commitAndPush(repository: Repository, message: string): Promise<void> {
	await git(repository.author, "add", ".");
	await git(repository.author, "commit", "-m", message);
	await git(repository.author, "push", "origin", "main");
	repository.revision = await gitOutput(repository.author, "rev-parse", "HEAD");
}

async function run(cwd: string, env: Record<string, string | undefined>, ...args: string[]) {
	const child = Bun.spawn([process.execPath, cli, ...args], {
		cwd,
		env,
		stdout: "pipe",
		stderr: "pipe",
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	return { exitCode, stdout, stderr };
}

async function git(cwd: string, ...args: string[]): Promise<void> {
	await gitOutput(cwd, ...args);
}

async function gitOutput(cwd: string, ...args: string[]): Promise<string> {
	const child = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	if (exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${stderr}`);
	return stdout.trim();
}

async function put(root: string, path: string, body: string): Promise<void> {
	const target = join(root, path);
	await mkdir(dirname(target), { recursive: true });
	await writeFile(target, body);
}

async function exists(path: string): Promise<boolean> {
	return Bun.file(path).exists();
}
