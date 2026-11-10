import { afterEach, expect, test } from "bun:test";
import {
	cp,
	lstat,
	mkdir,
	mkdtemp,
	readFile,
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
