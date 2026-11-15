import { afterEach, expect, test } from "bun:test";
import { chmod, lstat, mkdir, readFile, readdir, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import {
	commit,
	failure,
	fixture,
	git,
	json,
	put,
	repository,
	run,
	skill,
	snapshot,
	success,
} from "./helpers.ts";

const roots: string[] = [];
afterEach(async () => {
	await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function setup() {
	const f = await fixture();
	roots.push(f.root);
	return f;
}

test("multi-source bundle merges picks, omits and native skills; selection is independent and repeat sync writes nothing", async () => {
	const f = await setup();
	const source = join(f.root, "producer");
	const raw = join(f.root, "raw");
	await put(source, "skillbox/coding/alias-a/SKILL.md", skill("alpha"));
	await put(source, "skillbox/coding/beta/SKILL.md", skill("beta"));
	await put(source, "skillbox/review/gamma/SKILL.md", skill("gamma"));
	await put(source, "skillbox/review/delta/SKILL.md", skill("delta"));
	await put(source, "skillbox/coding/alias-a/resources/blob.bin", new Uint8Array([0, 255, 3]));
	await put(source, "skillbox/coding/alias-a/run.sh", "#!/bin/sh\necho works\n");
	await chmod(join(source, "skillbox/coding/alias-a/run.sh"), 0o755);
	await put(raw, "arbitrary/deep/skills/epsilon-dir/SKILL.md", skill("epsilon"));
	await put(raw, "arbitrary/deep/skills/README.md", "not a skill directory");
	await put(raw, "skillbox/config.json", "invalid and unrelated to raw skills");
	await put(f.client, "skillbox/team/native-dir/SKILL.md", skill("native"));
	await put(f.client, "skillbox/local/owned/SKILL.md", skill("owned"));
	const first = success(
		await run(
			f.client,
			f.cache,
			"add",
			"skillbox",
			source,
			"team",
			"--bundle",
			"coding",
			"--bundle",
			"review",
			"--pick",
			'{"coding":["alpha"]}',
			"--omit",
			'{"review":["delta"]}',
		),
	);
	expect(first).toMatchObject({ bundle: "team", skills: 3, installed: 3 });
	success(
		await run(
			f.client,
			f.cache,
			"add",
			"skills",
			raw,
			"team",
			"--path",
			"arbitrary/deep/skills",
		),
	);
	expect((await readdir(join(f.client, ".agents/skills"))).sort()).toEqual([
		"alpha",
		"epsilon",
		"gamma",
		"native",
	]);
	expect(await readFile(join(f.client, ".agents/skills/alpha/resources/blob.bin"))).toEqual(
		Buffer.from([0, 255, 3]),
	);
	expect((await lstat(join(f.client, ".agents/skills/alpha/run.sh"))).mode & 0o777).toBe(0o755);
	expect(await lstat(join(f.client, "skillbox/patches")).catch(() => undefined)).toBeUndefined();
	const lock = await json(join(f.client, "skillbox/lock.json"));
	expect(lock.version).toBe(2);
	expect(
		lock.bundles.team.members.find((member: { name: string }) => member.name === "alpha"),
	).toMatchObject({ directory: "alias-a", path: "skillbox/coding/alias-a" });
	const before = await snapshot(f.client);
	const stat = await lstat(join(f.client, "skillbox/lock.json"));
	expect(success(await run(f.client, f.cache, "sync"))).toMatchObject({
		status: "unchanged",
		installed: 0,
		unchanged: 4,
	});
	expect(await snapshot(f.client)).toEqual(before);
	expect((await lstat(join(f.client, "skillbox/lock.json"))).mtimeMs).toBe(stat.mtimeMs);
	expect(
		success(
			await run(
				f.client,
				f.cache,
				"add",
				"skills",
				raw,
				"team",
				"--path",
				"arbitrary/deep/skills",
			),
		),
	).toMatchObject({ status: "unchanged", installed: 0 });
	expect(await snapshot(f.client)).toEqual(before);
	await chmod(join(source, "skillbox/coding/alias-a/resources/blob.bin"), 0o600);
	expect(success(await run(f.client, f.cache, "sync"))).toMatchObject({
		installed: 1,
		unchanged: 3,
	});
	expect(
		(await lstat(join(f.client, ".agents/skills/alpha/resources/blob.bin"))).mode & 0o777,
	).toBe(0o600);
	const config = await json(join(f.client, "skillbox/config.json"));
	config.install = ["local"];
	await put(f.client, "skillbox/config.json", JSON.stringify(config));
	expect(success(await run(f.client, f.cache, "sync"))).toMatchObject({
		removed: 4,
		installed: 1,
	});
	expect(await readdir(join(f.client, ".agents/skills"))).toEqual(["owned"]);
	expect((await json(join(f.client, "skillbox/lock.json"))).bundles.team.members).toHaveLength(4);
}, 60_000);

test("selector, contribution and installation collisions fail atomically; repeated identity merges explicitly", async () => {
	const f = await setup();
	const source = join(f.root, "source");
	await put(source, "skillbox/a/alpha/SKILL.md", skill("alpha"));
	await put(source, "skillbox/b/beta/SKILL.md", skill("beta"));
	success(await run(f.client, f.cache, "add", "skillbox", source, "team", "--bundle", "a"));
	success(await run(f.client, f.cache, "add", "skillbox", source, "team", "--bundle", "b"));
	expect((await json(join(f.client, "skillbox/config.json"))).sources).toHaveLength(1);
	expect((await json(join(f.client, "skillbox/config.json"))).sources[0].bundles).toEqual([
		"a",
		"b",
	]);
	for (const args of [
		["--bundle", "a", "--pick", '{"a":["missing"]}'],
		["--bundle", "a", "--omit", '{"a":["missing"]}'],
		["--bundle", "a", "--pick", '{"b":["beta"]}'],
		["--bundle", "a", "--pick", '{"a":["alpha"]}', "--omit", '{"a":["alpha"]}'],
		["--bundle", "a", "--pick", '{"a":["alpha","alpha"]}'],
		["--bundle", "a", "--bundle", "a"],
	]) {
		const before = await snapshot(f.client);
		const result = await run(f.client, f.cache, "add", "skillbox", source, "team", ...args);
		expect(result.exitCode).not.toBe(0);
		expect(result.response.success).toBe(false);
		expect(await snapshot(f.client)).toEqual(before);
	}
	let before = await snapshot(f.client);
	failure(
		await run(f.client, f.cache, "add", "skillbox", source, "other", "--bundle", "a"),
		"SKILL_NAME_COLLISION",
	);
	expect(await snapshot(f.client)).toEqual(before);
	const raw = join(f.root, "raw");
	await put(raw, "skills/alias/SKILL.md", skill("alpha"));
	failure(
		await run(f.client, f.cache, "add", "skills", raw, "team", "--path", "skills"),
		"SKILL_NAME_COLLISION",
	);
	expect(await snapshot(f.client)).toEqual(before);
	failure(
		await run(
			f.client,
			f.cache,
			"add",
			"skills",
			raw,
			"other",
			"--path",
			"skills",
			"--pick",
			"alpha",
			"--omit",
			"alpha",
		),
		"INVALID_INPUT",
	);
	expect(await snapshot(f.client)).toEqual(before);
	const config = await json(join(f.client, "skillbox/config.json"));
	config.sources.push(config.sources[0]);
	await put(f.client, "skillbox/config.json", JSON.stringify(config));
	before = await snapshot(f.client);
	failure(await run(f.client, f.cache, "sync"), "CONFIG_INVALID");
	expect(await snapshot(f.client)).toEqual(before);
}, 60_000);

test("native producers need no config, local cross-bundle composition works, self duplication is avoided and cycles fail", async () => {
	const f = await setup();
	const source = join(f.root, "source");
	await put(source, "skillbox/native/alias/SKILL.md", skill("alpha"));
	success(
		await run(
			f.client,
			f.cache,
			"add",
			"skillbox",
			source,
			"a",
			"--bundle",
			"native",
			"--no-install",
		),
	);
	await put(f.client, "skillbox/b/owned/SKILL.md", skill("beta"));
	success(
		await run(f.client, f.cache, "add", "skillbox", ".", "b", "--bundle", "a", "--bundle", "b"),
	);
	expect((await readdir(join(f.client, ".agents/skills"))).sort()).toEqual(["alpha", "beta"]);
	const config = await json(join(f.client, "skillbox/config.json"));
	expect(config.install).toEqual(["b"]);
	const before = await snapshot(f.client);
	failure(
		await run(f.client, f.cache, "add", "skillbox", ".", "a", "--bundle", "b", "--no-install"),
		"BUNDLE_IMPORT_CYCLE",
	);
	expect(await snapshot(f.client)).toEqual(before);
}, 60_000);

test("plain Git pins restore cold after upstream moves; nested Git exports uninstalled bundles using producer pins", async () => {
	const f = await setup();
	const raw = join(f.root, "raw");
	const rawUrl = await repository(raw);
	await put(raw, "plugin/skills/alias/SKILL.md", skill("alpha", "pinned original"));
	const rawPin = await commit(raw);
	const producer = join(f.root, "producer");
	const producerUrl = await repository(producer);
	await put(producer, "skillbox/published/native/SKILL.md", skill("native"));
	success(
		await run(
			producer,
			f.cache,
			"add",
			"skills",
			rawUrl,
			"published",
			"--path",
			"plugin/skills",
			"--no-install",
		),
	);
	expect((await json(join(producer, "skillbox/config.json"))).install).toEqual([]);
	const producerPin = await commit(producer);
	success(
		await run(
			f.client,
			f.cache,
			"add",
			"skillbox",
			producerUrl,
			"consumer",
			"--bundle",
			"published",
		),
	);
	expect((await readdir(join(f.client, ".agents/skills"))).sort()).toEqual(["alpha", "native"]);
	const lock = await json(join(f.client, "skillbox/lock.json"));
	expect(Object.values(lock.sources)[0]).toMatchObject({ pin: { revision: producerPin } });
	expect(
		lock.bundles.consumer.members.find((member: { name: string }) => member.name === "alpha"),
	).toMatchObject({ revision: rawPin, source: rawUrl, directory: "alias" });
	await put(raw, "plugin/skills/alias/SKILL.md", skill("alpha", "moved raw head"));
	await commit(raw);
	await put(
		producer,
		"skillbox/published/native/SKILL.md",
		skill("native", "moved producer head"),
	);
	await commit(producer);
	await rm(f.cache, { recursive: true, force: true });
	await rm(join(f.client, ".agents"), { recursive: true });
	success(await run(f.client, f.cache, "sync"));
	expect(await readFile(join(f.client, ".agents/skills/alpha/SKILL.md"), "utf8")).toContain(
		"pinned original",
	);
	expect(await readFile(join(f.client, ".agents/skills/native/SKILL.md"), "utf8")).not.toContain(
		"moved producer head",
	);
	expect(await json(join(f.client, "skillbox/lock.json"))).toEqual(lock);
	// Updating just the producer pin still respects its committed nested raw pin.
	const candidate = success(await run(f.client, f.cache, "update", "consumer"));
	expect(await json(join(f.client, "skillbox/lock.json"))).toEqual(lock);
	success(
		await run(f.client, f.cache, "patch", "capture", "consumer", "--from", candidate.workspace),
	);
	success(await run(f.client, f.cache, "sync"));
	expect(await readFile(join(f.client, ".agents/skills/native/SKILL.md"), "utf8")).toContain(
		"moved producer head",
	);
	expect(await readFile(join(f.client, ".agents/skills/alpha/SKILL.md"), "utf8")).toContain(
		"pinned original",
	);
}, 60_000);

test("workspace and unmanaged safety, raw symlink rejection, missing producer locks and escaped local producer paths", async () => {
	const f = await setup();
	const source = join(f.root, "source");
	await put(source, "skills/alpha/SKILL.md", skill("alpha"));
	await put(f.client, ".agents/skills/owned/SKILL.md", skill("owned"));
	let before = await snapshot(f.client);
	failure(
		await run(
			f.root,
			f.cache,
			"--workspace",
			"client",
			"add",
			"skills",
			"./source",
			"team",
			"--path",
			"skills",
		),
		"UNMANAGED_SKILL",
	);
	expect(await snapshot(f.client)).toEqual(before);
	await rm(join(f.client, ".agents"), { recursive: true });
	success(
		await run(
			f.root,
			f.cache,
			"add",
			"skills",
			"./source",
			"team",
			"--path",
			"skills",
			"--workspace",
			"client",
		),
	);
	expect((await json(join(f.client, "skillbox/config.json"))).sources[0].source).toBe(
		"../source",
	);
	await mkdir(join(source, "indirect"));
	await symlink("../skills", join(source, "indirect/link"));
	before = await snapshot(f.client);
	failure(
		await run(f.client, f.cache, "add", "skills", source, "other", "--path", "indirect/link"),
		"SOURCE_PATH_UNSAFE",
	);
	expect(await snapshot(f.client)).toEqual(before);
	const producer = join(f.root, "producer");
	const url = await repository(producer);
	await put(
		producer,
		"skillbox/config.json",
		JSON.stringify({
			sources: [{ type: "skills", id: "unsafe", source: "../source", path: "skills" }],
			install: [],
		}),
	);
	await commit(producer);
	failure(
		await run(
			f.client,
			f.cache,
			"add",
			"skillbox",
			url,
			"consumer",
			"--bundle",
			"unsafe",
			"--no-install",
		),
		"PRODUCER_LOCK_MISSING",
	);
	expect(await snapshot(f.client)).toEqual(before);
	await put(
		producer,
		"skillbox/lock.json",
		JSON.stringify({
			version: 2,
			sources: {
				'["skills","unsafe","../source","skills"]': {
					contribution: {
						type: "skills",
						id: "unsafe",
						source: "../source",
						path: "skills",
					},
					pin: { type: "local" },
				},
			},
			bundles: {},
			installed: {},
		}),
	);
	await commit(producer);
	failure(
		await run(
			f.client,
			f.cache,
			"add",
			"skillbox",
			url,
			"consumer",
			"--bundle",
			"unsafe",
			"--no-install",
		),
		"PRODUCER_SOURCE_ESCAPE",
	);
	expect(await snapshot(f.client)).toEqual(before);
	await git(producer, "status", "--porcelain");
}, 60_000);
