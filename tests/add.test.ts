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
	await cp(join(repository, "skillbox"), join(directory, "source/skillbox"), { recursive: true });
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
	return { exitCode, stdout: stdout.split("\n"), stderr: stderr.split("\n") };
}

async function add(cwd: string, ...bundles: string[]) {
	return run(cwd, "add", "../source", ...bundles);
}

async function json(cwd: string, path: string) {
	return JSON.parse(await readFile(join(cwd, path), "utf8"));
}

test("installs a repository bundle and records config and SDK lock", async () => {
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
	expect((await readdir(cwd)).sort()).toMatchInlineSnapshot(`
	  [
	    ".agents",
	    ".claude",
	    "skillbox",
	    "skills-lock.json",
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
	expect(await json(cwd, "skills-lock.json")).toMatchInlineSnapshot(`
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
	expect((await readdir(cwd)).sort()).toMatchInlineSnapshot(`[]`);
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
	expect((await readdir(cwd)).sort()).toMatchInlineSnapshot(`[]`);
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
	expect((await readdir(cwd)).sort()).toMatchInlineSnapshot(`
	  [
	    ".claude",
	  ]
	`);
});

test("repeated adds leave config, lock and installed files untouched", async () => {
	const cwd = await client();
	expect((await add(cwd, "development")).exitCode).toBe(0);
	const paths = [
		"skillbox/config.json",
		"skills-lock.json",
		".agents/skills/blackbox-testing/SKILL.md",
	];
	const before = await Promise.all(
		paths.map(async (path) => ({
			content: await readFile(join(cwd, path), "utf8"),
			modified: (await stat(join(cwd, path))).mtimeMs,
		})),
	);

	expect(await add(cwd, "development", "development")).toMatchInlineSnapshot(`
	  {
	    "exitCode": 0,
	    "stderr": [
	      "",
	    ],
	    "stdout": [
	      "Already added bundles: development.",
	      "",
	    ],
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
	expect((await add(cwd, "development")).exitCode).toBe(0);
	const original = await readFile(join(cwd, ".agents/skills/blackbox-testing/SKILL.md"), "utf8");
	const originalLock = await json(cwd, "skills-lock.json");
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

	expect(await add(cwd, "backend")).toMatchInlineSnapshot(`
	  {
	    "exitCode": 0,
	    "stderr": [
	      "",
	    ],
	    "stdout": [
	      "Added 1 skill from backend:",
	      "  api-contracts",
	      "",
	    ],
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
	expect(await json(cwd, "skills-lock.json")).toMatchInlineSnapshot(`
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
	expect((await json(cwd, "skills-lock.json")).skills["blackbox-testing"]).toEqual(
		originalLock.skills["blackbox-testing"],
	);
});

test("adds a second source and keeps both SDK lock sources portable", async () => {
	const cwd = await client();
	expect((await add(cwd, "development")).exitCode).toBe(0);
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

	expect(await run(cwd, "add", "../other", "frontend")).toMatchInlineSnapshot(`
	  {
	    "exitCode": 0,
	    "stderr": [
	      "",
	    ],
	    "stdout": [
	      "Added 1 skill from frontend:",
	      "  web-contracts",
	      "",
	    ],
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
	expect(await json(cwd, "skills-lock.json")).toMatchInlineSnapshot(`
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

test("uses config-relative workspace roots for frontend and backend", async () => {
	const cwd = await client();
	await mkdir(join(cwd, "frontend"));
	await mkdir(join(cwd, "backend"));

	for (const workspace of ["frontend", "backend"]) {
		expect(
			await run(
				cwd,
				"--config",
				`${workspace}/skillbox/config.json`,
				"add",
				"../source",
				"development",
			),
		).toMatchInlineSnapshot(`
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
		expect((await readdir(join(cwd, workspace))).sort()).toMatchInlineSnapshot(`
		  [
		    ".agents",
		    ".claude",
		    "skillbox",
		    "skills-lock.json",
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
		expect(await json(join(cwd, workspace), "skills-lock.json")).toMatchInlineSnapshot(`
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

	expect(await run(cwd, "add", ".", "development")).toMatchInlineSnapshot(`
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
	expect(await json(cwd, "skills-lock.json")).toMatchInlineSnapshot(`
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

test("accepts an absolute custom config path from another invocation directory", async () => {
	const cwd = await client();
	await mkdir(join(cwd, "frontend"));
	await mkdir(join(cwd, "invocation"));
	const config = join(cwd, "frontend/settings/local-skills.json");

	expect(await run(cwd, "--config", config, "add", "../source", "development"))
		.toMatchInlineSnapshot(`
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
	expect(
		await run(
			join(cwd, "invocation"),
			"--config",
			config,
			"add",
			"../../source",
			"development",
		),
	).toMatchInlineSnapshot(`
	  {
	    "exitCode": 0,
	    "stderr": [
	      "",
	    ],
	    "stdout": [
	      "Already added bundles: development.",
	      "",
	    ],
	  }
	`);
	expect(await json(cwd, "frontend/settings/local-skills.json")).toMatchInlineSnapshot(`
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
	    "settings",
	    "skills-lock.json",
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
