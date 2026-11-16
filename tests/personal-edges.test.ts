import { expect, test } from "bun:test";
import { readFile, readdir, rename, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import {
	commit,
	failure,
	fixture,
	put,
	repository,
	run,
	skill,
	snapshot,
	success,
} from "./helpers.ts";

test("personal destination can select a same-named shared native bundle", async () => {
	const f = await fixture();
	try {
		await put(f.client, "skillbox/team/alpha/SKILL.md", skill("alpha", "shared alpha"));
		await put(f.client, "skillbox/team/beta/SKILL.md", skill("beta", "shared beta"));
		await put(
			f.client,
			"skillbox/.local/config.json",
			JSON.stringify({
				sources: [
					{
						type: "skillbox",
						id: "team",
						source: ".",
						bundles: ["team"],
						omit: { team: ["beta"] },
					},
				],
				install: ["team"],
			}),
		);
		success(await run(f.client, f.cache, "sync"));
		expect(await readdir(join(f.client, ".agents/skills"))).toEqual(["alpha"]);
		expect(await readFile(join(f.client, ".agents/skills/alpha/SKILL.md"), "utf8")).toBe(
			skill("alpha", "shared alpha"),
		);
	} finally {
		await rm(f.root, { recursive: true, force: true });
	}
}, 60_000);

test("deleted initialized private lock fails after switching back without advancing pins", async () => {
	const f = await fixture();
	try {
		const raw = join(f.root, "raw");
		const url = await repository(raw);
		await put(raw, "skills/alpha/SKILL.md", skill("alpha", "old"));
		await commit(raw);
		success(await run(f.client, f.cache, "add", "skills", url, "team", "--path", "skills"));
		await put(
			f.client,
			"skillbox/.local/config.json",
			JSON.stringify({
				sources: [{ type: "skills", id: "team", source: url, path: "skills" }],
				install: ["team"],
			}),
		);
		success(await run(f.client, f.cache, "sync"));
		await rename(join(f.client, "skillbox/.local/config.json"), join(f.root, "local.json"));
		success(await run(f.client, f.cache, "sync"));
		await rm(join(f.client, "skillbox/.local/lock.json"));
		await put(raw, "skills/alpha/SKILL.md", skill("alpha", "new"));
		await commit(raw);
		await rename(join(f.root, "local.json"), join(f.client, "skillbox/.local/config.json"));
		const before = await snapshot(f.client);
		const result = await run(f.client, f.cache, "sync");
		expect(result.exitCode).not.toBe(0);
		expect(result.response.success).toBe(false);
		expect(await snapshot(f.client)).toEqual(before);
		expect(await readFile(join(f.client, ".agents/skills/alpha/SKILL.md"), "utf8")).toBe(
			skill("alpha", "old"),
		);
	} finally {
		await rm(f.root, { recursive: true, force: true });
	}
}, 60_000);

for (const first of ["shared", "local"] as const) {
	test(`${first} preparation retains its edit when the other config prepares or captures the same bundle`, async () => {
		const f = await fixture();
		try {
			const raw = join(f.root, "raw");
			await put(raw, "skills/alpha/SKILL.md", skill("alpha"));
			success(await run(f.client, f.cache, "add", "skills", raw, "team", "--path", "skills"));
			const config = await readFile(join(f.client, "skillbox/config.json"), "utf8");
			if (first === "local") {
				await put(f.client, "skillbox/.local/config.json", config);
				success(await run(f.client, f.cache, "sync"));
			}
			const prepared = success(await run(f.client, f.cache, "patch", "prepare", "team"));
			expect(prepared.workspace).toBe(join(f.client, "skillbox/.prepare/team/edit"));
			expect(prepared.config).toBe(
				first === "shared" ? "skillbox/config.json" : "skillbox/.local/config.json",
			);
			await put(prepared.editable, "skills/alpha/SKILL.md", skill("alpha", `${first} edit`));
			if (first === "shared") await put(f.client, "skillbox/.local/config.json", config);
			else await rm(join(f.client, "skillbox/.local/config.json"));
			success(await run(f.client, f.cache, "sync"));
			const before = await snapshot(f.client);
			const preparationBefore = await snapshot(join(f.client, "skillbox/.prepare"));
			failure(await run(f.client, f.cache, "patch", "prepare", "team"), "DESTINATION_EXISTS");
			expect(await snapshot(f.client)).toEqual(before);
			expect(await snapshot(join(f.client, "skillbox/.prepare"))).toEqual(preparationBefore);
			failure(
				await run(
					f.client,
					f.cache,
					"patch",
					"capture",
					"team",
					"--from",
					prepared.workspace,
				),
				"REGEN_WORKSPACE_INVALID",
			);
			expect(await snapshot(f.client)).toEqual(before);
			expect(await snapshot(join(f.client, "skillbox/.prepare"))).toEqual(preparationBefore);
			expect(await readFile(join(prepared.editable, "skills/alpha/SKILL.md"), "utf8")).toBe(
				skill("alpha", `${first} edit`),
			);
			const editBefore = await snapshot(prepared.workspace);
			const updated = success(await run(f.client, f.cache, "update", "team"));
			expect(updated.workspace).toStartWith(join(f.client, "skillbox/.prepare/team/update-"));
			expect(await snapshot(prepared.workspace)).toEqual(editBefore);
		} finally {
			await rm(f.root, { recursive: true, force: true });
		}
	}, 60_000);
}

test("all mutators reject a dangling personal config without replacing it", async () => {
	const f = await fixture();
	try {
		await put(f.client, "skillbox/team/alpha/SKILL.md", skill("alpha"));
		success(await run(f.client, f.cache, "add", "skillbox", ".", "team", "--bundle", "team"));
		await symlink("missing.json", join(f.client, "skillbox/.local/config.json"));
		const before = await snapshot(f.client);
		for (const args of [
			["sync"],
			["add", "skillbox", ".", "team", "--bundle", "team"],
			["patch", "prepare", "team"],
			["update", "team"],
		]) {
			const result = await run(f.client, f.cache, ...args);
			expect(result.exitCode).not.toBe(0);
			expect(result.response.success).toBe(false);
			expect(await snapshot(f.client)).toEqual(before);
		}
	} finally {
		await rm(f.root, { recursive: true, force: true });
	}
}, 60_000);

test("existing private pin replays cold without a receipt or repinning", async () => {
	const f = await fixture();
	try {
		const raw = join(f.root, "raw");
		const url = await repository(raw);
		await put(raw, "skills/alpha/SKILL.md", skill("alpha", "pinned"));
		await commit(raw);
		await put(
			f.client,
			"skillbox/.local/config.json",
			JSON.stringify({
				sources: [{ type: "skills", id: "team", source: url, path: "skills" }],
				install: ["team"],
			}),
		);
		success(await run(f.client, f.cache, "sync"));
		const lock = await readFile(join(f.client, "skillbox/.local/lock.json"), "utf8");
		await rm(join(f.client, "skillbox/.local/install-state.json"));
		await rm(join(f.client, ".agents"), { recursive: true, force: true });
		await rm(join(f.client, ".claude"), { recursive: true, force: true });
		await rm(f.cache, { recursive: true, force: true });
		await put(raw, "skills/alpha/SKILL.md", skill("alpha", "advanced"));
		await commit(raw);
		success(await run(f.client, f.cache, "sync"));
		expect(await readFile(join(f.client, ".agents/skills/alpha/SKILL.md"), "utf8")).toBe(
			skill("alpha", "pinned"),
		);
		expect(await readFile(join(f.client, "skillbox/.local/lock.json"), "utf8")).toBe(lock);
	} finally {
		await rm(f.root, { recursive: true, force: true });
	}
}, 60_000);
