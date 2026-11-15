import { afterEach, expect, test } from "bun:test";
import {
	chmod,
	lstat,
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	readlink,
	rm,
	writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const temporary: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })),
	);
});

interface Outcome {
	exitCode: number;
	stderr: string;
	response: {
		success: boolean;
		data: Record<string, unknown> | null;
		errors: {
			code: string;
			message: string;
			source?: string;
			input?: string;
			skill?: string;
		}[];
	};
}

async function fixture() {
	const root = await mkdtemp("/tmp/skillbox-selection-");
	temporary.push(root);
	const cwd = join(root, "client");
	await mkdir(cwd);
	for (const [bundle, name] of [
		["base", "base-only"],
		["review", "alpha"],
		["review", "beta"],
		["extra", "extra-only"],
	]) {
		await put(root, `source/skillbox/${bundle}/${name}/SKILL.md`, skill(name!));
	}
	await put(
		root,
		"source/skillbox/review/alpha/references/choice.md",
		"Keep the complete selected directory.\n",
	);
	await put(
		root,
		"source/skillbox/review/alpha/scripts/run.sh",
		"#!/bin/sh\nprintf 'alpha\\n'\n",
	);
	await chmod(join(root, "source/skillbox/review/alpha/scripts/run.sh"), 0o755);
	expectSuccess(await run(cwd, "add", "../source", "base"));
	return { root, cwd };
}

test("native subsets install complete selected directories, restore, expand, reduce, and survive later adds", async () => {
	const { root, cwd } = await fixture();
	await configure(cwd, ["base", { bundle: "review", skills: ["alpha"] }]);
	expect(expectSuccess(await run(cwd, "sync"))).toMatchObject({
		status: "synced",
		installed: 1,
		removed: 0,
	});
	expect(await names(cwd)).toEqual(["alpha", "base-only"]);
	const original = await json(cwd, "skillbox/lock.json");
	expect(Object.keys(original.skills).sort()).toEqual(["alpha", "base-only"]);
	expect(await readFile(join(cwd, ".agents/skills/alpha/SKILL.md"), "utf8")).toBe(skill("alpha"));
	expect(await readFile(join(cwd, ".agents/skills/alpha/references/choice.md"), "utf8"))
		.toMatchInlineSnapshot(`
	  "Keep the complete selected directory.
	  "
	`);
	expect(await readFile(join(cwd, ".agents/skills/alpha/scripts/run.sh"), "utf8")).toBe(
		"#!/bin/sh\nprintf 'alpha\\n'\n",
	);
	expect((await lstat(join(cwd, ".agents/skills/alpha/scripts/run.sh"))).mode & 0o111).toBe(
		0o111,
	);
	expect(await readlink(join(cwd, ".claude/skills"))).toBe("../.agents/skills");
	expect(await readFile(join(cwd, ".claude/skills/alpha/SKILL.md"), "utf8")).toBe(skill("alpha"));

	const lockText = await readFile(join(cwd, "skillbox/lock.json"), "utf8");
	await rm(join(cwd, ".agents"), { recursive: true });
	await rm(join(cwd, ".claude"), { recursive: true });
	expectSuccess(await run(cwd, "sync"));
	expect(await names(cwd)).toEqual(["alpha", "base-only"]);
	expect(await readFile(join(cwd, "skillbox/lock.json"), "utf8")).toBe(lockText);
	expect(expectSuccess(await run(cwd, "sync"))).toEqual({
		status: "unchanged",
		installed: 0,
		unchanged: 2,
		removed: 0,
	});

	await put(
		root,
		"source/skillbox/review/alpha/SKILL.md",
		`${skill("alpha")}Upstream changed.\n`,
	);
	expect(expectSuccess(await run(cwd, "add", "../source", "review", "extra"))).toMatchObject({
		status: "added",
		installed: 1,
	});
	expect((await json(cwd, "skillbox/config.json")).sources[0].bundles).toEqual([
		"base",
		"extra",
		{ bundle: "review", skills: ["alpha"] },
	]);
	expect(await names(cwd)).toEqual(["alpha", "base-only", "extra-only"]);
	expect(await readFile(join(cwd, ".agents/skills/alpha/SKILL.md"), "utf8")).toBe(skill("alpha"));
	expect((await json(cwd, "skillbox/lock.json")).skills.alpha).toEqual(original.skills.alpha);
	const before = await state(cwd);
	expect(expectSuccess(await run(cwd, "add", "../source", "review"))).toMatchObject({
		status: "unchanged",
		installed: 0,
	});
	expect(await state(cwd)).toEqual(before);
	await put(root, "source/skillbox/review/alpha/SKILL.md", skill("alpha"));

	await configure(cwd, [
		"base",
		"extra",
		{ bundle: "review", skills: ["alpha", "beta", "alpha"] },
	]);
	expect(expectSuccess(await run(cwd, "sync"))).toMatchObject({ installed: 1, removed: 0 });
	expect(await names(cwd)).toEqual(["alpha", "base-only", "beta", "extra-only"]);
	expect((await json(cwd, "skillbox/lock.json")).skills.alpha).toEqual(original.skills.alpha);
	await configure(cwd, ["base", "extra", { bundle: "review", skills: ["beta"] }]);
	expect(expectSuccess(await run(cwd, "add", "../source", "review"))).toMatchObject({
		status: "unchanged",
		installed: 0,
	});
	expect(await names(cwd)).toContain("alpha");
	expect(expectSuccess(await run(cwd, "sync"))).toMatchObject({ installed: 0, removed: 1 });
	expect(await names(cwd)).toEqual(["base-only", "beta", "extra-only"]);
	expect(Object.keys((await json(cwd, "skillbox/lock.json")).skills).sort()).toEqual([
		"base-only",
		"beta",
		"extra-only",
	]);
});

test("unknown native selectors are exact, bundle-scoped, and atomic even on repeated add", async () => {
	const { cwd } = await fixture();
	for (const requested of ["Alpha", "extra-only"]) {
		await configure(cwd, ["base", { bundle: "review", skills: ["alpha", requested] }]);
		const before = await state(cwd);
		for (const args of [["sync"], ["add", "../source", "review"]]) {
			const result = expectFailure(await run(cwd, ...args));
			expect(result.errors).toEqual([
				{
					code: "SKILL_NOT_FOUND",
					message: `No skill named ${requested} in bundle: review.`,
					source: "../source",
					input: "review",
					skill: requested,
				},
			]);
			expect(await state(cwd)).toEqual(before);
		}
	}
});

test("subset schema rejects empty and non-strict objects before changing managed output", async () => {
	const { cwd } = await fixture();
	for (const selection of [
		{ bundle: "review", skills: [] },
		{ bundle: "review", skills: ["alpha"], extra: true },
	]) {
		await configure(cwd, ["base", selection]);
		const before = await state(cwd);
		expectFailure(await run(cwd, "sync"));
		expect(await state(cwd)).toEqual(before);
	}
});

test("unselected native names do not collide, selected names do, and locked names stay reserved until sync", async () => {
	const { root, cwd } = await fixture();
	await put(root, "other/skillbox/team/beta/SKILL.md", skill("beta"));
	await put(root, "later/skillbox/team/beta/SKILL.md", skill("beta"));
	await writeConfig(cwd, {
		sources: [
			{ source: "../source", bundles: ["base", { bundle: "review", skills: ["alpha"] }] },
			{ source: "../other", bundles: ["team"] },
		],
	});
	expectSuccess(await run(cwd, "sync"));
	expect(await names(cwd)).toEqual(["alpha", "base-only", "beta"]);
	const config = await json(cwd, "skillbox/config.json");
	config.sources[0].bundles[1].skills.push("beta");
	await writeConfig(cwd, config);
	const before = await state(cwd);
	expect(expectFailure(await run(cwd, "sync")).errors).toContainEqual(
		expect.objectContaining({ code: "SKILL_NAME_COLLISION", skill: "beta" }),
	);
	expect(await state(cwd)).toEqual(before);
	await configure(cwd, ["base", { bundle: "review", skills: ["alpha"] }]);
	const retained = await state(cwd);
	expect(expectFailure(await run(cwd, "add", "../later", "team")).errors).toContainEqual(
		expect.objectContaining({ code: "SKILL_NAME_COLLISION", skill: "beta" }),
	);
	expect(await state(cwd)).toEqual(retained);
	expectSuccess(await run(cwd, "sync"));
	expectSuccess(await run(cwd, "add", "../later", "team"));
});

test("raw patch init installs no siblings, selects after full replay, and reserves only unsynced selected names", async () => {
	const { root, cwd } = await fixture();
	const upstream = join(root, "raw");
	for (const name of ["alpha", "beta"])
		await put(upstream, `plugin/skills/${name}/SKILL.md`, skill(name));
	await put(upstream, "plugin/skills/alias-folder/SKILL.md", skill("alias-name"));
	await put(upstream, "plugin/skills/alpha/references/choice.md", "Pinned raw support.\n");
	await put(upstream, "plugin/skills/alpha/scripts/run.sh", "#!/bin/sh\nexit 0\n");
	await chmod(join(upstream, "plugin/skills/alpha/scripts/run.sh"), 0o755);
	await git(upstream, "init", "--quiet", "--initial-branch=main");
	await git(upstream, "add", ".");
	await git(
		upstream,
		"-c",
		"user.name=Test",
		"-c",
		"user.email=test@example.test",
		"-c",
		"commit.gpgsign=false",
		"commit",
		"--quiet",
		"-m",
		"Raw fixture",
	);
	const source = pathToFileURL(upstream).href;
	const init = expectSuccess(
		await run(
			cwd,
			"patch",
			"init",
			"kit",
			"--source",
			source,
			"--root",
			"plugin",
			"--ref",
			"main",
		),
	);
	expect(await names(cwd)).toEqual(["base-only"]);
	const config = await json(cwd, "skillbox/config.json");
	config.sources.find((entry: { source: string }) => entry.source === source).bundles = [
		{ bundle: "kit", skills: ["alpha"] },
	];
	await writeConfig(cwd, config);
	const packLock = await readFile(join(cwd, "skillbox/patches/kit/lock.json"), "utf8");

	config.sources.find((entry: { source: string }) => entry.source === source).bundles[0].skills =
		["alias-folder"];
	await writeConfig(cwd, config);
	const beforeUnknown = await state(cwd);
	expect(
		expectFailure(
			await run(
				cwd,
				"patch",
				"init",
				"unknown",
				"--source",
				source,
				"--root",
				"plugin",
				"--ref",
				"main",
			),
		).errors,
	).toContainEqual(
		expect.objectContaining({
			code: "SKILL_NOT_FOUND",
			source,
			input: "kit",
			skill: "alias-folder",
		}),
	);
	expect(await state(cwd)).toEqual(beforeUnknown);
	config.sources.find((entry: { source: string }) => entry.source === source).bundles[0].skills =
		["alpha"];
	await writeConfig(cwd, config);
	const beforeCollision = await state(cwd);
	expect(
		expectFailure(
			await run(
				cwd,
				"patch",
				"init",
				"blocked",
				"--source",
				source,
				"--root",
				"plugin",
				"--ref",
				"main",
			),
		).errors,
	).toContainEqual(expect.objectContaining({ code: "SKILL_NAME_COLLISION", skill: "alpha" }));
	expect(await state(cwd)).toEqual(beforeCollision);
	const other = join(root, "second");
	await put(other, "plugin/skills/beta/SKILL.md", skill("beta"));
	await git(other, "init", "--quiet", "--initial-branch=main");
	await git(other, "add", ".");
	await git(
		other,
		"-c",
		"user.name=Test",
		"-c",
		"user.email=test@example.test",
		"-c",
		"commit.gpgsign=false",
		"commit",
		"--quiet",
		"-m",
		"Second fixture",
	);
	expectSuccess(
		await run(
			cwd,
			"patch",
			"init",
			"second",
			"--source",
			pathToFileURL(other).href,
			"--root",
			"plugin",
			"--ref",
			"main",
		),
	);
	const narrowed = await json(cwd, "skillbox/config.json");
	narrowed.sources = narrowed.sources.filter(
		(entry: { source: string }) => entry.source !== pathToFileURL(other).href,
	);
	await writeConfig(cwd, narrowed);
	expectSuccess(await run(cwd, "sync"));
	expect(await names(cwd)).toEqual(["alpha", "base-only"]);
	const locked = (await json(cwd, "skillbox/lock.json")).skills.alpha;
	expect(locked).toMatchObject({
		source,
		sourceType: "git",
		skillPath: "plugin/skills/alpha/SKILL.md",
		ref: expect.stringMatching(/^[a-f0-9]{40}$/),
	});
	expect(await readFile(join(cwd, ".agents/skills/alpha/references/choice.md"), "utf8")).toBe(
		"Pinned raw support.\n",
	);
	expect((await lstat(join(cwd, ".agents/skills/alpha/scripts/run.sh"))).mode & 0o111).toBe(
		0o111,
	);
	expect(await readFile(join(cwd, "skillbox/patches/kit/lock.json"), "utf8")).toBe(packLock);
	await rm(join(cwd, ".agents"), { recursive: true });
	await rm(join(cwd, ".claude"), { recursive: true });
	expectSuccess(await run(cwd, "sync"));
	expect(await names(cwd)).toEqual(["alpha", "base-only"]);
	expect(expectSuccess(await run(cwd, "sync")).status).toBe("unchanged");

	await put(
		String(init.editable),
		"skills/beta/references/pending.md",
		"An unselected sibling still needs intent.\n",
	);
	expectSuccess(await run(cwd, "patch", "capture", "kit", "--from", String(init.workspace)));
	const beforeIntent = await state(cwd);
	expect(expectFailure(await run(cwd, "sync")).errors).toContainEqual(
		expect.objectContaining({ code: "INTENT_REQUIRED", skill: "beta" }),
	);
	expect(await state(cwd)).toEqual(beforeIntent);
	const manifest = join(cwd, "skillbox/patches/kit/beta/patch.toml");
	await writeFile(
		manifest,
		(await readFile(manifest, "utf8")).replace(
			'intent = ""',
			'intent = "Keep sibling guidance for full exports."',
		),
	);
	expectSuccess(await run(cwd, "sync"));
	expect(await names(cwd)).toEqual(["alpha", "base-only"]);
	await put(
		cwd,
		"skillbox/patches/kit/beta/changes/0001-captured.patch",
		"Broken unselected patch.\n",
	);
	const beforeDrift = await state(cwd);
	expect(expectFailure(await run(cwd, "sync")).errors).toContainEqual(
		expect.objectContaining({ code: "BUNDLE_LOCK_DRIFT" }),
	);
	expect(await state(cwd)).toEqual(beforeDrift);
}, 30_000);

test("raw alias selection installs the declared name and records the actual upstream folder and revision", async () => {
	const { root, cwd } = await fixture();
	const upstream = await rawRepository(join(root, "aliased"), {
		"alias-folder": "declared-name",
		"sibling-folder": "unselected-sibling",
	});
	expect(expectSuccess(await initializeRaw(cwd, "kit", upstream.source)).skills).toBe(2);
	expect(await names(cwd)).toEqual(["base-only"]);
	const config = await json(cwd, "skillbox/config.json");
	config.sources.find((entry: { source: string }) => entry.source === upstream.source).bundles = [
		{ bundle: "kit", skills: ["declared-name"] },
	];
	await writeConfig(cwd, config);
	expectSuccess(await run(cwd, "sync"));
	expect(await names(cwd)).toEqual(["base-only", "declared-name"]);
	expect(await readFile(join(cwd, ".agents/skills/declared-name/SKILL.md"), "utf8")).toBe(
		skill("declared-name"),
	);
	expect(
		await readFile(join(cwd, ".agents/skills/declared-name/references/origin.md"), "utf8"),
	).toBe("Support from alias-folder.\n");
	const locked = (await json(cwd, "skillbox/lock.json")).skills["declared-name"];
	expect(locked).toMatchObject({
		source: upstream.source,
		sourceType: "git",
		skillPath: "plugins/review/resources/skills/alias-folder/SKILL.md",
		ref: upstream.revision,
	});
	expect(await readFile(join(upstream.directory, locked.skillPath), "utf8")).toBe(
		skill("declared-name"),
	);
	const installed = await state(cwd);
	expect(expectSuccess(await run(cwd, "sync")).status).toBe("unchanged");
	expect(await state(cwd)).toEqual(installed);
});

for (const incoming of [
	{ folder: "occupied-name", name: "incoming-name", collision: false },
	{ folder: "different-folder", name: "occupied-name", collision: true },
]) {
	test(`raw patch init ${incoming.collision ? "atomically rejects matching declared names under different folders" : "allows a folder matching an unsynced selected name when its declared name differs"}`, async () => {
		const { root, cwd } = await fixture();
		const existing = await rawRepository(join(root, "existing"), {
			"selected-folder": "occupied-name",
			"sibling-folder": "unselected-sibling",
		});
		expectSuccess(await initializeRaw(cwd, "existing", existing.source));
		const config = await json(cwd, "skillbox/config.json");
		config.sources.find(
			(entry: { source: string }) => entry.source === existing.source,
		).bundles = [{ bundle: "existing", skills: ["occupied-name"] }];
		await writeConfig(cwd, config);
		const upstream = await rawRepository(join(root, "incoming"), {
			[incoming.folder]: incoming.name,
		});
		const before = await state(cwd);
		const result = await initializeRaw(cwd, "incoming", upstream.source);
		if (incoming.collision) {
			expect(expectFailure(result).errors).toContainEqual(
				expect.objectContaining({ code: "SKILL_NAME_COLLISION", skill: "occupied-name" }),
			);
			expect(await state(cwd)).toEqual(before);
		} else {
			expect(expectSuccess(result)).toMatchObject({ status: "initialized", skills: 1 });
			expect(await names(cwd)).toEqual(["base-only"]);
			expectSuccess(await run(cwd, "sync"));
			expect(await names(cwd)).toEqual(["base-only", "incoming-name", "occupied-name"]);
			expect(await readFile(join(cwd, ".agents/skills/incoming-name/SKILL.md"), "utf8")).toBe(
				skill("incoming-name"),
			);
			expect(
				await readFile(
					join(cwd, ".agents/skills/incoming-name/references/origin.md"),
					"utf8",
				),
			).toBe("Support from occupied-name.\n");
		}
	});
}

async function rawRepository(directory: string, skills: Record<string, string>) {
	for (const [folder, name] of Object.entries(skills)) {
		const path = `plugins/review/resources/skills/${folder}`;
		await put(directory, `${path}/SKILL.md`, skill(name));
		await put(directory, `${path}/references/origin.md`, `Support from ${folder}.\n`);
	}
	await git(directory, "init", "--quiet", "--initial-branch=main");
	await git(directory, "add", ".");
	await git(
		directory,
		"-c",
		"user.name=Test",
		"-c",
		"user.email=test@example.test",
		"-c",
		"commit.gpgsign=false",
		"commit",
		"--quiet",
		"-m",
		"Aliased raw fixture",
	);
	return {
		directory,
		source: pathToFileURL(directory).href,
		revision: await git(directory, "rev-parse", "HEAD"),
	};
}

async function initializeRaw(cwd: string, bundle: string, source: string) {
	return run(
		cwd,
		"patch",
		"init",
		bundle,
		"--source",
		source,
		"--root",
		"plugins/review",
		"--skills-root",
		"resources/skills",
		"--ref",
		"main",
		"--output",
		`edits/${bundle}`,
	);
}

async function run(cwd: string, ...args: string[]): Promise<Outcome> {
	const child = Bun.spawn([process.execPath, cli, ...args], {
		cwd,
		env: {
			...process.env,
			SKILLBOX_CACHE_DIR: join(cwd, "../cache"),
			NO_COLOR: "1",
			DO_NOT_TRACK: "1",
		},
		stdout: "pipe",
		stderr: "pipe",
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	return { exitCode, stderr, response: JSON.parse(stdout) };
}

function expectSuccess(result: Outcome) {
	expect(result.exitCode).toBe(0);
	expect(result.stderr).toBe("");
	expect(result.response).toMatchObject({ success: true, errors: [] });
	return result.response.data!;
}

function expectFailure(result: Outcome) {
	expect(result.exitCode).not.toBe(0);
	expect(result.stderr).toBe("");
	expect(result.response.success).toBe(false);
	return result.response;
}

async function configure(cwd: string, bundles: unknown[]) {
	await writeConfig(cwd, { sources: [{ source: "../source", bundles }] });
}

async function writeConfig(cwd: string, config: unknown) {
	await put(cwd, "skillbox/config.json", `${JSON.stringify(config, null, 2)}\n`);
}

async function put(root: string, path: string, text: string) {
	await mkdir(dirname(join(root, path)), { recursive: true });
	await writeFile(join(root, path), text);
}

function skill(name: string) {
	return `---\nname: ${name}\ndescription: Test ${name} selection.\n---\n\n# ${name}\n\nSelected skill ${name}.\n`;
}

async function json(cwd: string, path: string) {
	return JSON.parse(await readFile(join(cwd, path), "utf8"));
}

async function names(cwd: string) {
	return (await readdir(join(cwd, ".agents/skills"))).sort();
}

async function state(cwd: string) {
	async function tree(root: string): Promise<Record<string, unknown>> {
		const entries = await readdir(root, { withFileTypes: true });
		return Object.fromEntries(
			await Promise.all(
				entries
					.filter((entry) => entry.name !== ".prepare")
					.map(async (entry) => {
						const path = join(root, entry.name);
						if (entry.isSymbolicLink()) return [entry.name, await readlink(path)];
						if (entry.isDirectory()) return [entry.name, await tree(path)];
						return [
							entry.name,
							{
								bytes: (await readFile(path)).toString("hex"),
								mode: (await lstat(path)).mode & 0o111,
							},
						];
					}),
			),
		);
	}
	return tree(cwd);
}

async function git(cwd: string, ...args: string[]) {
	const child = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
	const [code, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	expect(stderr).toBe("");
	expect(code).toBe(0);
	return stdout.trim();
}
