import { afterEach, expect, test } from "bun:test";
import { chmod, lstat, readFile, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { parse, stringify } from "smol-toml";
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

const roots: string[] = [];
afterEach(async () => {
	await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function setup() {
	const f = await fixture();
	roots.push(f.root);
	const source = join(f.root, "source");
	const url = await repository(source);
	await put(source, "plugin/skills/original-dir/SKILL.md", skill("alpha"));
	await put(source, "plugin/skills/original-dir/references/guide.md", "original guide\n");
	await put(source, "plugin/skills/original-dir/remove.txt", "remove me\n");
	const pin = await commit(source);
	return { ...f, source, url, pin };
}
async function annotate(root: string, bundle: string, directory = "original-dir") {
	const path = join(root, "skillbox/patches", bundle, directory, "patch.toml");
	const manifest = parse(await readFile(path, "utf8")) as {
		files: Record<string, { intent: string }>;
	};
	for (const value of Object.values(manifest.files))
		value.intent = "Intent for this consumer's policy.";
	await put(root, join("skillbox/patches", bundle, directory, "patch.toml"), stringify(manifest));
}

test("first prepare/capture never mutates source layout; ordered per-directory patches keep bytes/intents and supporting files", async () => {
	const f = await setup();
	success(
		await run(f.client, f.cache, "add", "skills", f.url, "team", "--path", "plugin/skills"),
	);
	const sourceBefore = await snapshot(f.source);
	const lockBefore = await json(join(f.client, "skillbox/lock.json"));
	const prepared = success(await run(f.client, f.cache, "patch", "prepare", "team"));
	expect(prepared.workspace).toBe(join(f.client, "skillbox/.prepare/team/edit"));
	expect(await readdir(join(prepared.editable, "skills"))).toEqual(["original-dir"]);
	expect(await lstat(join(f.client, "skillbox/patches")).catch(() => undefined)).toBeUndefined();
	expect(
		success(
			await run(f.client, f.cache, "patch", "capture", "team", "--from", prepared.workspace),
		),
	).toMatchObject({ status: "unchanged", changed: 0 });
	expect(await lstat(join(f.client, "skillbox/patches")).catch(() => undefined)).toBeUndefined();
	await put(prepared.editable, "skills/original-dir/SKILL.md", skill("alpha", "consumer policy"));
	await put(prepared.editable, "skills/original-dir/references/guide.md", "consumer guide\n");
	await put(prepared.editable, "skills/original-dir/binary.dat", new Uint8Array([0, 255, 7, 8]));
	await put(prepared.editable, "skills/original-dir/run.sh", "#!/bin/sh\necho works\n");
	await chmod(join(prepared.editable, "skills/original-dir/run.sh"), 0o755);
	await rm(join(prepared.editable, "skills/original-dir/remove.txt"));
	const captured = success(
		await run(f.client, f.cache, "patch", "capture", "team", "--from", prepared.workspace),
	);
	expect(captured).toMatchObject({ changed: 5, pendingIntents: 5 });
	expect(captured.intentFiles).toEqual(["skillbox/patches/team/original-dir/patch.toml"]);
	expect(await json(join(f.client, "skillbox/lock.json"))).toEqual(lockBefore);
	failure(await run(f.client, f.cache, "sync"), "INTENT_REQUIRED");
	await annotate(f.client, "team");
	success(await run(f.client, f.cache, "sync"));
	const pack = join(f.client, "skillbox/patches/team");
	expect(await readdir(pack)).toEqual(["original-dir"]);
	const firstArtifacts = await snapshot(join(pack, "original-dir/changes"));
	const firstManifest = parse(await readFile(join(pack, "original-dir/patch.toml"), "utf8")) as {
		patches: unknown[];
		files: Record<string, unknown>;
	};
	expect(firstManifest.patches).toHaveLength(5);
	await put(
		prepared.editable,
		"skills/original-dir/SKILL.md",
		skill("alpha", "consumer policy again"),
	);
	expect(
		success(
			await run(f.client, f.cache, "patch", "capture", "team", "--from", prepared.workspace),
		),
	).toMatchObject({ changed: 1, pendingIntents: 0 });
	const nextManifest = parse(await readFile(join(pack, "original-dir/patch.toml"), "utf8")) as {
		patches: unknown[];
		files: Record<string, unknown>;
	};
	expect(nextManifest.patches.slice(0, 5)).toEqual(firstManifest.patches);
	expect(nextManifest.files).toEqual(firstManifest.files);
	const artifacts = await snapshot(join(pack, "original-dir/changes"));
	for (const [path, bytes] of Object.entries(firstArtifacts))
		expect(artifacts[path]).toEqual(bytes);
	success(await run(f.client, f.cache, "sync"));
	expect(await readFile(join(f.client, ".agents/skills/alpha/SKILL.md"), "utf8")).toContain(
		"consumer policy again",
	);
	expect(await readFile(join(f.client, ".agents/skills/alpha/binary.dat"))).toEqual(
		Buffer.from([0, 255, 7, 8]),
	);
	expect((await lstat(join(f.client, ".agents/skills/alpha/run.sh"))).mode & 0o777).toBe(0o755);
	expect(
		await lstat(join(f.client, ".agents/skills/alpha/remove.txt")).catch(() => undefined),
	).toBeUndefined();
	expect(await snapshot(f.source)).toEqual(sourceBefore);
	const before = await snapshot(f.client);
	expect(success(await run(f.client, f.cache, "sync"))).toMatchObject({ status: "unchanged" });
	expect(await snapshot(f.client)).toEqual(before);
	const packBefore = await snapshot(pack);
	const unchangedUpdate = success(await run(f.client, f.cache, "update", "team"));
	success(
		await run(
			f.client,
			f.cache,
			"patch",
			"capture",
			"team",
			"--from",
			unchangedUpdate.workspace,
		),
	);
	expect(await snapshot(pack)).toEqual(packBefore);
	expect(success(await run(f.client, f.cache, "sync"))).toMatchObject({ status: "unchanged" });
}, 60_000);

test("Git producer publishes its applied patches and native skills without its intent/payloads leaking to consumer; own patches layer", async () => {
	const f = await setup();
	const producer = join(f.root, "producer");
	const producerUrl = await repository(producer);
	success(
		await run(
			producer,
			f.cache,
			"add",
			"skills",
			f.url,
			"published",
			"--path",
			"plugin/skills",
			"--no-install",
		),
	);
	await put(producer, "skillbox/published/native/SKILL.md", skill("native"));
	const producerPrepared = success(await run(producer, f.cache, "patch", "prepare", "published"));
	await put(
		producerPrepared.editable,
		"skills/original-dir/references/guide.md",
		"producer guide\n",
	);
	success(
		await run(
			producer,
			f.cache,
			"patch",
			"capture",
			"published",
			"--from",
			producerPrepared.workspace,
		),
	);
	await annotate(producer, "published");
	await commit(producer);
	success(
		await run(
			f.client,
			f.cache,
			"add",
			"skillbox",
			producerUrl,
			"consumed",
			"--bundle",
			"published",
		),
	);
	expect(await readFile(join(f.client, ".agents/skills/alpha/references/guide.md"), "utf8")).toBe(
		"producer guide\n",
	);
	expect(await lstat(join(f.client, "skillbox/patches")).catch(() => undefined)).toBeUndefined();
	const prepared = success(await run(f.client, f.cache, "patch", "prepare", "consumed"));
	expect(
		await readFile(join(prepared.pristine, "skills/original-dir/references/guide.md"), "utf8"),
	).toBe("producer guide\n");
	await put(
		prepared.editable,
		"skills/original-dir/SKILL.md",
		skill("alpha", "own consumer layer"),
	);
	success(
		await run(f.client, f.cache, "patch", "capture", "consumed", "--from", prepared.workspace),
	);
	await annotate(f.client, "consumed");
	success(await run(f.client, f.cache, "sync"));
	const ownManifest = parse(
		await readFile(join(f.client, "skillbox/patches/consumed/original-dir/patch.toml"), "utf8"),
	) as { files: Record<string, unknown> };
	expect(Object.keys(ownManifest.files)).toEqual(["./SKILL.md"]);
	const before = await snapshot(f.client);
	await put(f.source, "plugin/skills/original-dir/references/guide.md", "upstream moved\n");
	await commit(f.source);
	await put(producer, "skillbox/published/native/SKILL.md", skill("native", "producer moved"));
	await commit(producer);
	await rm(f.cache, { recursive: true, force: true });
	await rm(join(f.client, ".agents"), { recursive: true });
	success(await run(f.client, f.cache, "sync"));
	expect(await snapshot(f.client)).toEqual(before);
	expect(await readFile(join(f.client, ".agents/skills/alpha/SKILL.md"), "utf8")).toContain(
		"own consumer layer",
	);
	expect(await readFile(join(f.client, ".agents/skills/alpha/references/guide.md"), "utf8")).toBe(
		"producer guide\n",
	);
}, 60_000);

test("explicit update stages pins, retains conflict candidate for manual repair and capture accepts reviewed pins", async () => {
	const f = await setup();
	success(
		await run(
			f.client,
			f.cache,
			"add",
			"skills",
			f.url,
			"team",
			"--path",
			"plugin/skills",
			"--ref",
			"HEAD",
		),
	);
	const prepared = success(await run(f.client, f.cache, "patch", "prepare", "team"));
	await put(
		prepared.editable,
		"skills/original-dir/SKILL.md",
		skill("alpha", "consumer conflicts"),
	);
	await put(prepared.editable, "skills/original-dir/references/guide.md", "consumer guide\n");
	success(await run(f.client, f.cache, "patch", "capture", "team", "--from", prepared.workspace));
	await annotate(f.client, "team");
	success(await run(f.client, f.cache, "sync"));
	const before = await snapshot(f.client);
	const lockBefore = await json(join(f.client, "skillbox/lock.json"));
	await put(
		f.source,
		"plugin/skills/original-dir/SKILL.md",
		skill("alpha", "upstream conflicts"),
	);
	await rename(
		join(f.source, "plugin/skills/original-dir/references/guide.md"),
		join(f.source, "plugin/skills/original-dir/references/renamed.md"),
	);
	const revision = await commit(f.source);
	const conflicted = failure(await run(f.client, f.cache, "update", "team"), "UPDATE_CONFLICT");
	expect(conflicted.conflicts).toHaveLength(2);
	expect(await snapshot(f.client)).toEqual(before);
	expect(
		await readFile(join(conflicted.pristine, "skills/original-dir/SKILL.md"), "utf8"),
	).toContain("upstream conflicts");
	await put(
		conflicted.editable,
		"skills/original-dir/SKILL.md",
		skill("alpha", "reviewed merged policy"),
	);
	failure(
		await run(
			f.client,
			f.cache,
			"patch",
			"capture",
			"team",
			"--from",
			conflicted.workspace,
			"--map",
			"original-dir/references/guide.md=original-dir/references/renamed.md",
		),
		"UPDATE_CONFLICT_UNRESOLVED",
	);
	expect(await snapshot(f.client)).toEqual(before);
	await put(conflicted.editable, "skills/original-dir/references/renamed.md", "consumer guide\n");
	success(
		await run(
			f.client,
			f.cache,
			"patch",
			"capture",
			"team",
			"--from",
			conflicted.workspace,
			"--map",
			"original-dir/references/guide.md=original-dir/references/renamed.md",
		),
	);
	const lockAfter = await json(join(f.client, "skillbox/lock.json"));
	expect(Object.values(lockAfter.sources)[0]).toMatchObject({ pin: { revision } });
	expect(lockAfter.installed).toEqual(lockBefore.installed);
	const manifest = parse(
		await readFile(join(f.client, "skillbox/patches/team/original-dir/patch.toml"), "utf8"),
	) as { files: Record<string, { intent: string }> };
	expect(manifest.files["./references/renamed.md"]!.intent).toBe(
		"Intent for this consumer's policy.",
	);
	success(await run(f.client, f.cache, "sync"));
	expect(await readFile(join(f.client, ".agents/skills/alpha/SKILL.md"), "utf8")).toContain(
		"reviewed merged policy",
	);
	expect(
		await readFile(join(f.client, ".agents/skills/alpha/references/renamed.md"), "utf8"),
	).toBe("consumer guide\n");
	failure(
		await run(f.client, f.cache, "patch", "capture", "team", "--from", prepared.workspace),
		"REGEN_WORKSPACE_INVALID",
	);
}, 60_000);

test("capture rejects tampered pristine/outside files and malformed patch metadata atomically", async () => {
	const f = await setup();
	success(
		await run(f.client, f.cache, "add", "skills", f.url, "team", "--path", "plugin/skills"),
	);
	const prepared = success(await run(f.client, f.cache, "patch", "prepare", "team"));
	await put(prepared.pristine, "skills/original-dir/SKILL.md", skill("alpha", "tampered"));
	let before = await snapshot(f.client);
	failure(
		await run(f.client, f.cache, "patch", "capture", "team", "--from", prepared.workspace),
		"REGEN_WORKSPACE_INVALID",
	);
	expect(await snapshot(f.client)).toEqual(before);
	const second = success(
		await run(
			f.client,
			f.cache,
			"patch",
			"prepare",
			"team",
			"--output",
			"skillbox/.prepare/team/another",
		),
	);
	await put(second.editable, "outside.md", "not a skill");
	failure(
		await run(f.client, f.cache, "patch", "capture", "team", "--from", second.workspace),
		"CAPTURE_OUTSIDE_SKILLS",
	);
	expect(await snapshot(f.client)).toEqual(before);
	await put(
		f.client,
		"skillbox/patches/team/original-dir/patch.toml",
		'schema=1\n[files."./SKILL.md"]\nintent="x"\n[[patches]]\ntarget="./SKILL.md"\npatch="../../escape.patch"\n',
	);
	before = await snapshot(f.client);
	failure(await run(f.client, f.cache, "sync"), "PATCH_PACK_INVALID");
	expect(await snapshot(f.client)).toEqual(before);
}, 60_000);
