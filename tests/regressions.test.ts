import { afterEach, expect, test } from "bun:test";
import { readFile, readdir, rm } from "node:fs/promises";
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
	await put(source, "skills/alias/SKILL.md", skill("alpha"));
	const revision = await commit(source);
	return { ...f, source, url, revision };
}
async function note(root: string, bundle: string) {
	const path = `skillbox/patches/${bundle}/alias/patch.toml`;
	const manifest = parse(await readFile(join(root, path), "utf8")) as {
		files: Record<string, { intent: string }>;
	};
	for (const file of Object.values(manifest.files)) file.intent = "Keep reviewed local policy.";
	await put(root, path, stringify(manifest));
}

test("cached Git content is verified on replay and on refreshed reuse, without relocking a corrupt tree", async () => {
	const f = await setup();
	success(await run(f.client, f.cache, "add", "skills", f.url, "team", "--path", "skills"));
	const before = await snapshot(f.client);
	const [repositoryKey] = await readdir(join(f.cache, "git"));
	await put(
		join(f.cache, "git", repositoryKey!, f.revision, "tree"),
		"skills/alias/SKILL.md",
		skill("alpha", "cache corruption"),
	);
	failure(await run(f.client, f.cache, "sync"), "SOURCE_CACHE_CORRUPT");
	expect(await snapshot(f.client)).toEqual(before);
	failure(await run(f.client, f.cache, "update", "team"), "SOURCE_CACHE_CORRUPT");
	expect(await snapshot(f.client)).toEqual(before);
	await rm(f.cache, { recursive: true });
	success(await run(f.client, f.cache, "sync"));
	expect(await snapshot(f.client)).toEqual(before);
}, 60_000);

test("sync reconciles source selector metadata and removes deregistered sources, but does not resolve a missing pin", async () => {
	const f = await setup();
	await put(f.source, "skills/beta/SKILL.md", skill("beta"));
	await commit(f.source);
	success(await run(f.client, f.cache, "add", "skills", f.url, "team", "--path", "skills"));
	const lockBefore = await json(join(f.client, "skillbox/lock.json"));
	const config = await json(join(f.client, "skillbox/config.json"));
	config.sources[0].omit = ["beta"];
	await put(f.client, "skillbox/config.json", JSON.stringify(config));
	success(await run(f.client, f.cache, "sync"));
	const lock = await json(join(f.client, "skillbox/lock.json"));
	expect(Object.values(lock.sources)[0]).toMatchObject({
		contribution: { omit: ["beta"] },
		pin: (Object.values(lockBefore.sources)[0] as { pin: unknown }).pin,
	});
	config.sources.push({ type: "skills", id: "unregistered", source: f.url, path: "other" });
	await put(f.client, "skillbox/config.json", JSON.stringify(config));
	const before = await snapshot(f.client);
	failure(await run(f.client, f.cache, "sync"), "PIN_MISSING");
	expect(await snapshot(f.client)).toEqual(before);
	config.sources = [];
	config.install = [];
	await put(f.client, "skillbox/config.json", JSON.stringify(config));
	success(await run(f.client, f.cache, "sync"));
	expect((await json(join(f.client, "skillbox/lock.json"))).sources).toEqual({});
}, 60_000);

test("repeated add preserves its ref target, rejects a different explicit ref, and never accepts local refs", async () => {
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
			"skills",
			"--ref",
			f.revision,
		),
	);
	await put(f.source, "skills/alias/SKILL.md", skill("alpha", "new revision"));
	const next = await commit(f.source);
	const before = await snapshot(f.client);
	failure(
		await run(
			f.client,
			f.cache,
			"add",
			"skills",
			f.url,
			"team",
			"--path",
			"skills",
			"--ref",
			next,
		),
		"UPDATE_REQUIRED",
	);
	expect(await snapshot(f.client)).toEqual(before);
	success(
		await run(
			f.client,
			f.cache,
			"add",
			"skills",
			f.url,
			"team",
			"--path",
			"skills",
			"--pick",
			"alpha",
		),
	);
	expect((await json(join(f.client, "skillbox/config.json"))).sources[0].ref).toBe(f.revision);
	const local = join(f.root, "local");
	await put(local, "skills/beta/SKILL.md", skill("beta"));
	success(await run(f.client, f.cache, "add", "skills", local, "local", "--path", "skills"));
	const localBefore = await snapshot(f.client);
	failure(
		await run(
			f.client,
			f.cache,
			"add",
			"skills",
			local,
			"local",
			"--path",
			"skills",
			"--ref",
			"bogus",
		),
		"REF_UNSUPPORTED",
	);
	expect(await snapshot(f.client)).toEqual(localBefore);
}, 60_000);

test("nested authored paths inside a pinned producer retain ancestor repository, commit and root-relative provenance", async () => {
	const f = await setup();
	const producer = join(f.root, "producer");
	const url = await repository(producer);
	await put(producer, "vendor/skills/alias/SKILL.md", skill("beta"));
	success(
		await run(
			producer,
			f.cache,
			"add",
			"skills",
			"./vendor",
			"exported",
			"--path",
			"skills",
			"--no-install",
		),
	);
	const revision = await commit(producer);
	success(await run(f.client, f.cache, "add", "skillbox", url, "team", "--bundle", "exported"));
	expect((await json(join(f.client, "skillbox/lock.json"))).bundles.team.members).toEqual([
		{ name: "beta", directory: "alias", source: url, path: "vendor/skills/alias", revision },
	]);
}, 60_000);

test("capture accepts whole skill removal and writes patched skill names to accepted update provenance before sync", async () => {
	const f = await setup();
	success(await run(f.client, f.cache, "add", "skills", f.url, "team", "--path", "skills"));
	const prepared = success(await run(f.client, f.cache, "patch", "prepare", "team"));
	await put(prepared.editable, "skills/alias/SKILL.md", skill("renamed"));
	success(await run(f.client, f.cache, "patch", "capture", "team", "--from", prepared.workspace));
	await note(f.client, "team");
	success(await run(f.client, f.cache, "sync"));
	const candidate = success(await run(f.client, f.cache, "update", "team"));
	success(
		await run(f.client, f.cache, "patch", "capture", "team", "--from", candidate.workspace),
	);
	expect((await json(join(f.client, "skillbox/lock.json"))).bundles.team.members[0].name).toBe(
		"renamed",
	);
	const removal = success(
		await run(
			f.client,
			f.cache,
			"patch",
			"prepare",
			"team",
			"--output",
			"skillbox/.prepare/team/removal",
		),
	);
	await rm(join(removal.editable, "skills/alias"), { recursive: true });
	success(await run(f.client, f.cache, "patch", "capture", "team", "--from", removal.workspace));
	await note(f.client, "team");
	success(await run(f.client, f.cache, "sync"));
	expect(await readdir(join(f.client, ".agents/skills"))).toEqual([]);
}, 60_000);

test("updating a local downstream composition does not refresh upstream bundle Git pins or broaden review scope", async () => {
	const f = await setup();
	success(
		await run(
			f.client,
			f.cache,
			"add",
			"skills",
			f.url,
			"upstream",
			"--path",
			"skills",
			"--no-install",
		),
	);
	const upstream = success(await run(f.client, f.cache, "patch", "prepare", "upstream"));
	await put(upstream.editable, "skills/alias/SKILL.md", skill("alpha", "local upstream policy"));
	success(
		await run(f.client, f.cache, "patch", "capture", "upstream", "--from", upstream.workspace),
	);
	await note(f.client, "upstream");
	success(
		await run(f.client, f.cache, "add", "skillbox", ".", "downstream", "--bundle", "upstream"),
	);
	await put(f.source, "skills/alias/SKILL.md", skill("alpha", "conflicting upstream head"));
	await commit(f.source);
	const before = await json(join(f.client, "skillbox/lock.json"));
	const downstream = success(await run(f.client, f.cache, "update", "downstream"));
	success(
		await run(
			f.client,
			f.cache,
			"patch",
			"capture",
			"downstream",
			"--from",
			downstream.workspace,
		),
	);
	expect((await json(join(f.client, "skillbox/lock.json"))).sources).toEqual(before.sources);
	success(await run(f.client, f.cache, "sync"));
	expect(await readFile(join(f.client, ".agents/skills/alpha/SKILL.md"), "utf8")).toContain(
		"local upstream policy",
	);
	failure(await run(f.client, f.cache, "update", "upstream"), "UPDATE_CONFLICT");
}, 60_000);
