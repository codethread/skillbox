import { expect, test } from "bun:test";
import { chmod, readFile, readdir, rename, rm, stat, symlink } from "node:fs/promises";
import { join } from "node:path";
import { parse, stringify } from "smol-toml";
import { failure, fixture, json, put, run, skill, snapshot, success } from "./helpers.ts";

async function configure(root: string, sources: object[], install: string[]) {
	await put(root, "skillbox/config.local.json", JSON.stringify({ sources, install }));
}

async function annotate(root: string, path: string) {
	const manifest = parse(await readFile(join(root, path), "utf8"));
	const files = manifest.files as Record<string, { intent: string }>;
	for (const file of Object.values(files)) file.intent = "Consumer-owned policy.";
	await put(root, path, stringify(manifest));
}

test("receipt bootstrap protects edits, restores missing output, and rejects lost installation state", async () => {
	const f = await fixture();
	try {
		await put(f.client, "skillbox/team/alpha/SKILL.md", skill("alpha", "shared"));
		success(await run(f.client, f.cache, "add", "skillbox", ".", "team", "--bundle", "team"));
		await rm(join(f.client, "skillbox/install-state.local.json"));
		await configure(
			f.client,
			[{ type: "skillbox", id: "team", source: ".", bundles: ["team"] }],
			["team"],
		);
		await put(f.client, ".agents/skills/alpha/SKILL.md", skill("alpha", "unsaved edit"));
		let before = await snapshot(f.client);
		failure(await run(f.client, f.cache, "sync"), "MANAGED_SKILL_MODIFIED");
		expect(await snapshot(f.client)).toEqual(before);
		await rm(join(f.client, ".agents/skills/alpha"), { recursive: true });
		success(await run(f.client, f.cache, "sync"));
		expect(await readFile(join(f.client, ".agents/skills/alpha/SKILL.md"), "utf8")).toBe(
			skill("alpha", "shared"),
		);
		const receipt = await json(join(f.client, "skillbox/install-state.local.json"));
		expect(receipt).toMatchObject({ version: 1, owner: "local", personalInitialized: true });
		expect(receipt.installed).toEqual(
			(await json(join(f.client, "skillbox/lock.local.json"))).installed,
		);
		const paths = [
			"skillbox/lock.local.json",
			"skillbox/install-state.local.json",
			".agents/skills",
			".agents/skills/alpha/SKILL.md",
			".claude/skills",
		];
		const mtimes = await Promise.all(
			paths.map(async (path) => (await stat(join(f.client, path))).mtimeMs),
		);
		expect(success(await run(f.client, f.cache, "sync"))).toMatchObject({
			status: "unchanged",
			config: "skillbox/config.local.json",
		});
		expect(
			await Promise.all(
				paths.map(async (path) => (await stat(join(f.client, path))).mtimeMs),
			),
		).toEqual(mtimes);
		await chmod(join(f.client, ".agents/skills/alpha/SKILL.md"), 0o755);
		await rename(join(f.client, "skillbox/config.local.json"), join(f.root, "saved.json"));
		before = await snapshot(f.client);
		failure(await run(f.client, f.cache, "sync"), "MANAGED_SKILL_MODIFIED");
		expect(await snapshot(f.client)).toEqual(before);
		await chmod(join(f.client, ".agents/skills/alpha/SKILL.md"), 0o644);
		await rename(join(f.root, "saved.json"), join(f.client, "skillbox/config.local.json"));
		await rm(join(f.client, "skillbox/install-state.local.json"));
		before = await snapshot(f.client);
		failure(await run(f.client, f.cache, "sync"), "INSTALL_STATE_MISSING");
		expect(await snapshot(f.client)).toEqual(before);
		expect(success(await run(f.client, f.cache, "patch", "prepare", "team"))).toMatchObject({
			config: "skillbox/config.local.json",
		});
		expect(await readdir(join(f.client, "skillbox"))).not.toContain("install-state.local.json");
	} finally {
		await rm(f.root, { recursive: true, force: true });
	}
}, 60_000);

test("initialized private state rejects malformed files and missing pins without touching shared state", async () => {
	const f = await fixture();
	try {
		await put(f.client, "skillbox/team/alpha/SKILL.md", skill("alpha"));
		success(await run(f.client, f.cache, "add", "skillbox", ".", "team", "--bundle", "team"));
		await configure(
			f.client,
			[{ type: "skillbox", id: "personal", source: ".", bundles: ["team"] }],
			["personal"],
		);
		success(await run(f.client, f.cache, "sync"));
		const privateLock = await json(join(f.client, "skillbox/lock.local.json"));
		for (const [value, code] of [
			["{invalid", "LOCK_INVALID"],
			[JSON.stringify({ ...privateLock, sources: {} }), "PIN_MISSING"],
		]) {
			await put(f.client, "skillbox/lock.local.json", value!);
			const before = await snapshot(f.client);
			const result = await run(f.client, f.cache, "sync");
			failure(result, code!);
			if (code === "LOCK_INVALID")
				expect(result.response.errors[0]?.message).toContain("skillbox/lock.local.json");
			expect(await snapshot(f.client)).toEqual(before);
		}
		await rm(join(f.client, "skillbox/lock.local.json"));
		const before = await snapshot(f.client);
		failure(
			await run(f.client, f.cache, "add", "skillbox", ".", "personal", "--bundle", "team"),
			"LOCK_MISSING",
		);
		expect(await snapshot(f.client)).toEqual(before);
	} finally {
		await rm(f.root, { recursive: true, force: true });
	}
}, 60_000);

test("personal patches layer over shared patches and reject a changed shared preparation baseline", async () => {
	const f = await fixture();
	try {
		await put(f.client, "skillbox/team/alpha/SKILL.md", skill("alpha", "native"));
		success(await run(f.client, f.cache, "add", "skillbox", ".", "team", "--bundle", "team"));
		const shared = success(await run(f.client, f.cache, "patch", "prepare", "team"));
		await put(shared.editable, "skills/alpha/SKILL.md", skill("alpha", "shared patch"));
		const sharedCapture = success(
			await run(f.client, f.cache, "patch", "capture", "team", "--from", shared.workspace),
		);
		await annotate(f.client, sharedCapture.intentFiles[0]);
		success(await run(f.client, f.cache, "sync"));
		const sharedPatches = await snapshot(join(f.client, "skillbox/patches"));
		const sharedConfig = await readFile(join(f.client, "skillbox/config.json"), "utf8");
		const sharedLock = await readFile(join(f.client, "skillbox/lock.json"), "utf8");
		await configure(
			f.client,
			[{ type: "skillbox", id: "team", source: ".", bundles: ["team"] }],
			["team"],
		);
		success(await run(f.client, f.cache, "sync"));
		const personal = success(await run(f.client, f.cache, "patch", "prepare", "team"));
		expect(await readFile(join(personal.pristine, "skills/alpha/SKILL.md"), "utf8")).toBe(
			skill("alpha", "shared patch"),
		);
		await put(personal.editable, "skills/alpha/SKILL.md", skill("alpha", "personal patch"));
		const captured = success(
			await run(f.client, f.cache, "patch", "capture", "team", "--from", personal.workspace),
		);
		expect(captured.intentFiles).toEqual(["skillbox/patches.local/team/alpha/patch.toml"]);
		await annotate(f.client, captured.intentFiles[0]);
		success(await run(f.client, f.cache, "sync"));
		expect(await readFile(join(f.client, ".agents/skills/alpha/SKILL.md"), "utf8")).toBe(
			skill("alpha", "personal patch"),
		);
		expect(await snapshot(join(f.client, "skillbox/patches"))).toEqual(sharedPatches);
		expect(await readFile(join(f.client, "skillbox/config.json"), "utf8")).toBe(sharedConfig);
		expect(await readFile(join(f.client, "skillbox/lock.json"), "utf8")).toBe(sharedLock);
		const stale = success(
			await run(
				f.client,
				f.cache,
				"patch",
				"prepare",
				"team",
				"--output",
				"skillbox/.prepare.local/team/stale",
			),
		);
		await put(f.client, "skillbox/team/alpha/new.txt", "new upstream resource\n");
		const before = await snapshot(f.client);
		failure(
			await run(f.client, f.cache, "patch", "capture", "team", "--from", stale.workspace),
			"REGEN_WORKSPACE_INVALID",
		);
		expect(await snapshot(f.client)).toEqual(before);
		expect(await readdir(join(f.client, ".agents/skills"))).toEqual(["alpha"]);
	} finally {
		await rm(f.root, { recursive: true, force: true });
	}
}, 60_000);

test("personal-only composition does not inspect an unused same-id shared native path", async () => {
	const f = await fixture();
	try {
		const raw = join(f.root, "raw");
		await put(raw, "skills/alpha/SKILL.md", skill("alpha", "personal source"));
		await configure(
			f.client,
			[{ type: "skills", id: "team", source: raw, path: "skills" }],
			["team"],
		);
		await symlink("missing-native", join(f.client, "skillbox/team"));
		success(await run(f.client, f.cache, "sync"));
		expect(await readFile(join(f.client, ".agents/skills/alpha/SKILL.md"), "utf8")).toBe(
			skill("alpha", "personal source"),
		);
		expect((await json(join(f.client, "skillbox/lock.local.json"))).bundles).toHaveProperty(
			"team",
		);
	} finally {
		await rm(f.root, { recursive: true, force: true });
	}
}, 60_000);
