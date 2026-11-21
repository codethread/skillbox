import { expect, test } from "bun:test";
import { readFile, readlink, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import {
	commit,
	failure,
	fixture,
	json,
	put,
	repository,
	run,
	skill,
	snapshot,
	success,
} from "./helpers.ts";

test("frozen rejects changed selection and contribution metadata without side effects", async () => {
	const f = await fixture();
	try {
		const upstream = join(f.root, "upstream");
		const source = await repository(upstream);
		await put(upstream, "skills/alpha/SKILL.md", skill("alpha"));
		await commit(upstream);
		success(await run(f.client, f.cache, "add", "skills", source, "team", "--path", "skills"));
		const configPath = join(f.client, "skillbox/config.json");
		const config = await json(configPath);
		for (const [changed, code, hint] of [
			[{ ...config, install: [] }, "LOCK_OUT_OF_DATE", "skillbox/lock.json"],
			[
				{ ...config, install: ["team", "constructor"] },
				"LOCK_OUT_OF_DATE",
				"skillbox/lock.json",
			],
			[
				{ ...config, sources: [{ ...config.sources[0], ref: "different" }] },
				"LOCK_OUT_OF_DATE",
				"skillbox/lock.json",
			],
			[
				{ sources: [{ ...config.sources[0], id: "other" }], install: ["other"] },
				"PIN_MISSING",
				"Register it with add.",
			],
		] as const) {
			await put(f.client, "skillbox/config.json", JSON.stringify(changed));
			await rm(f.cache, { recursive: true, force: true });
			const before = await snapshot(f.client);
			const result = await run(f.client, f.cache, "sync", "--frozen");
			failure(result, code);
			expect(result.response.errors[0]?.message).toContain(hint);
			expect(await snapshot(f.client)).toEqual(before);
			expect(
				await stat(f.cache).then(
					() => true,
					() => false,
				),
			).toBe(false);
		}
		await put(f.client, "skillbox/config.json", JSON.stringify(config));
		const lockPath = join(f.client, "skillbox/lock.json");
		const { installed, bundles, sources, version } = await json(lockPath);
		const bytes = JSON.stringify({ installed, bundles, sources, version });
		await put(f.client, "skillbox/lock.json", bytes);
		const inode = (await stat(lockPath)).ino;
		await rm(join(f.client, ".agents"), { recursive: true });
		await rm(join(f.client, ".claude"), { recursive: true });
		await rm(join(f.client, "skillbox/.local/install-state.json"));
		expect(success(await run(f.client, f.cache, "sync", "--frozen"))).toMatchObject({
			status: "synced",
			installed: 1,
		});
		expect(await readlink(join(f.client, ".claude/skills"))).toBe("../.agents/skills");
		expect(await readFile(join(f.client, ".claude/skills/alpha/SKILL.md"), "utf8")).toBe(
			skill("alpha"),
		);
		expect(await readFile(lockPath, "utf8")).toBe(bytes);
		expect((await stat(lockPath)).ino).toBe(inode);
		expect(success(await run(f.client, f.cache, "sync", "--frozen"))).toMatchObject({
			status: "unchanged",
		});
	} finally {
		await rm(f.root, { recursive: true, force: true });
	}
}, 60_000);

test("frozen requires personal lock before bootstrapping pins", async () => {
	const f = await fixture();
	try {
		await put(
			f.client,
			"skillbox/.local/config.json",
			JSON.stringify({
				sources: [
					{
						type: "skills",
						id: "team",
						source: "https://example.invalid/repo.git",
						path: "skills",
					},
				],
				install: ["team"],
			}),
		);
		const before = await snapshot(f.client);
		failure(await run(f.client, f.cache, "sync", "--frozen"), "LOCK_MISSING");
		expect(await snapshot(f.client)).toEqual(before);
		expect(
			await stat(f.cache).then(
				() => true,
				() => false,
			),
		).toBe(false);
	} finally {
		await rm(f.root, { recursive: true, force: true });
	}
});

test("frozen rejects native content drift without replacing the installation", async () => {
	const f = await fixture();
	try {
		await put(f.client, "skillbox/team/alpha/SKILL.md", skill("alpha"));
		success(await run(f.client, f.cache, "add", "skillbox", ".", "team", "--bundle", "team"));
		await put(f.client, "skillbox/team/alpha/SKILL.md", skill("alpha", "changed"));
		const before = await snapshot(f.client);
		failure(await run(f.client, f.cache, "sync", "--frozen"), "LOCK_OUT_OF_DATE");
		expect(await snapshot(f.client)).toEqual(before);
		expect(success(await run(f.client, f.cache, "sync"))).toMatchObject({ installed: 1 });
		expect(await readFile(join(f.client, ".agents/skills/alpha/SKILL.md"), "utf8")).toBe(
			skill("alpha", "changed"),
		);
	} finally {
		await rm(f.root, { recursive: true, force: true });
	}
}, 60_000);
