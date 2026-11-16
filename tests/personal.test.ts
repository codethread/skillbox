import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, readlink, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import {
	commit,
	failure,
	json,
	put,
	repository,
	run,
	skill,
	snapshot,
	success,
} from "./helpers.ts";

async function setup() {
	const root = await mkdtemp("/tmp/skillbox-personal-");
	const client = join(root, "client");
	await mkdir(client);
	return { root, client, cache: join(root, "cache") };
}

async function localConfig(root: string, sources: object[], install: string[]) {
	await put(root, "skillbox/.local/config.json", JSON.stringify({ sources, install }, null, 2));
}

test("omitted bundles imports all exports from filesystem and pinned Git producers", async () => {
	const f = await setup();
	try {
		for (const transport of ["local", "git"] as const) {
			const producer = join(f.root, `producer-${transport}`);
			const url = await repository(producer);
			await put(producer, "skillbox/first/alpha/SKILL.md", skill("alpha", "first export"));
			await put(producer, "skillbox/second/beta/SKILL.md", skill("beta", "second export"));
			await put(
				producer,
				"skillbox/second/beta/references/guide.md",
				"supporting resource\n",
			);
			await put(
				producer,
				"skillbox/config.json",
				JSON.stringify({ sources: [], install: ["first"] }),
			);
			await commit(producer);
			const client = join(f.root, `client-${transport}`);
			await mkdir(client);
			await localConfig(
				client,
				[{ type: "skillbox", id: "all", source: transport === "git" ? url : producer }],
				["all"],
			);
			success(await run(client, f.cache, "sync"));
			expect((await readdir(join(client, ".agents/skills"))).sort()).toEqual([
				"alpha",
				"beta",
			]);
			expect(await readFile(join(client, ".agents/skills/beta/SKILL.md"), "utf8")).toBe(
				skill("beta", "second export"),
			);
			expect(
				await readFile(join(client, ".agents/skills/beta/references/guide.md"), "utf8"),
			).toBe("supporting resource\n");
			expect(await readlink(join(client, ".claude/skills"))).toBe("../.agents/skills");
			expect(await readFile(join(client, ".claude/skills/beta/SKILL.md"), "utf8")).toBe(
				skill("beta", "second export"),
			);
			const before = await snapshot(client);
			expect(success(await run(client, f.cache, "sync"))).toMatchObject({
				status: "unchanged",
			});
			expect(await snapshot(client)).toEqual(before);
		}
	} finally {
		await rm(f.root, { recursive: true, force: true });
	}
}, 60_000);

test("same-root personal selection switches repeatedly without changing shared config or lock", async () => {
	const f = await setup();
	try {
		await put(f.client, "skillbox/published/alpha/SKILL.md", skill("alpha", "shared alpha"));
		await put(f.client, "skillbox/published/beta/SKILL.md", skill("beta", "shared beta"));
		success(
			await run(f.client, f.cache, "add", "skillbox", ".", "shared", "--bundle", "published"),
		);
		const sharedConfig = await readFile(join(f.client, "skillbox/config.json"), "utf8");
		const sharedLock = await readFile(join(f.client, "skillbox/lock.json"), "utf8");
		await localConfig(
			f.client,
			[
				{
					type: "skillbox",
					id: "personal",
					source: ".",
					bundles: ["shared"],
					pick: { shared: ["alpha"] },
				},
			],
			["personal"],
		);
		success(await run(f.client, f.cache, "sync"));
		expect(await readdir(join(f.client, ".agents/skills"))).toEqual(["alpha"]);
		expect(await readFile(join(f.client, ".agents/skills/alpha/SKILL.md"), "utf8")).toBe(
			skill("alpha", "shared alpha"),
		);
		expect(await json(join(f.client, "skillbox/.local/lock.json"))).toBeDefined();
		const before = await snapshot(f.client);
		expect(success(await run(f.client, f.cache, "sync"))).toMatchObject({
			status: "unchanged",
		});
		expect(await snapshot(f.client)).toEqual(before);
		for (let i = 0; i < 2; i++) {
			await rename(join(f.client, "skillbox/.local/config.json"), join(f.root, "saved.json"));
			success(await run(f.client, f.cache, "sync"));
			expect((await readdir(join(f.client, ".agents/skills"))).sort()).toEqual([
				"alpha",
				"beta",
			]);
			await rename(join(f.root, "saved.json"), join(f.client, "skillbox/.local/config.json"));
			success(await run(f.client, f.cache, "sync"));
			expect(await readdir(join(f.client, ".agents/skills"))).toEqual(["alpha"]);
		}
		expect(await readFile(join(f.client, "skillbox/config.json"), "utf8")).toBe(sharedConfig);
		expect(await readFile(join(f.client, "skillbox/lock.json"), "utf8")).toBe(sharedLock);
	} finally {
		await rm(f.root, { recursive: true, force: true });
	}
}, 60_000);

test("add registers a private source without changing shared files", async () => {
	const f = await setup();
	try {
		await put(f.client, "skillbox/shared/alpha/SKILL.md", skill("alpha"));
		success(
			await run(f.client, f.cache, "add", "skillbox", ".", "shared", "--bundle", "shared"),
		);
		const sharedConfig = await readFile(join(f.client, "skillbox/config.json"), "utf8");
		const sharedLock = await readFile(join(f.client, "skillbox/lock.json"), "utf8");
		await localConfig(
			f.client,
			[{ type: "skillbox", id: "personal", source: ".", bundles: ["shared"] }],
			["personal"],
		);
		success(await run(f.client, f.cache, "sync"));
		const raw = join(f.root, "raw");
		await put(raw, "skills/beta/SKILL.md", skill("beta", "private addition"));
		success(await run(f.client, f.cache, "add", "skills", raw, "personal", "--path", "skills"));
		expect((await readdir(join(f.client, ".agents/skills"))).sort()).toEqual(["alpha", "beta"]);
		expect(await readFile(join(f.client, ".agents/skills/beta/SKILL.md"), "utf8")).toBe(
			skill("beta", "private addition"),
		);
		expect((await json(join(f.client, "skillbox/.local/config.json"))).sources).toHaveLength(2);
		expect(await readFile(join(f.client, "skillbox/config.json"), "utf8")).toBe(sharedConfig);
		expect(await readFile(join(f.client, "skillbox/lock.json"), "utf8")).toBe(sharedLock);
	} finally {
		await rm(f.root, { recursive: true, force: true });
	}
}, 60_000);

test("malformed local config, missing selectors, cycles and collisions fail without writes", async () => {
	const f = await setup();
	try {
		await put(f.client, "skillbox/shared/alpha/SKILL.md", skill("alpha"));
		success(
			await run(f.client, f.cache, "add", "skillbox", ".", "shared", "--bundle", "shared"),
		);
		await put(f.client, "skillbox/.local/config.json", "{invalid");
		let before = await snapshot(f.client);
		failure(await run(f.client, f.cache, "sync"), "CONFIG_INVALID");
		expect(await snapshot(f.client)).toEqual(before);
		for (const sources of [
			[
				{
					type: "skillbox",
					id: "personal",
					source: ".",
					bundles: ["shared"],
					pick: { shared: ["missing"] },
				},
			],
			[{ type: "skillbox", id: "personal", source: ".", bundles: ["personal"] }],
		]) {
			await localConfig(f.client, sources, ["personal"]);
			before = await snapshot(f.client);
			const result = await run(f.client, f.cache, "sync");
			expect(result.exitCode).not.toBe(0);
			expect(result.response.success).toBe(false);
			expect(result.response.errors.length).toBeGreaterThan(0);
			expect(await snapshot(f.client)).toEqual(before);
		}
		await put(
			f.client,
			"skillbox/personal/duplicate/SKILL.md",
			skill("alpha", "native collision"),
		);
		await localConfig(
			f.client,
			[
				{ type: "skillbox", id: "personal", source: ".", bundles: ["shared"] },
				{ type: "skills", id: "personal", source: ".", path: "skillbox/personal" },
			],
			["personal"],
		);
		before = await snapshot(f.client);
		failure(await run(f.client, f.cache, "sync"), "SKILL_NAME_COLLISION");
		expect(await snapshot(f.client)).toEqual(before);
	} finally {
		await rm(f.root, { recursive: true, force: true });
	}
}, 60_000);

test("unmanaged installation blocks personal sync without overwriting user files", async () => {
	const f = await setup();
	try {
		await put(f.client, "skillbox/personal/alpha/SKILL.md", skill("alpha", "authored"));
		await localConfig(
			f.client,
			[{ type: "skillbox", id: "personal", source: ".", bundles: ["personal"] }],
			["personal"],
		);
		await put(f.client, ".agents/skills/alpha/SKILL.md", skill("alpha", "user content"));
		const before = await snapshot(f.client);
		const result = await run(f.client, f.cache, "sync");
		expect(result.exitCode).not.toBe(0);
		expect(result.response.success).toBe(false);
		expect(["UNMANAGED_SKILL", "MIGRATION_REQUIRED"]).toContain(
			result.response.errors[0]?.code,
		);
		expect(await snapshot(f.client)).toEqual(before);
		expect(await readFile(join(f.client, ".agents/skills/alpha/SKILL.md"), "utf8")).toBe(
			skill("alpha", "user content"),
		);
	} finally {
		await rm(f.root, { recursive: true, force: true });
	}
}, 60_000);

test("filesystem and Git producers ignore their personal config and retain nested shared pins", async () => {
	const f = await setup();
	try {
		const raw = join(f.root, "raw");
		const rawUrl = await repository(raw);
		await put(raw, "skills/alpha/SKILL.md", skill("alpha", "pinned producer version"));
		await commit(raw);
		const producer = join(f.root, "producer");
		const producerUrl = await repository(producer);
		success(
			await run(
				producer,
				f.cache,
				"add",
				"skills",
				rawUrl,
				"published",
				"--path",
				"skills",
				"--no-install",
			),
		);
		const producerLock = await readFile(join(producer, "skillbox/lock.json"), "utf8");
		await put(producer, "skillbox/.local/config.json", "{invalid personal configuration");
		await commit(producer);
		await put(raw, "skills/alpha/SKILL.md", skill("alpha", "new upstream version"));
		await commit(raw);
		for (const [index, source] of [producer, producerUrl].entries()) {
			const client = join(f.root, `nested-${index}`);
			await mkdir(client);
			success(
				await run(
					client,
					f.cache,
					"add",
					"skillbox",
					source,
					"consumer",
					"--bundle",
					"published",
				),
			);
			expect(await readFile(join(client, ".agents/skills/alpha/SKILL.md"), "utf8")).toBe(
				skill("alpha", "pinned producer version"),
			);
			expect(await readFile(join(producer, "skillbox/lock.json"), "utf8")).toBe(producerLock);
		}
		await localConfig(
			producer,
			[{ type: "skillbox", id: "personal", source: ".", bundles: ["published"] }],
			["personal"],
		);
		success(await run(producer, f.cache, "sync"));
		expect(await readFile(join(producer, ".agents/skills/alpha/SKILL.md"), "utf8")).toBe(
			skill("alpha", "pinned producer version"),
		);
		expect(await readFile(join(producer, "skillbox/lock.json"), "utf8")).toBe(producerLock);
	} finally {
		await rm(f.root, { recursive: true, force: true });
	}
}, 60_000);

test("personal patch and update leave shared config, lock and patches untouched", async () => {
	const f = await setup();
	try {
		const raw = join(f.root, "raw");
		const url = await repository(raw);
		await put(raw, "skills/alpha/SKILL.md", skill("alpha", "original"));
		await commit(raw);
		success(await run(f.client, f.cache, "add", "skills", url, "shared", "--path", "skills"));
		const sharedConfig = await readFile(join(f.client, "skillbox/config.json"), "utf8");
		const sharedLock = await readFile(join(f.client, "skillbox/lock.json"), "utf8");
		await localConfig(
			f.client,
			[{ type: "skills", id: "personal", source: url, path: "skills" }],
			["personal"],
		);
		success(await run(f.client, f.cache, "sync"));
		const update = success(await run(f.client, f.cache, "update", "personal"));
		expect(update.workspace).toContain("skillbox/.prepare/personal/update-");
		const prepared = success(await run(f.client, f.cache, "patch", "prepare", "personal"));
		await put(prepared.editable, "skills/alpha/SKILL.md", skill("alpha", "private change"));
		const captured = success(
			await run(
				f.client,
				f.cache,
				"patch",
				"capture",
				"personal",
				"--from",
				prepared.workspace,
			),
		);
		expect(captured.changed).toBeGreaterThan(0);
		expect(captured.intentFiles).toEqual(["skillbox/.local/patches/personal/alpha/patch.toml"]);
		expect(await readFile(join(f.client, captured.intentFiles[0]), "utf8")).toContain(
			'intent = ""',
		);
		expect(await readdir(join(f.client, "skillbox"))).not.toContain("patches");
		expect(await readFile(join(f.client, "skillbox/config.json"), "utf8")).toBe(sharedConfig);
		expect(await readFile(join(f.client, "skillbox/lock.json"), "utf8")).toBe(sharedLock);
	} finally {
		await rm(f.root, { recursive: true, force: true });
	}
}, 60_000);
