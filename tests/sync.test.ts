import { afterEach, expect, test } from "bun:test";
import {
	cp,
	lstat,
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	readlink,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repository = fileURLToPath(new URL("..", import.meta.url));
const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const directories: string[] = [];

afterEach(async () => {
	await Promise.all(
		directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
	);
});

test("restores a fresh checkout and leaves a repeated sync unchanged", async () => {
	const cwd = await client();
	const added = await run(cwd, "add", "../source", "development");
	expect(added.exitCode).toBe(0);
	expect(added.stderr).toBe("");
	expect(added.response.success).toBe(true);

	const config = await readFile(join(cwd, "skillbox/config.json"), "utf8");
	const lock = await readFile(join(cwd, "skillbox/lock.json"), "utf8");
	await rm(join(cwd, ".agents"), { recursive: true });
	await rm(join(cwd, ".claude"), { recursive: true });

	const restored = await run(cwd, "sync");
	expect(restored.exitCode).toBe(0);
	expect(restored.stderr).toBe("");
	expect(restored.response.success).toBe(true);
	expect(restored.response).toMatchInlineSnapshot(`
	  {
	    "data": {
	      "installed": 1,
	      "removed": 0,
	      "status": "synced",
	      "unchanged": 0,
	    },
	    "errors": [],
	    "success": true,
	  }
	`);
	expect(await readFile(join(cwd, "skillbox/config.json"), "utf8")).toBe(config);
	expect(await readFile(join(cwd, "skillbox/lock.json"), "utf8")).toBe(lock);
	expect(await readlink(join(cwd, ".claude/skills"))).toBe("../.agents/skills");
	expect(await readFile(join(cwd, ".agents/skills/blackbox-testing/SKILL.md"), "utf8")).toContain(
		"# Black-box CLI tests",
	);

	const tracked = await modificationTimes(cwd);
	await Bun.sleep(20);
	const repeated = await run(cwd, "sync");
	expect(repeated.exitCode).toBe(0);
	expect(repeated.stderr).toBe("");
	expect(repeated.response.success).toBe(true);
	expect(repeated.response).toMatchInlineSnapshot(`
	  {
	    "data": {
	      "installed": 0,
	      "removed": 0,
	      "status": "unchanged",
	      "unchanged": 1,
	    },
	    "errors": [],
	    "success": true,
	  }
	`);
	expect(await modificationTimes(cwd)).toEqual(tracked);
});

test("rejects source content that no longer matches the native lock", async () => {
	const cwd = await client();
	const added = await run(cwd, "add", "../source", "development");
	expect(added.exitCode).toBe(0);
	expect(added.stderr).toBe("");
	expect(added.response.success).toBe(true);

	const installedPath = join(cwd, ".agents/skills/blackbox-testing/SKILL.md");
	const installed = await readFile(installedPath, "utf8");
	const config = await readFile(join(cwd, "skillbox/config.json"), "utf8");
	const lock = await readFile(join(cwd, "skillbox/lock.json"), "utf8");
	await writeFile(
		join(cwd, "../source/skillbox/development/blackbox-testing/SKILL.md"),
		`${installed}\nChanged upstream.\n`,
	);

	const result = await run(cwd, "sync");
	expect(result.exitCode).toBe(1);
	expect(result.stderr).toBe("");
	expect(result.response.success).toBe(false);
	expect(result.response).toMatchInlineSnapshot(`
	  {
	    "data": null,
	    "errors": [
	      {
	        "code": "LOCK_HASH_MISMATCH",
	        "message": "Content hash mismatch for blackbox-testing; skillbox/lock.json was not changed.",
	        "skill": "blackbox-testing",
	      },
	    ],
	    "success": false,
	  }
	`);
	expect(await readFile(installedPath, "utf8")).toBe(installed);
	expect(await readFile(join(cwd, "skillbox/config.json"), "utf8")).toBe(config);
	expect(await readFile(join(cwd, "skillbox/lock.json"), "utf8")).toBe(lock);
});

test("reconciles config-only bundle and source additions/removals in the selected workspace", async () => {
	const cwd = await client();
	expect((await run(cwd, "add", "../source", "development")).exitCode).toBe(0);
	const initial = JSON.parse(await readFile(join(cwd, "skillbox/lock.json"), "utf8"));
	initial.extra = "retained SDK metadata";
	initial.skills["blackbox-testing"].extra = "retained skill metadata";
	await writeFile(join(cwd, "skillbox/lock.json"), JSON.stringify(initial));
	await seedSkill(cwd, "../source", "review", "reviewing");
	await seedSkill(cwd, "../other", "writing", "writing");

	const sources = [
		{ source: "../source", bundles: ["development", "review"] },
		{ source: "../other", bundles: ["writing"] },
	];
	const config = await configure(cwd, sources);
	const added = await run(join(cwd, ".."), "--workspace", "client", "sync");
	expect(added.exitCode).toBe(0);
	expect(added.stderr).toBe("");
	expect(added.response).toMatchObject({
		success: true,
		data: { status: "synced", installed: 2, unchanged: 1, removed: 0 },
	});
	expect(await readFile(join(cwd, "skillbox/config.json"), "utf8")).toBe(config);
	const next = JSON.parse(await readFile(join(cwd, "skillbox/lock.json"), "utf8"));
	expect(Object.keys(next.skills).sort()).toEqual(["blackbox-testing", "reviewing", "writing"]);
	expect(next.extra).toBe(initial.extra);
	expect(next.skills["blackbox-testing"]).toEqual(initial.skills["blackbox-testing"]);
	expect(next.skills.reviewing.source).toBe("../source/skillbox");
	expect(next.skills.writing.source).toBe("../other/skillbox");
	for (const name of ["reviewing", "writing"]) {
		expect(await readFile(join(cwd, ".agents/skills", name, "SKILL.md"), "utf8")).toContain(
			name,
		);
	}

	const locked = await readFile(join(cwd, "skillbox/lock.json"), "utf8");
	const addedTimes = await modificationTimes(cwd);
	await Bun.sleep(20);
	const matching = await run(cwd, "sync");
	expect(matching.exitCode).toBe(0);
	expect(matching.response).toMatchObject({
		data: { status: "unchanged", installed: 0, unchanged: 3, removed: 0 },
	});
	expect(await readFile(join(cwd, "skillbox/lock.json"), "utf8")).toBe(locked);
	expect(await modificationTimes(cwd)).toEqual(addedTimes);

	await configure(cwd, [{ source: "../source", bundles: ["review"] }]);
	await rm(join(cwd, "../other"), { recursive: true });
	// Even already-missing skills must be pruned from the lock.
	await rm(join(cwd, ".agents/skills/blackbox-testing"), { recursive: true });
	await rm(join(cwd, ".agents/skills/writing"), { recursive: true });
	const pruned = await run(cwd, "sync");
	expect(pruned.exitCode).toBe(0);
	expect(pruned.response).toMatchObject({
		success: true,
		data: { status: "synced", installed: 0, unchanged: 1, removed: 2 },
	});
	const prunedLock = JSON.parse(await readFile(join(cwd, "skillbox/lock.json"), "utf8"));
	expect(Object.keys(prunedLock.skills)).toEqual(["reviewing"]);
	expect(prunedLock.skills.reviewing).toEqual(next.skills.reviewing);

	await configure(cwd, []);
	const emptied = await run(cwd, "sync");
	expect(emptied.exitCode).toBe(0);
	expect(emptied.response).toMatchObject({
		success: true,
		data: { status: "synced", installed: 0, unchanged: 0, removed: 1 },
	});
	expect(await readdir(join(cwd, ".agents/skills"))).toEqual([]);
	expect(JSON.parse(await readFile(join(cwd, "skillbox/lock.json"), "utf8"))).toEqual({
		...initial,
		skills: {},
	});
	expect(await readlink(join(cwd, ".claude/skills"))).toBe("../.agents/skills");
	const paths = [
		"skillbox/config.json",
		"skillbox/lock.json",
		".agents/skills",
		".claude/skills",
	];
	const before = await Promise.all(
		paths.map(async (path) => (await lstat(join(cwd, path))).mtimeMs),
	);
	await Bun.sleep(20);
	const repeated = await run(cwd, "sync");
	expect(repeated.exitCode).toBe(0);
	expect(repeated.response).toMatchObject({ data: { status: "unchanged", removed: 0 } });
	expect(
		await Promise.all(paths.map(async (path) => (await lstat(join(cwd, path))).mtimeMs)),
	).toEqual(before);

	await rm(join(cwd, ".agents/skills"), { recursive: true });
	const restored = await run(cwd, "sync");
	expect(restored.exitCode).toBe(0);
	expect(restored.response).toMatchObject({
		data: { status: "synced", installed: 0, removed: 0 },
	});
	expect(await readdir(join(cwd, ".agents/skills"))).toEqual([]);
});

test("publishes no config-driven changes when a retained skill has drifted", async () => {
	const cwd = await client();
	expect((await run(cwd, "add", "../source", "development")).exitCode).toBe(0);
	await seedSkill(cwd, "../source", "review", "reviewing");
	const config = await configure(cwd, [
		{ source: "../source", bundles: ["development", "review"] },
	]);
	const lock = await readFile(join(cwd, "skillbox/lock.json"), "utf8");
	const installed = await readFile(join(cwd, ".agents/skills/blackbox-testing/SKILL.md"), "utf8");
	await writeFile(
		join(cwd, "../source/skillbox/development/blackbox-testing/SKILL.md"),
		`${installed}\nDrift.\n`,
	);
	const result = await run(cwd, "sync");
	expect(result.exitCode).toBe(1);
	expect(result.response).toMatchObject({
		success: false,
		errors: [{ code: "LOCK_HASH_MISMATCH" }],
	});
	expect(await readdir(join(cwd, ".agents/skills"))).toEqual(["blackbox-testing"]);
	expect(await readFile(join(cwd, ".agents/skills/blackbox-testing/SKILL.md"), "utf8")).toBe(
		installed,
	);
	expect(await readFile(join(cwd, "skillbox/config.json"), "utf8")).toBe(config);
	expect(await readFile(join(cwd, "skillbox/lock.json"), "utf8")).toBe(lock);
});

test("does not overwrite an unmanaged skill newly selected by config", async () => {
	const cwd = await client();
	expect((await run(cwd, "add", "../source", "development")).exitCode).toBe(0);
	await seedSkill(cwd, "../source", "review", "reviewing");
	await mkdir(join(cwd, ".agents/skills/reviewing"));
	await writeFile(join(cwd, ".agents/skills/reviewing/SKILL.md"), "User-owned contents\n");
	await configure(cwd, [{ source: "../source", bundles: ["review"] }]);
	const lock = await readFile(join(cwd, "skillbox/lock.json"), "utf8");
	const result = await run(cwd, "sync");
	expect(result.exitCode).toBe(1);
	expect(result.response).toMatchObject({
		success: false,
		errors: [{ code: "UNMANAGED_SKILL", skill: "reviewing" }],
	});
	expect(await readFile(join(cwd, ".agents/skills/reviewing/SKILL.md"), "utf8")).toBe(
		"User-owned contents\n",
	);
	expect((await readdir(join(cwd, ".agents/skills"))).sort()).toEqual([
		"blackbox-testing",
		"reviewing",
	]);
	expect(await readFile(join(cwd, "skillbox/lock.json"), "utf8")).toBe(lock);

	await configure(cwd, []);
	const empty = await run(cwd, "sync");
	expect(empty.exitCode).toBe(1);
	expect(empty.response).toMatchObject({ errors: [{ code: "UNMANAGED_SKILL" }] });
	expect(await readFile(join(cwd, "skillbox/lock.json"), "utf8")).toBe(lock);
});

test("rejects colliding config selections without publishing", async () => {
	const cwd = await client();
	expect((await run(cwd, "add", "../source", "development")).exitCode).toBe(0);
	await seedSkill(cwd, "../other", "review", "blackbox-testing");
	await configure(cwd, [
		{ source: "../source", bundles: ["development"] },
		{ source: "../other", bundles: ["review"] },
	]);
	const before = await modificationTimes(cwd);
	const result = await run(cwd, "sync");
	expect(result.exitCode).toBe(1);
	expect(result.response).toMatchObject({
		success: false,
		errors: [{ code: "SKILL_NAME_COLLISION" }],
	});
	expect(await modificationTimes(cwd)).toEqual(before);
});

async function configure(cwd: string, sources: { source: string; bundles: string[] }[]) {
	const text = `${JSON.stringify({ sources }, null, "\t")}\n`;
	await writeFile(join(cwd, "skillbox/config.json"), text);
	return text;
}

async function seedSkill(cwd: string, source: string, bundle: string, name: string) {
	const directory = join(cwd, source, "skillbox", bundle, name);
	await mkdir(directory, { recursive: true });
	await writeFile(
		join(directory, "SKILL.md"),
		`---\nname: ${name}\ndescription: Test ${name}.\n---\n\n# ${name}\n`,
	);
}

async function client(): Promise<string> {
	const directory = await mkdtemp("/tmp/skillbox-sync-");
	directories.push(directory);
	await cp(
		join(repository, "skillbox/development"),
		join(directory, "source/skillbox/development"),
		{ recursive: true },
	);
	await mkdir(join(directory, "client"));
	return join(directory, "client");
}

async function run(cwd: string, ...args: string[]) {
	const child = Bun.spawn([process.execPath, cli, ...args], {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env, NO_COLOR: "1", DO_NOT_TRACK: "1" },
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	return {
		exitCode,
		stdout,
		stderr,
		response: JSON.parse(stdout) as {
			success: boolean;
			data: unknown;
			errors: unknown[];
		},
	};
}

async function modificationTimes(cwd: string) {
	const paths = [
		".agents/skills/blackbox-testing/SKILL.md",
		".claude/skills",
		"skillbox/config.json",
		"skillbox/lock.json",
	];
	return Promise.all(
		paths.map(async (path) => {
			const entry =
				path === ".claude/skills"
					? await lstat(join(cwd, path))
					: await stat(join(cwd, path));
			return [path, entry.mtimeMs];
		}),
	);
}
