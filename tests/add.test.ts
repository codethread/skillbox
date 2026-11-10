import { afterEach, expect, test } from "bun:test";
import {
	cp,
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
import { fileURLToPath, pathToFileURL } from "node:url";

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
	await cp(
		join(repository, "skillbox/development"),
		join(directory, "source/skillbox/development"),
		{ recursive: true },
	);
	await mkdir(join(directory, "client"));
	return join(directory, "client");
}

interface CommandResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

interface CliResponse {
	success: boolean;
	data: unknown;
	errors: unknown[];
}

async function run(cwd: string, ...args: string[]): Promise<CommandResult> {
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
	return { exitCode, stdout, stderr };
}

function expectSuccess(result: CommandResult): CliResponse {
	expect(result.exitCode).toBe(0);
	expect(result.stderr).toBe("");
	const response = JSON.parse(result.stdout) as CliResponse;
	expect(response.success).toBe(true);
	expect(response.errors).toEqual([]);
	return response;
}

function expectFailure(result: CommandResult): CliResponse {
	expect(result.exitCode).not.toBe(0);
	expect(result.stderr).toBe("");
	const response = JSON.parse(result.stdout) as CliResponse;
	expect(response.success).toBe(false);
	return response;
}

async function add(cwd: string, ...bundles: string[]) {
	return run(cwd, "add", "../source", ...bundles);
}

async function json(cwd: string, path: string) {
	return JSON.parse(await readFile(join(cwd, path), "utf8"));
}

test("installs a repository bundle and records config and SDK lock", async () => {
	const cwd = await client();

	expect(expectSuccess(await add(cwd, "development"))).toMatchInlineSnapshot(`
	  {
	    "data": {
	      "bundles": [
	        "development",
	      ],
	      "installed": 1,
	      "source": "../source",
	      "status": "added",
	    },
	    "errors": [],
	    "success": true,
	  }
	`);
	expect((await readdir(cwd)).sort()).toMatchInlineSnapshot(`
	  [
	    ".agents",
	    ".claude",
	    "skillbox",
	  ]
	`);
	expect(await json(cwd, "skillbox/config.json")).toMatchInlineSnapshot(`
	  {
	    "sources": [
	      {
	        "bundles": [
	          "development",
	        ],
	        "source": "../source",
	      },
	    ],
	  }
	`);
	expect(await json(cwd, "skillbox/lock.json")).toMatchInlineSnapshot(`
	  {
	    "skills": {
	      "blackbox-testing": {
	        "computedHash": "2fb21912486d30e1fa40c64f5a0d864abe6df3636e39f84cd2fc379a6c3d7bca",
	        "installMode": "copy",
	        "source": "../source/skillbox",
	        "sourceType": "local",
	      },
	    },
	    "version": 1,
	  }
	`);
	expect((await readdir(join(cwd, ".agents/skills"))).sort()).toMatchInlineSnapshot(`
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

	expect(expectFailure(await add(cwd, "missing"))).toMatchInlineSnapshot(`
	  {
	    "data": null,
	    "errors": [
	      {
	        "code": "BUNDLE_NOT_FOUND",
	        "input": "missing",
	        "message": "No skills found in bundle: missing.",
	        "source": "../source",
	      },
	    ],
	    "success": false,
	  }
	`);
	expect((await readdir(cwd)).sort()).toMatchInlineSnapshot(`[]`);
});

test("rejects traversal in a bundle selector", async () => {
	const cwd = await client();

	expect(expectFailure(await add(cwd, "../development"))).toMatchInlineSnapshot(`
	  {
	    "data": null,
	    "errors": [
	      {
	        "code": "INVALID_INPUT",
	        "input": "bundles.0",
	        "message": "Bundle names must be single directory names (letters, numbers, hyphens or underscores).",
	      },
	    ],
	    "success": false,
	  }
	`);
	expect((await readdir(cwd)).sort()).toMatchInlineSnapshot(`[]`);
});

test("preserves existing local skills", async () => {
	const cwd = await client();
	const local = join(cwd, ".agents/skills/local/SKILL.md");
	await mkdir(join(cwd, ".agents/skills/local"), { recursive: true });
	await writeFile(local, "Keep this local skill.\n");

	expect(expectFailure(await add(cwd, "development"))).toMatchInlineSnapshot(`
	  {
	    "data": null,
	    "errors": [
	      {
	        "code": "MIGRATION_REQUIRED",
	        "input": ".agents/skills",
	        "message": "Existing .agents/skills; migration is not implemented yet. No skills were changed.",
	      },
	    ],
	    "success": false,
	  }
	`);
	expect(await readFile(local, "utf8")).toMatchInlineSnapshot(`
	  "Keep this local skill.
	  "
	`);
	expect((await readdir(cwd)).sort()).toMatchInlineSnapshot(`
	  [
	    ".agents",
	  ]
	`);
});

test("preserves an existing Claude skills directory", async () => {
	const cwd = await client();
	await mkdir(join(cwd, ".claude/skills"), { recursive: true });
	await writeFile(join(cwd, ".claude/skills/local.md"), "Keep this Claude skill.\n");

	expect(expectFailure(await add(cwd, "development"))).toMatchInlineSnapshot(`
	  {
	    "data": null,
	    "errors": [
	      {
	        "code": "MIGRATION_REQUIRED",
	        "input": ".claude/skills",
	        "message": "Existing .claude/skills; migration is not implemented yet. No skills were changed.",
	      },
	    ],
	    "success": false,
	  }
	`);
	expect(await readFile(join(cwd, ".claude/skills/local.md"), "utf8")).toMatchInlineSnapshot(`
	  "Keep this Claude skill.
	  "
	`);
	expect((await readdir(cwd)).sort()).toMatchInlineSnapshot(`
	  [
	    ".claude",
	  ]
	`);
});

test("repeated adds leave config, lock and installed files untouched", async () => {
	const cwd = await client();
	expectSuccess(await add(cwd, "development"));
	const paths = [
		"skillbox/config.json",
		"skillbox/lock.json",
		".agents/skills/blackbox-testing/SKILL.md",
	];
	const before = await Promise.all(
		paths.map(async (path) => ({
			content: await readFile(join(cwd, path), "utf8"),
			modified: (await stat(join(cwd, path))).mtimeMs,
		})),
	);

	expect(expectSuccess(await add(cwd, "development", "development"))).toMatchInlineSnapshot(`
	  {
	    "data": {
	      "bundles": [
	        "development",
	      ],
	      "installed": 0,
	      "source": "../source",
	      "status": "unchanged",
	    },
	    "errors": [],
	    "success": true,
	  }
	`);
	for (const [index, path] of paths.entries()) {
		expect(await readFile(join(cwd, path), "utf8")).toBe(before[index]!.content);
		expect((await stat(join(cwd, path))).mtimeMs).toBe(before[index]!.modified);
	}
	expect(await json(cwd, "skillbox/config.json")).toMatchInlineSnapshot(`
	  {
	    "sources": [
	      {
	        "bundles": [
	          "development",
	        ],
	        "source": "../source",
	      },
	    ],
	  }
	`);
});

test("adds a second bundle without refreshing an existing skill", async () => {
	const cwd = await client();
	expectSuccess(await add(cwd, "development"));
	const original = await readFile(join(cwd, ".agents/skills/blackbox-testing/SKILL.md"), "utf8");
	const originalLock = await json(cwd, "skillbox/lock.json");
	await writeFile(
		join(cwd, "../source/skillbox/development/blackbox-testing/SKILL.md"),
		`${original}\nUpstream changed after the initial install.\n`,
	);
	await mkdir(join(cwd, "../source/skillbox/backend/api-contracts"), { recursive: true });
	await writeFile(
		join(cwd, "../source/skillbox/backend/api-contracts/SKILL.md"),
		`---
name: api-contracts
description: Use when defining an API contract.
---

# API contracts

Define the request and response before implementation.
`,
	);

	expect(expectSuccess(await add(cwd, "backend"))).toMatchInlineSnapshot(`
	  {
	    "data": {
	      "bundles": [
	        "backend",
	      ],
	      "installed": 1,
	      "source": "../source",
	      "status": "added",
	    },
	    "errors": [],
	    "success": true,
	  }
	`);
	expect(await json(cwd, "skillbox/config.json")).toMatchInlineSnapshot(`
	  {
	    "sources": [
	      {
	        "bundles": [
	          "backend",
	          "development",
	        ],
	        "source": "../source",
	      },
	    ],
	  }
	`);
	expect(await json(cwd, "skillbox/lock.json")).toMatchInlineSnapshot(`
	  {
	    "skills": {
	      "api-contracts": {
	        "computedHash": "d19b9a4a3b8da66513a037196ec2b8fe6f7ad29fcae9067b83cdefe48d8de0e4",
	        "installMode": "copy",
	        "source": "../source/skillbox",
	        "sourceType": "local",
	      },
	      "blackbox-testing": {
	        "computedHash": "2fb21912486d30e1fa40c64f5a0d864abe6df3636e39f84cd2fc379a6c3d7bca",
	        "installMode": "copy",
	        "source": "../source/skillbox",
	        "sourceType": "local",
	      },
	    },
	    "version": 1,
	  }
	`);
	expect((await readdir(join(cwd, ".agents/skills"))).sort()).toMatchInlineSnapshot(`
	  [
	    "api-contracts",
	    "blackbox-testing",
	  ]
	`);
	expect(await readFile(join(cwd, ".agents/skills/blackbox-testing/SKILL.md"), "utf8")).toBe(
		original,
	);
	expect((await json(cwd, "skillbox/lock.json")).skills["blackbox-testing"]).toEqual(
		originalLock.skills["blackbox-testing"],
	);
});

test("adds a second source and keeps both SDK lock sources portable", async () => {
	const cwd = await client();
	expectSuccess(await add(cwd, "development"));
	await mkdir(join(cwd, "../other/skillbox/frontend/web-contracts"), { recursive: true });
	await writeFile(
		join(cwd, "../other/skillbox/frontend/web-contracts/SKILL.md"),
		`---
name: web-contracts
description: Use when defining a web interface.
---

# Web contracts

Define the interaction before implementation.
`,
	);

	expect(expectSuccess(await run(cwd, "add", "../other", "frontend"))).toMatchInlineSnapshot(`
	  {
	    "data": {
	      "bundles": [
	        "frontend",
	      ],
	      "installed": 1,
	      "source": "../other",
	      "status": "added",
	    },
	    "errors": [],
	    "success": true,
	  }
	`);
	expect(await json(cwd, "skillbox/config.json")).toMatchInlineSnapshot(`
	  {
	    "sources": [
	      {
	        "bundles": [
	          "development",
	        ],
	        "source": "../source",
	      },
	      {
	        "bundles": [
	          "frontend",
	        ],
	        "source": "../other",
	      },
	    ],
	  }
	`);
	expect(await json(cwd, "skillbox/lock.json")).toMatchInlineSnapshot(`
	  {
	    "skills": {
	      "blackbox-testing": {
	        "computedHash": "2fb21912486d30e1fa40c64f5a0d864abe6df3636e39f84cd2fc379a6c3d7bca",
	        "installMode": "copy",
	        "source": "../source/skillbox",
	        "sourceType": "local",
	      },
	      "web-contracts": {
	        "computedHash": "d1c17eb93da4c06388aa7c5a52a371705043be81877c86ea42c33df365f96247",
	        "installMode": "copy",
	        "source": "../other/skillbox",
	        "sourceType": "local",
	      },
	    },
	    "version": 1,
	  }
	`);
});

test("uses workspace-relative roots for frontend and backend", async () => {
	const cwd = await client();
	await mkdir(join(cwd, "frontend"));
	await mkdir(join(cwd, "backend"));

	for (const workspace of ["frontend", "backend"]) {
		expect(
			expectSuccess(
				await run(cwd, "--workspace", workspace, "add", "../source", "development"),
			),
		).toMatchInlineSnapshot(`
		  {
		    "data": {
		      "bundles": [
		        "development",
		      ],
		      "installed": 1,
		      "source": "../source",
		      "status": "added",
		    },
		    "errors": [],
		    "success": true,
		  }
		`);
		expect((await readdir(join(cwd, workspace))).sort()).toMatchInlineSnapshot(`
		  [
		    ".agents",
		    ".claude",
		    "skillbox",
		  ]
		`);
		expect(await json(join(cwd, workspace), "skillbox/config.json")).toMatchInlineSnapshot(`
		  {
		    "sources": [
		      {
		        "bundles": [
		          "development",
		        ],
		        "source": "../../source",
		      },
		    ],
		  }
		`);
		expect(await json(join(cwd, workspace), "skillbox/lock.json")).toMatchInlineSnapshot(`
		  {
		    "skills": {
		      "blackbox-testing": {
		        "computedHash": "2fb21912486d30e1fa40c64f5a0d864abe6df3636e39f84cd2fc379a6c3d7bca",
		        "installMode": "copy",
		        "source": "../../source/skillbox",
		        "sourceType": "local",
		      },
		    },
		    "version": 1,
		  }
		`);
		expect(await readlink(join(cwd, workspace, ".claude/skills"))).toMatchInlineSnapshot(
			`"../.agents/skills"`,
		);
	}
	expect((await readdir(cwd)).sort()).toMatchInlineSnapshot(`
	  [
	    "backend",
	    "frontend",
	  ]
	`);
});

test("records portable SDK sources when the bundle lives in the client itself", async () => {
	const cwd = await client();
	await cp(join(cwd, "../source/skillbox"), join(cwd, "skillbox"), { recursive: true });

	expect(expectSuccess(await run(cwd, "add", ".", "development"))).toMatchInlineSnapshot(`
	  {
	    "data": {
	      "bundles": [
	        "development",
	      ],
	      "installed": 1,
	      "source": ".",
	      "status": "added",
	    },
	    "errors": [],
	    "success": true,
	  }
	`);
	expect(await json(cwd, "skillbox/config.json")).toMatchInlineSnapshot(`
	  {
	    "sources": [
	      {
	        "bundles": [
	          "development",
	        ],
	        "source": ".",
	      },
	    ],
	  }
	`);
	expect(await json(cwd, "skillbox/lock.json")).toMatchInlineSnapshot(`
	  {
	    "skills": {
	      "blackbox-testing": {
	        "computedHash": "2fb21912486d30e1fa40c64f5a0d864abe6df3636e39f84cd2fc379a6c3d7bca",
	        "installMode": "copy",
	        "source": "./skillbox",
	        "sourceType": "local",
	      },
	    },
	    "version": 1,
	  }
	`);
	expect(
		await readFile(join(cwd, "skillbox/development/blackbox-testing/SKILL.md"), "utf8"),
	).toBe(await readFile(join(cwd, ".agents/skills/blackbox-testing/SKILL.md"), "utf8"));
});

test("accepts an absolute workspace directory from another invocation directory", async () => {
	const cwd = await client();
	await mkdir(join(cwd, "frontend"));
	await mkdir(join(cwd, "invocation"));
	const workspace = join(cwd, "frontend");

	expect(
		expectSuccess(await run(cwd, "--workspace", workspace, "add", "../source", "development")),
	).toMatchInlineSnapshot(`
	  {
	    "data": {
	      "bundles": [
	        "development",
	      ],
	      "installed": 1,
	      "source": "../source",
	      "status": "added",
	    },
	    "errors": [],
	    "success": true,
	  }
	`);
	expect(
		expectSuccess(
			await run(
				join(cwd, "invocation"),
				"--workspace",
				workspace,
				"add",
				"../../source",
				"development",
			),
		),
	).toMatchInlineSnapshot(`
	  {
	    "data": {
	      "bundles": [
	        "development",
	      ],
	      "installed": 0,
	      "source": "../../source",
	      "status": "unchanged",
	    },
	    "errors": [],
	    "success": true,
	  }
	`);
	expect(await json(cwd, "frontend/skillbox/config.json")).toMatchInlineSnapshot(`
	  {
	    "sources": [
	      {
	        "bundles": [
	          "development",
	        ],
	        "source": "../../source",
	      },
	    ],
	  }
	`);
	expect((await readdir(join(cwd, "frontend"))).sort()).toMatchInlineSnapshot(`
	  [
	    ".agents",
	    ".claude",
	    "skillbox",
	  ]
	`);
	expect((await readdir(join(cwd, "invocation"))).sort()).toMatchInlineSnapshot(`[]`);
	expect((await readdir(cwd)).sort()).toMatchInlineSnapshot(`
	  [
	    "frontend",
	    "invocation",
	  ]
	`);
});

test("keeps Skillbox lock ownership separate from root skills locks", async () => {
	const cwd = await client();
	const workspace = join(cwd, "frontend");
	await mkdir(workspace);
	const roots = [join(cwd, "skills-lock.json"), join(workspace, "skills-lock.json")];
	const rootText = "Not a Skillbox lock; leave this npx skills file alone.\n";
	for (const path of roots) await writeFile(path, rootText);
	const modified = await Promise.all(roots.map(async (path) => (await stat(path)).mtimeMs));

	const command = (...args: string[]) => run(cwd, "--workspace", "frontend", ...args);
	expectSuccess(await command("add", "../source", "development"));
	const initial = await json(workspace, "skillbox/lock.json");
	expect(Object.keys(initial.skills)).toEqual(["blackbox-testing"]);

	const sourceSkill = await readFile(
		join(cwd, "../source/skillbox/development/blackbox-testing/SKILL.md"),
		"utf8",
	);
	await mkdir(join(cwd, "../source/skillbox/backend/api-contracts"), { recursive: true });
	await writeFile(
		join(cwd, "../source/skillbox/backend/api-contracts/SKILL.md"),
		sourceSkill.replace("name: blackbox-testing", "name: api-contracts"),
	);
	expectSuccess(await command("add", "../source", "backend"));
	const lock = await readFile(join(workspace, "skillbox/lock.json"), "utf8");
	expect(Object.keys(JSON.parse(lock).skills)).toEqual(["api-contracts", "blackbox-testing"]);
	expect((await json(workspace, "skillbox/lock.json")).skills["blackbox-testing"]).toEqual(
		initial.skills["blackbox-testing"],
	);
	expectSuccess(await command("add", "../source", "backend"));

	await rm(join(workspace, ".agents"), { recursive: true });
	await rm(join(workspace, ".claude"), { recursive: true });
	expect(expectSuccess(await command("sync"))).toMatchObject({ data: { status: "synced" } });
	expect(expectSuccess(await command("sync"))).toMatchObject({ data: { status: "unchanged" } });
	expect(await readFile(join(workspace, "skillbox/lock.json"), "utf8")).toBe(lock);

	await rm(join(workspace, "skillbox/lock.json"));
	expect(expectFailure(await command("sync"))).toMatchObject({
		errors: [{ code: "LOCK_NOT_FOUND", input: "skillbox/lock.json" }],
	});
	expect(expectFailure(await command("add", "../source", "backend"))).toMatchObject({
		errors: [{ code: "LOCK_MISSING", input: "skillbox/lock.json" }],
	});
	for (const [index, path] of roots.entries()) {
		expect(await readFile(path, "utf8")).toBe(rootText);
		expect((await stat(path)).mtimeMs).toBe(modified[index]!);
	}
});

test("installs a Git source through the SDK without an npm package", async () => {
	const cwd = await client();
	const repository = join(cwd, "../source");
	for (const command of [
		["git", "init", "--quiet", "--initial-branch=main"],
		["git", "add", "skillbox"],
		[
			"git",
			"-c",
			"user.name=Skillbox Test",
			"-c",
			"user.email=skillbox@example.test",
			"-c",
			"commit.gpgsign=false",
			"commit",
			"--quiet",
			"-m",
			"Bundle fixture",
		],
	]) {
		const result = Bun.spawnSync(command, { cwd: repository, stdout: "pipe", stderr: "pipe" });
		expect(result.exitCode).toBe(0);
	}
	const source = pathToFileURL(repository).href;

	const response = expectSuccess(await run(cwd, "add", source, "development"));
	expect(response).toMatchObject({ data: { source } });
	(response.data as { source: string }).source = "<git-source>";
	expect(response).toMatchInlineSnapshot(`
	  {
	    "data": {
	      "bundles": [
	        "development",
	      ],
	      "installed": 1,
	      "source": "<git-source>",
	      "status": "added",
	    },
	    "errors": [],
	    "success": true,
	  }
	`);
	const config = await json(cwd, "skillbox/config.json");
	expect(config.sources[0].source).toBe(source);
	config.sources[0].source = "<git-source>";
	expect(config).toMatchInlineSnapshot(`
	  {
	    "sources": [
	      {
	        "bundles": [
	          "development",
	        ],
	        "source": "<git-source>",
	      },
	    ],
	  }
	`);
	const lock = await json(cwd, "skillbox/lock.json");
	expect(lock.skills["blackbox-testing"].source).toBe(source);
	expect(lock.skills["blackbox-testing"].sourceUrl).toBe(source);
	lock.skills["blackbox-testing"].source = "<git-source>";
	lock.skills["blackbox-testing"].sourceUrl = "<git-source>";
	expect(lock).toMatchInlineSnapshot(`
	  {
	    "skills": {
	      "blackbox-testing": {
	        "computedHash": "2fb21912486d30e1fa40c64f5a0d864abe6df3636e39f84cd2fc379a6c3d7bca",
	        "installMode": "copy",
	        "skillPath": "skillbox/development/blackbox-testing/SKILL.md",
	        "source": "<git-source>",
	        "sourceType": "git",
	        "sourceUrl": "<git-source>",
	      },
	    },
	    "version": 1,
	  }
	`);
	expect(await readFile(join(cwd, ".agents/skills/blackbox-testing/SKILL.md"), "utf8")).toBe(
		await readFile(join(repository, "skillbox/development/blackbox-testing/SKILL.md"), "utf8"),
	);
});
