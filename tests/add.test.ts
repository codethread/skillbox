import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, readlink, rm, writeFile } from "node:fs/promises";
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

async function client() {
	const directory = await mkdtemp("/tmp/skillbox-add-");
	directories.push(directory);
	return directory;
}

async function add(cwd: string, ...bundles: string[]) {
	const child = Bun.spawn([process.execPath, cli, "add", repository, ...bundles], {
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
	return { exitCode, stdout: stdout.split("\n"), stderr: stderr.split("\n") };
}

test("installs a repository bundle into a real temporary client", async () => {
	const cwd = await client();

	expect(await add(cwd, "development")).toMatchInlineSnapshot(`
	  {
	    "exitCode": 0,
	    "stderr": [
	      "",
	    ],
	    "stdout": [
	      "Added 1 skill from development:",
	      "  blackbox-testing",
	      "",
	    ],
	  }
	`);
	expect(await readdir(cwd)).toMatchInlineSnapshot(`
	  [
	    ".agents",
	    ".claude",
	  ]
	`);
	expect(await readdir(join(cwd, ".agents/skills"))).toMatchInlineSnapshot(`
	  [
	    "blackbox-testing",
	  ]
	`);
	expect(await readFile(join(cwd, ".agents/skills/blackbox-testing/SKILL.md"), "utf8"))
		.toMatchInlineSnapshot(`
		  "---
		  name: blackbox-testing
		  description: Use when testing a CLI through its public command boundary with real files and subprocesses.
		  ---

		  # Black-box CLI tests

		  1. Create a fresh directory beneath \`/tmp\` for each test.
		  2. Run the CLI as a subprocess with that directory as its working directory.
		  3. Assert its exit code, stdout, stderr, and resulting files.
		  4. Use inline snapshots for readable text payloads; use external snapshots when escaping obscures the content.
		  5. Remove the disposable directory after the test, including when assertions fail.

		  Before finishing, check [the filesystem assertions](references/filesystem.md).
		  "
		`);
	expect(
		await readFile(
			join(cwd, ".agents/skills/blackbox-testing/references/filesystem.md"),
			"utf8",
		),
	).toMatchInlineSnapshot(`
	  "# Filesystem assertions

	  - Compare installed file contents, not only their existence.
	  - Verify supporting resources are copied with the skill.
	  - Inspect symlink targets with \`readlink\`, then read through the link.
	  - For rejected operations, verify existing user files remain unchanged.
	  "
	`);
	expect(await readlink(join(cwd, ".claude/skills"))).toMatchInlineSnapshot(
		`"../.agents/skills"`,
	);
	expect(await readFile(join(cwd, ".claude/skills/blackbox-testing/SKILL.md"), "utf8")).toBe(
		await readFile(join(cwd, ".agents/skills/blackbox-testing/SKILL.md"), "utf8"),
	);
});

test("rejects an unknown bundle without creating agent directories", async () => {
	const cwd = await client();

	expect(await add(cwd, "missing")).toMatchInlineSnapshot(`
	  {
	    "exitCode": 1,
	    "stderr": [
	      "error: No skills found in bundles: missing.",
	      "",
	    ],
	    "stdout": [
	      "",
	    ],
	  }
	`);
	expect(await readdir(cwd)).toMatchInlineSnapshot(`[]`);
});

test("rejects traversal in a bundle selector", async () => {
	const cwd = await client();

	expect(await add(cwd, "../development")).toMatchInlineSnapshot(`
	  {
	    "exitCode": 1,
	    "stderr": [
	      "error: Bundle names must be single directory names (letters, numbers, hyphens or underscores).",
	      "",
	    ],
	    "stdout": [
	      "",
	    ],
	  }
	`);
	expect(await readdir(cwd)).toMatchInlineSnapshot(`[]`);
});

test("preserves existing local skills", async () => {
	const cwd = await client();
	const local = join(cwd, ".agents/skills/local/SKILL.md");
	await mkdir(join(cwd, ".agents/skills/local"), { recursive: true });
	await writeFile(local, "Keep this local skill.\n");

	expect(await add(cwd, "development")).toMatchInlineSnapshot(`
	  {
	    "exitCode": 1,
	    "stderr": [
	      "error: Existing .agents/skills; migration is not implemented yet. No skills were changed.",
	      "",
	    ],
	    "stdout": [
	      "",
	    ],
	  }
	`);
	expect(await readFile(local, "utf8")).toMatchInlineSnapshot(`
	  "Keep this local skill.
	  "
	`);
	expect(await readdir(cwd)).toMatchInlineSnapshot(`
	  [
	    ".agents",
	  ]
	`);
});

test("preserves an existing Claude skills directory", async () => {
	const cwd = await client();
	await mkdir(join(cwd, ".claude/skills"), { recursive: true });
	await writeFile(join(cwd, ".claude/skills/local.md"), "Keep this Claude skill.\n");

	expect(await add(cwd, "development")).toMatchInlineSnapshot(`
	  {
	    "exitCode": 1,
	    "stderr": [
	      "error: Existing .claude/skills; migration is not implemented yet. No skills were changed.",
	      "",
	    ],
	    "stdout": [
	      "",
	    ],
	  }
	`);
	expect(await readFile(join(cwd, ".claude/skills/local.md"), "utf8")).toMatchInlineSnapshot(`
	  "Keep this Claude skill.
	  "
	`);
	expect(await readdir(cwd)).toMatchInlineSnapshot(`
	  [
	    ".claude",
	  ]
	`);
});
