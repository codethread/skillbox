import { expect, test } from "bun:test";
import {
	copyFile,
	lstat,
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	readlink,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const project = fileURLToPath(new URL("..", import.meta.url));

interface Outcome {
	exitCode: number;
	stdout: string;
	stderr: string;
}

test("npm CLI preserves structured subset errors under Node without changing managed files", async () => {
	const build = await run(project, [process.execPath, "run", "build:npm"]);
	expect(build.exitCode).toBe(0);
	const root = await mkdtemp(join(tmpdir(), "skillbox-packaging-"));
	try {
		const packaged = join(root, "package");
		for (const path of ["bin/skillbox.mjs", "dist/cli.mjs"]) {
			await mkdir(dirname(join(packaged, path)), { recursive: true });
			await copyFile(join(project, path), join(packaged, path));
		}
		const cwd = join(root, "client");
		await mkdir(cwd);
		for (const [bundle, name] of [
			["base", "base-only"],
			["review", "alpha"],
			["review", "beta"],
		]) {
			const path = join(root, "source/skillbox", bundle!, name!, "SKILL.md");
			await mkdir(dirname(path), { recursive: true });
			await writeFile(
				path,
				`---\nname: ${name}\ndescription: Test ${name} skill.\n---\n\n# ${name}\n`,
			);
		}
		const nodeCli = ["node", join(packaged, "bin/skillbox.mjs")];
		const added = await run(cwd, [
			...nodeCli,
			"add",
			"skillbox",
			"../source",
			"base",
			"--bundle",
			"base",
		]);
		expect(added.exitCode).toBe(0);
		expect(added.stderr).toBe("");
		expect(JSON.parse(added.stdout)).toMatchObject({ success: true, errors: [] });
		expect(await readFile(join(cwd, ".agents/skills/base-only/SKILL.md"), "utf8")).toContain(
			"name: base-only",
		);
		await writeFile(
			join(cwd, "skillbox/config.json"),
			`${JSON.stringify(
				{
					sources: [
						{
							type: "skillbox",
							id: "base",
							source: "../source",
							bundles: ["base", "review"],
							pick: { review: ["missing"] },
						},
					],
					install: ["base"],
				},
				null,
				2,
			)}\n`,
		);
		const before = await snapshot(cwd);
		for (const command of [[process.execPath, join(project, "src/cli.ts")], nodeCli]) {
			const result = await run(cwd, [...command, "sync"]);
			expect(result.exitCode).not.toBe(0);
			expect(result.stderr).toBe("");
			expect(await snapshot(cwd)).toEqual(before);
			expect(JSON.parse(result.stdout)).toEqual({
				success: false,
				data: null,
				errors: [
					{
						code: "SKILL_NOT_FOUND",
						message: "No selected skill named missing.",
						skill: "missing",
					},
				],
			});
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}, 30_000);

async function run(cwd: string, command: string[]): Promise<Outcome> {
	const child = Bun.spawn(command, {
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
	return { exitCode, stdout, stderr };
}

async function snapshot(root: string): Promise<Record<string, unknown>> {
	const entries = await readdir(root, { withFileTypes: true });
	return Object.fromEntries(
		await Promise.all(
			entries.map(async (entry) => {
				const path = join(root, entry.name);
				if (entry.isSymbolicLink()) return [entry.name, { link: await readlink(path) }];
				if (entry.isDirectory()) return [entry.name, await snapshot(path)];
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
