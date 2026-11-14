import { afterEach, expect, test } from "bun:test";
import {
	chmod,
	lstat,
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	readlink,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const temporary: string[] = [];
const reason = "Prefer interfaces because this project extends shared contracts.";

interface Fixture {
	root: string;
	client: string;
	source: string;
	cache: string;
	revision: string;
}

interface Outcome {
	exitCode: number;
	stderr: string;
	response: {
		success: boolean;
		data: Record<string, unknown> | null;
		errors: { code: string; message: string }[];
	};
}

afterEach(async () => {
	await Promise.all(
		temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })),
	);
});

test("imports a named plugin bundle beside native skills and records exact source provenance", async () => {
	const f = await fixture();
	await put(f.source, "skillbox/native/owned/SKILL.md", skill("owned", "An owned native skill."));
	expectSuccess(await run(f, "add", f.source, "native"));
	const original = await json(join(f.client, "skillbox/lock.json"));
	const nativeText = await readFile(join(f.client, ".agents/skills/owned/SKILL.md"), "utf8");

	expectSuccess(await initialize(f));
	expect((await readdir(join(f.client, ".agents/skills"))).sort()).toEqual([
		"alpha",
		"beta",
		"owned",
	]);
	expect(
		await readFile(join(f.client, ".agents/skills/alpha/references/choice.md"), "utf8"),
	).toBe(await readFile(join(f.source, "plugin/skills/alpha/references/choice.md"), "utf8"));
	expect((await lstat(join(f.client, ".agents/skills/alpha/scripts/run.sh"))).mode & 0o111).toBe(
		0o111,
	);
	expect(await readlink(join(f.client, ".claude/skills"))).toBe("../.agents/skills");
	const lock = await json(join(f.client, "skillbox/patches/pstack/lock.json"));
	expect(lock.revision).toBe(f.revision);
	expect(lock.source).toBe(pathToFileURL(f.source).href);
	expect(lock.root).toBe("plugin");
	expectSuccess(await run(f, "sync"));
	const current = await json(join(f.client, "skillbox/lock.json"));
	expect(current.skills.owned).toEqual(original.skills.owned);
	expect(await readFile(join(f.client, ".agents/skills/owned/SKILL.md"), "utf8")).toBe(
		nativeText,
	);
	expect(current.version).toBe(1);
	expect(current.skills.alpha.skillPath).toBe("plugin/skills/alpha/SKILL.md");
	expect(await exists(join(f.client, ".agents/skills/agents"))).toBe(false);
	expect(await exists(join(f.client, ".agents/skills/hooks"))).toBe(false);
});

test("captures nested edits, additions, deletions, binary changes and modes, then restores offline", async () => {
	const f = await fixture();
	expectSuccess(await initialize(f));
	const prepared = expectSuccess(
		await run(f, "patch", "prepare", "pstack", "--output", join(f.root, "edit")),
	);
	const edited = requiredPath(prepared, "editable");
	const workspace = requiredPath(prepared, "workspace");
	await put(
		edited,
		"skills/alpha/references/choice.md",
		"Use interfaces for project contracts.\n",
	);
	await put(
		edited,
		"skills/alpha/references/nested/local.md",
		"Keep the reason alongside the patch.\n",
	);
	await rm(join(edited, "skills/alpha/references/obsolete.md"));
	await writeFile(
		join(edited, "skills/alpha/references/sample.bin"),
		Buffer.from([0, 255, 3, 9, 0]),
	);
	await chmod(join(edited, "skills/alpha/scripts/run.sh"), 0o644);
	expectSuccess(
		await run(f, "patch", "capture", "pstack", "--from", workspace, "--intent", reason),
	);

	const manifest = await readFile(
		join(f.client, "skillbox/patches/pstack/alpha/patch.toml"),
		"utf8",
	);
	expect(manifest).toContain(reason);
	expect(manifest).toContain(f.revision);
	for (const target of [
		"./references/choice.md",
		"./references/nested/local.md",
		"./references/obsolete.md",
		"./references/sample.bin",
		"./scripts/run.sh",
	])
		expect(manifest).toContain(target);
	const artifacts = await files(join(f.client, "skillbox/patches/pstack/alpha"));
	expect(artifacts.filter((path) => path.endsWith(".patch")).length).toBeGreaterThanOrEqual(5);
	expectSuccess(await run(f, "sync"));
	const expected = await snapshot(join(f.client, ".agents/skills"));
	expect(await exists(join(f.client, ".agents/skills/alpha/references/obsolete.md"))).toBe(false);
	expect((await lstat(join(f.client, ".agents/skills/alpha/scripts/run.sh"))).mode & 0o111).toBe(
		0,
	);
	await rename(f.source, `${f.source}-unavailable`);
	await removeGenerated(f);
	expectSuccess(await run(f, "sync"));
	expect(await snapshot(join(f.client, ".agents/skills"))).toEqual(expected);
	const before = await projectState(f, true);
	const unchanged = expectSuccess(await run(f, "sync"));
	expect(unchanged.status).toBe("unchanged");
	expect(await projectState(f, true)).toEqual(before);
	expect(
		(await processResult(["git", "check-ignore", ".agents/skills/alpha/SKILL.md"], f.client))
			.exitCode,
	).toBe(0);
	expect(
		(
			await processResult(
				["git", "check-ignore", "skillbox/patches/pstack/alpha/patch.toml"],
				f.client,
			)
		).exitCode,
	).toBe(1);
}, 60_000);

test("keeps a moving source pinned until explicit update and preserves patch intent on clean replay", async () => {
	const f = await fixture();
	expectSuccess(await initialize(f));
	await captureChoice(f);
	const manifestPath = join(f.client, "skillbox/patches/pstack/alpha/patch.toml");
	const manifest = await readFile(manifestPath, "utf8");
	await put(
		f.source,
		"plugin/skills/beta/SKILL.md",
		skill("beta", "A newer upstream instruction."),
	);
	const next = await commit(f.source, "Change unrelated skill");
	expectSuccess(await run(f, "sync"));
	expect(await readFile(join(f.client, ".agents/skills/beta/SKILL.md"), "utf8")).not.toContain(
		"newer upstream",
	);
	expect((await json(join(f.client, "skillbox/patches/pstack/lock.json"))).revision).toBe(
		f.revision,
	);
	expectSuccess(await run(f, "update", "pstack"));
	expect((await json(join(f.client, "skillbox/patches/pstack/lock.json"))).revision).toBe(next);
	expect(await readFile(join(f.client, ".agents/skills/beta/SKILL.md"), "utf8")).toContain(
		"newer upstream",
	);
	expect(
		await readFile(join(f.client, ".agents/skills/alpha/references/choice.md"), "utf8"),
	).toContain("interfaces");
	expect(await readFile(manifestPath, "utf8")).toBe(manifest);
	expect(expectSuccess(await run(f, "sync")).status).toBe("unchanged");
	await put(
		f.source,
		"plugin/skills/beta/SKILL.md",
		skill("beta", "Another upstream instruction."),
	);
	const latest = await commit(f.source, "Advance the same update ref again");
	expectSuccess(await run(f, "update", "pstack"));
	expect((await json(join(f.client, "skillbox/patches/pstack/lock.json"))).revision).toBe(latest);
	expect(await readFile(join(f.client, ".agents/skills/beta/SKILL.md"), "utf8")).toContain(
		"Another upstream",
	);
}, 60_000);

test("publishes a new source pin and revised intent even when installed skill bytes are unchanged", async () => {
	const f = await fixture();
	expectSuccess(await initialize(f));
	await captureChoice(f);
	const installed = await snapshot(join(f.client, ".agents/skills"));
	await put(f.source, "plugin/README.md", "# Updated upstream documentation\n");
	const next = await commit(f.source, "Update source context only");
	expectSuccess(await run(f, "update", "pstack"));
	expect((await json(join(f.client, "skillbox/patches/pstack/lock.json"))).revision).toBe(next);
	expect((await json(join(f.client, "skillbox/lock.json"))).skills.alpha.ref).toBe(next);
	expect(await snapshot(join(f.client, ".agents/skills"))).toEqual(installed);
	const prepared = expectSuccess(
		await run(f, "patch", "prepare", "pstack", "--output", join(f.root, "intent")),
	);
	const revised = "Use interfaces so downstream consumers can extend these contracts.";
	expectSuccess(
		await run(
			f,
			"patch",
			"capture",
			"pstack",
			"--from",
			requiredPath(prepared, "workspace"),
			"--intent",
			revised,
		),
	);
	const manifest = await readFile(
		join(f.client, "skillbox/patches/pstack/alpha/patch.toml"),
		"utf8",
	);
	expect(manifest).toContain(revised);
	expect(manifest).toContain(reason);
	expect(manifest).toContain(f.revision);
	expect(manifest).toContain(next);
	expect(await snapshot(join(f.client, ".agents/skills"))).toEqual(installed);
	expect(expectSuccess(await run(f, "sync")).status).toBe("unchanged");
}, 60_000);

test("preserves installed state on an upstream rename and adopts regenerated edits with their original intent", async () => {
	const f = await fixture();
	expectSuccess(await initialize(f));
	await captureChoice(f);
	await rename(
		join(f.source, "plugin/skills/alpha/references/choice.md"),
		join(f.source, "plugin/skills/alpha/references/preferences.md"),
	);
	await put(
		f.source,
		"plugin/skills/alpha/references/preferences.md",
		"Upstream now prefers explicit type aliases.\n",
	);
	const next = await commit(f.source, "Rename the upstream reference");
	const before = await projectState(f);
	const conflict = await run(f, "update", "pstack", "--ref", next);
	expect(conflict.exitCode).not.toBe(0);
	expect(conflict.response.success).toBe(false);
	expect(conflict.response.errors.some((error) => error.code === "UPDATE_CONFLICT")).toBe(true);
	expect(await projectState(f)).toEqual(before);
	const data = conflict.response.data!;
	const edited = requiredPath(data, "editable");
	await put(
		edited,
		"skills/alpha/references/preferences.md",
		"Prefer interfaces for extensible project contracts.\n",
	);
	await put(
		edited,
		"skills/alpha/references/unrelated.md",
		"This new change needs its own reason.\n",
	);
	const missingIntent = await run(
		f,
		"patch",
		"adopt",
		"pstack",
		"--from",
		requiredPath(data, "workspace"),
		"--map",
		"alpha/references/choice.md=alpha/references/preferences.md",
	);
	expect(missingIntent.response.success).toBe(false);
	expect(missingIntent.response.errors.some((error) => error.code === "INTENT_REQUIRED")).toBe(
		true,
	);
	expect(await projectState(f)).toEqual(before);
	await rm(join(edited, "skills/alpha/references/unrelated.md"));
	expectSuccess(
		await run(
			f,
			"patch",
			"adopt",
			"pstack",
			"--from",
			requiredPath(data, "workspace"),
			"--map",
			"alpha/references/choice.md=alpha/references/preferences.md",
		),
	);
	expect((await json(join(f.client, "skillbox/patches/pstack/lock.json"))).revision).toBe(next);
	expect(await exists(join(f.client, ".agents/skills/alpha/references/choice.md"))).toBe(false);
	expect(
		await readFile(join(f.client, ".agents/skills/alpha/references/preferences.md"), "utf8"),
	).toContain("interfaces");
	const manifest = await readFile(
		join(f.client, "skillbox/patches/pstack/alpha/patch.toml"),
		"utf8",
	);
	expect(manifest).toContain(reason);
	expect(manifest).toContain("preferences.md");
	await removeGenerated(f);
	expectSuccess(await run(f, "sync"));
	expect(await exists(join(f.client, ".agents/skills/alpha/references/choice.md"))).toBe(false);
	expect(expectSuccess(await run(f, "sync")).status).toBe("unchanged");
}, 60_000);

test("fails a cold offline restore without changing the recorded pin or installation", async () => {
	const f = await fixture();
	expectSuccess(await initialize(f));
	await rename(f.source, `${f.source}-unavailable`);
	await rm(f.cache, { recursive: true, force: true });
	const before = await projectState(f);
	const failed = await run(f, "sync");
	expect(failed.exitCode).not.toBe(0);
	expect(failed.response.success).toBe(false);
	expect(failed.response.errors.some((error) => error.code === "PINNED_SOURCE_UNAVAILABLE")).toBe(
		true,
	);
	expect(await projectState(f)).toEqual(before);
}, 60_000);

test("rejects unrecorded artifact edits and leaves installed output intact", async () => {
	const f = await fixture();
	expectSuccess(await initialize(f));
	await captureChoice(f);
	const patchRoot = join(f.client, "skillbox/patches/pstack/alpha");
	const patch = (await files(patchRoot)).find((path) => path.endsWith(".patch"))!;
	const patchText = await readFile(join(patchRoot, patch), "utf8");
	expect(patchText).toContain("+Prefer interfaces for shared contracts.");
	await writeFile(
		join(patchRoot, patch),
		patchText.replace(
			"+Prefer interfaces for shared contracts.",
			"+Prefer concrete types instead.",
		),
	);
	const before = await projectState(f);
	const failed = await run(f, "sync");
	expect(failed.exitCode).not.toBe(0);
	expect(failed.response.success).toBe(false);
	expect(await projectState(f)).toEqual(before);
}, 60_000);

test("rejects uncapturable source edits and missing per-file intent without publishing partial changes", async () => {
	const f = await fixture();
	expectSuccess(await initialize(f));
	const prepared = expectSuccess(
		await run(f, "patch", "prepare", "pstack", "--output", join(f.root, "edit")),
	);
	const workspace = requiredPath(prepared, "workspace");
	const edited = requiredPath(prepared, "editable");
	const before = await projectState(f);
	await put(edited, "README.md", "A change outside the distributed skills.\n");
	const outside = await run(
		f,
		"patch",
		"capture",
		"pstack",
		"--from",
		workspace,
		"--intent",
		reason,
	);
	expect(outside.response.success).toBe(false);
	expect(await projectState(f)).toEqual(before);
	await put(edited, "README.md", "# Complete source context\n");
	await put(edited, "skills/alpha/references/choice.md", "Prefer interfaces.\n");
	await put(edited, "skills/beta/SKILL.md", skill("beta", "A local beta change."));
	const intents = join(f.root, "intents.toml");
	await writeFile(
		intents,
		`[[change]]\nskill = "alpha"\ntarget = "./references/choice.md"\nintent = ${JSON.stringify(reason)}\n`,
	);
	const missing = await run(
		f,
		"patch",
		"capture",
		"pstack",
		"--from",
		workspace,
		"--intent-file",
		intents,
	);
	expect(missing.response.success).toBe(false);
	expect(missing.response.errors.some((error) => error.code === "INTENT_REQUIRED")).toBe(true);
	expect(await projectState(f)).toEqual(before);
}, 60_000);

test("rejects incomplete patch packs and protects existing output when an import collides", async () => {
	const f = await fixture();
	expectSuccess(await initialize(f));
	const before = await projectState(f);
	const collision = await run(
		f,
		"patch",
		"init",
		"duplicate",
		"--source",
		pathToFileURL(f.source).href,
		"--root",
		"plugin",
		"--skills-root",
		"skills",
		"--ref",
		f.revision,
	);
	expect(collision.response.success).toBe(false);
	expect(await projectState(f)).toEqual(before);
	await rm(join(f.client, "skillbox/patches/pstack/lock.json"));
	const incomplete = await projectState(f);
	const failed = await run(f, "sync");
	expect(failed.response.success).toBe(false);
	expect(failed.response.errors.some((error) => error.code === "PATCH_PACK_INVALID")).toBe(true);
	expect(await projectState(f)).toEqual(incomplete);
}, 60_000);

test("does not authorize unrelated native source changes when capturing a patch", async () => {
	const f = await fixture();
	await put(
		f.source,
		"skillbox/native/owned/SKILL.md",
		skill("owned", "Keep the original native content."),
	);
	expectSuccess(await run(f, "add", f.source, "native"));
	expectSuccess(await initialize(f));
	const prepared = expectSuccess(
		await run(f, "patch", "prepare", "pstack", "--output", join(f.root, "edit")),
	);
	await put(
		requiredPath(prepared, "editable"),
		"skills/alpha/references/choice.md",
		"Prefer interfaces.\n",
	);
	await put(
		f.source,
		"skillbox/native/owned/SKILL.md",
		skill("owned", "Unrelated native drift."),
	);
	const before = await projectState(f);
	const failed = await run(
		f,
		"patch",
		"capture",
		"pstack",
		"--from",
		requiredPath(prepared, "workspace"),
		"--intent",
		reason,
	);
	expect(failed.response.success).toBe(false);
	expect(failed.response.errors.some((error) => error.code === "LOCK_HASH_MISMATCH")).toBe(true);
	expect(await projectState(f)).toEqual(before);
}, 60_000);

test("imports a repository root and patches scripts under a nested skills root", async () => {
	const f = await fixture();
	expectSuccess(
		await run(
			f,
			"patch",
			"init",
			"pstack",
			"--source",
			pathToFileURL(f.source).href,
			"--root",
			".",
			"--skills-root",
			"plugin/skills",
			"--ref",
			f.revision,
		),
	);
	const prepared = expectSuccess(
		await run(f, "patch", "prepare", "pstack", "--output", join(f.root, "edit")),
	);
	const edited = requiredPath(prepared, "editable");
	expect(await exists(join(edited, ".git"))).toBe(false);
	await put(edited, "plugin/skills/alpha/scripts/run.sh", "#!/bin/sh\nprintf 'local check\\n'\n");
	expectSuccess(
		await run(
			f,
			"patch",
			"capture",
			"pstack",
			"--from",
			requiredPath(prepared, "workspace"),
			"--intent",
			"Run the project-specific check from the retained helper script.",
		),
	);
	await removeGenerated(f);
	expectSuccess(await run(f, "sync"));
	expect(await readFile(join(f.client, ".agents/skills/alpha/scripts/run.sh"), "utf8")).toContain(
		"local check",
	);
	expect((await lstat(join(f.client, ".agents/skills/alpha/scripts/run.sh"))).mode & 0o111).toBe(
		0o111,
	);
}, 60_000);

test("captures a deliberate revert to upstream without leaving an active patch", async () => {
	const f = await fixture();
	expectSuccess(await initialize(f));
	await captureChoice(f);
	const prepared = expectSuccess(
		await run(f, "patch", "prepare", "pstack", "--output", join(f.root, "revert")),
	);
	const original = await readFile(
		join(f.source, "plugin/skills/alpha/references/choice.md"),
		"utf8",
	);
	await put(requiredPath(prepared, "editable"), "skills/alpha/references/choice.md", original);
	expectSuccess(
		await run(
			f,
			"patch",
			"capture",
			"pstack",
			"--from",
			requiredPath(prepared, "workspace"),
			"--intent",
			"Use the upstream guidance again.",
		),
	);
	expect(
		await readFile(join(f.client, ".agents/skills/alpha/references/choice.md"), "utf8"),
	).toBe(original);
	expect(await exists(join(f.client, "skillbox/patches/pstack/alpha"))).toBe(false);
	expect(expectSuccess(await run(f, "sync")).status).toBe("unchanged");
}, 60_000);

async function fixture(): Promise<Fixture> {
	const root = await mkdtemp(join(tmpdir(), "skillbox-patches-"));
	temporary.push(root);
	const source = join(root, "source");
	const client = join(root, "client");
	await mkdir(source);
	await mkdir(client);
	await git(source, "init", "--quiet", "--initial-branch=main");
	await git(client, "init", "--quiet", "--initial-branch=main");
	await put(client, ".gitignore", "/.agents/skills/\n/.claude/skills\n/.skillbox-*/\n");
	await put(
		source,
		"plugin/skills/alpha/SKILL.md",
		skill("alpha", "Read [the reference](references/choice.md)."),
	);
	await put(
		source,
		"plugin/skills/alpha/references/choice.md",
		"Prefer type aliases for shared contracts.\n",
	);
	await put(source, "plugin/skills/alpha/references/obsolete.md", "A reference we may remove.\n");
	await put(source, "plugin/skills/alpha/scripts/run.sh", "#!/bin/sh\nprintf 'checked\\n'\n");
	await chmod(join(source, "plugin/skills/alpha/scripts/run.sh"), 0o755);
	await writeFile(
		join(source, "plugin/skills/alpha/references/sample.bin"),
		Buffer.from([0, 1, 2, 0]),
	);
	await put(
		source,
		"plugin/skills/beta/SKILL.md",
		skill("beta", "The original upstream instruction."),
	);
	await put(source, "plugin/README.md", "# Complete source context\n");
	await put(source, "plugin/agents/special.md", "This plugin agent must not be installed.\n");
	await put(source, "plugin/hooks/session.sh", "This plugin hook must not run.\n");
	return {
		root,
		source,
		client,
		cache: join(root, "cache"),
		revision: await commit(source, "Initial source"),
	};
}

function skill(name: string, body: string): string {
	return `---\nname: ${name}\ndescription: Test ${name} workflow.\n---\n\n# ${name}\n\n${body}\n`;
}

async function initialize(f: Fixture): Promise<Outcome> {
	return run(
		f,
		"patch",
		"init",
		"pstack",
		"--source",
		pathToFileURL(f.source).href,
		"--root",
		"plugin",
		"--skills-root",
		"skills",
		"--ref",
		f.revision,
		"--update-ref",
		"main",
	);
}

async function captureChoice(f: Fixture): Promise<void> {
	const prepared = expectSuccess(
		await run(f, "patch", "prepare", "pstack", "--output", join(f.root, "edit")),
	);
	await put(
		requiredPath(prepared, "editable"),
		"skills/alpha/references/choice.md",
		"Prefer interfaces for shared contracts.\n",
	);
	expectSuccess(
		await run(
			f,
			"patch",
			"capture",
			"pstack",
			"--from",
			requiredPath(prepared, "workspace"),
			"--intent",
			reason,
		),
	);
}

async function run(f: Fixture, ...args: string[]): Promise<Outcome> {
	const result = await processResult([process.execPath, cli, ...args], f.client, {
		SKILLBOX_CACHE_DIR: f.cache,
		NO_COLOR: "1",
		DO_NOT_TRACK: "1",
	});
	return { ...result, response: JSON.parse(result.stdout) };
}

function expectSuccess(result: Outcome): Record<string, unknown> {
	expect(result.response).toMatchObject({ success: true, errors: [] });
	expect(result.exitCode).toBe(0);
	expect(result.stderr).toBe("");
	return result.response.data!;
}

function requiredPath(data: Record<string, unknown>, key: string): string {
	expect(typeof data[key]).toBe("string");
	return data[key] as string;
}

async function processResult(command: string[], cwd: string, env: Record<string, string> = {}) {
	const child = Bun.spawn(command, {
		cwd,
		env: { ...process.env, ...env },
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

async function git(cwd: string, ...args: string[]): Promise<string> {
	const result = await processResult(["git", ...args], cwd);
	expect(result.exitCode).toBe(0);
	return result.stdout.trim();
}

async function commit(source: string, message: string): Promise<string> {
	await git(source, "add", "--all");
	await git(
		source,
		"-c",
		"user.name=Skillbox Test",
		"-c",
		"user.email=skillbox@example.test",
		"-c",
		"commit.gpgsign=false",
		"commit",
		"--quiet",
		"-m",
		message,
	);
	return git(source, "rev-parse", "HEAD");
}

async function put(root: string, path: string, contents: string): Promise<void> {
	await mkdir(dirname(join(root, path)), { recursive: true });
	await writeFile(join(root, path), contents);
}

async function json(path: string) {
	return JSON.parse(await readFile(path, "utf8"));
}

async function exists(path: string): Promise<boolean> {
	return (
		(await lstat(path).catch((error: NodeJS.ErrnoException) => {
			if (error.code === "ENOENT") return null;
			throw error;
		})) !== null
	);
}

async function files(root: string, prefix = ""): Promise<string[]> {
	const result: string[] = [];
	for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
		const path = join(prefix, entry.name);
		if (entry.isDirectory()) result.push(...(await files(root, path)));
		else result.push(path);
	}
	return result.sort();
}

async function snapshot(root: string, times = false): Promise<Record<string, unknown>> {
	const entries = await Promise.all(
		(await files(root)).map(async (path) => {
			const entry = await lstat(join(root, path));
			const content = entry.isSymbolicLink()
				? await readlink(join(root, path))
				: (await readFile(join(root, path))).toString("hex");
			return [
				path,
				{ content, mode: entry.mode & 0o111, ...(times && { modified: entry.mtimeMs }) },
			];
		}),
	);
	return Object.fromEntries(entries);
}

async function projectState(f: Fixture, times = false) {
	return {
		tracking: await snapshot(join(f.client, "skillbox"), times),
		installed: await snapshot(join(f.client, ".agents/skills"), times),
		claude: await readlink(join(f.client, ".claude/skills")),
	};
}

async function removeGenerated(f: Fixture): Promise<void> {
	await rm(join(f.client, ".agents/skills"), { recursive: true, force: true });
	await rm(join(f.client, ".claude/skills"), { force: true });
}
