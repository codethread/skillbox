import { afterEach, expect, test } from "bun:test";
import { lstat, readFile, readlink, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { parse, stringify } from "yaml";
import { failure, fixture, put, run, skill, snapshot, success } from "./helpers.ts";

const roots: string[] = [];
afterEach(async () => {
	await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function setup() {
	const f = await fixture();
	roots.push(f.root);
	return { ...f, source: join(f.root, "source") };
}
function disabled(name: string) {
	return skill(name).replace(
		`name: ${name}\n`,
		`name: ${name}\ndisable-model-invocation: true\n`,
	);
}

test("sync converts only boolean true and preserves authored metadata for absent or false flags", async () => {
	const f = await setup();
	const authored = "# Keep authored formatting.\npolicy: { allow_implicit_invocation: true }\n";
	for (const [name, flag, metadata] of [
		["disabled", "true", undefined],
		["absent", undefined, undefined],
		["false-flag", "false", undefined],
		["authored", undefined, authored],
		["false-authored", "false", authored],
		["quoted", '"true"', authored],
		["unparsed", undefined, "not: [valid yaml"],
	] as const) {
		await put(
			f.source,
			`skills/${name}/SKILL.md`,
			flag === undefined
				? skill(name)
				: skill(name).replace(
						`name: ${name}\n`,
						`name: ${name}\ndisable-model-invocation: ${flag}\n`,
					),
		);
		if (metadata !== undefined)
			await put(f.source, `skills/${name}/agents/openai.yaml`, metadata);
	}
	await put(f.source, "skills/disabled/references/guide.md", "supporting resource\n");
	const sourceBefore = await snapshot(f.source);
	success(await run(f.client, f.cache, "add", "skills", f.source, "team", "--path", "skills"));
	expect(
		await readFile(join(f.client, ".agents/skills/disabled/agents/openai.yaml"), "utf8"),
	).toBe("policy:\n  allow_implicit_invocation: false\n");
	for (const name of ["absent", "false-flag"])
		expect(await readdir(join(f.client, ".agents/skills", name))).toEqual(["SKILL.md"]);
	for (const name of ["authored", "false-authored", "quoted"])
		expect(
			await readFile(join(f.client, ".agents/skills", name, "agents/openai.yaml"), "utf8"),
		).toBe(authored);
	expect(
		await readFile(join(f.client, ".agents/skills/unparsed/agents/openai.yaml"), "utf8"),
	).toBe("not: [valid yaml");
	expect(
		await readFile(join(f.client, ".agents/skills/disabled/references/guide.md"), "utf8"),
	).toBe("supporting resource\n");
	expect(await readlink(join(f.client, ".claude/skills"))).toBe("../.agents/skills");
	expect(
		await readFile(join(f.client, ".claude/skills/disabled/agents/openai.yaml"), "utf8"),
	).toBe("policy:\n  allow_implicit_invocation: false\n");
	expect(await snapshot(f.source)).toEqual(sourceBefore);
});

test("sync parses BOM and CRLF frontmatter without treating body examples as invocation metadata", async () => {
	const f = await setup();
	const body = "# Instructions\n\n---\nname: example\ndisable-model-invocation: true\n---\n";
	for (const [name, text] of [
		["bom", `\ufeff${disabled("bom")}`],
		["bom-crlf", `\ufeff${disabled("bom-crlf").replaceAll("\n", "\r\n")}`],
		["body-example", skill("body-example", body)],
	] as const)
		await put(f.source, `skills/${name}/SKILL.md`, text);
	success(await run(f.client, f.cache, "add", "skills", f.source, "team", "--path", "skills"));
	for (const name of ["bom", "bom-crlf"])
		expect(
			await readFile(join(f.client, ".agents/skills", name, "agents/openai.yaml"), "utf8"),
		).toBe("policy:\n  allow_implicit_invocation: false\n");
	expect(await readdir(join(f.client, ".agents/skills/body-example"))).toEqual(["SKILL.md"]);
	expect(await readFile(join(f.client, ".agents/skills/body-example/SKILL.md"), "utf8")).toBe(
		skill("body-example", body),
	);
});

test("add rejects body-only frontmatter lookalikes and invalid skill names without publishing", async () => {
	for (const text of [
		"# Instructions\n\n---\nname: example\ndisable-model-invocation: true\n---\n",
		"# Notes --- example\n\n---\nname: example\ndisable-model-invocation: true\n---\n",
		skill("Invalid_Name"),
	]) {
		const f = await setup();
		await put(f.source, "skills/example/SKILL.md", text);
		const before = await snapshot(f.client);
		failure(
			await run(f.client, f.cache, "add", "skills", f.source, "team", "--path", "skills"),
			"INVALID_SKILL_NAME",
		);
		expect(await snapshot(f.client)).toEqual(before);
	}
});

test("sync rejects malformed and duplicate-key YAML frontmatter without publishing", async () => {
	const f = await setup();
	await put(f.source, "skills/alpha/SKILL.md", disabled("alpha"));
	success(await run(f.client, f.cache, "add", "skills", f.source, "team", "--path", "skills"));
	const before = await snapshot(f.client);
	for (const metadata of [
		"description: [unterminated",
		"disable-model-invocation: true\ndisable-model-invocation: false",
	]) {
		await put(
			f.source,
			"skills/alpha/SKILL.md",
			`---\nname: alpha\n${metadata}\n---\nchanged body\n`,
		);
		const result = await run(f.client, f.cache, "sync");
		expect(result.exitCode).not.toBe(0);
		expect(result.response.success).toBe(false);
		expect(result.response.errors.length).toBeGreaterThan(0);
		expect(await snapshot(f.client)).toEqual(before);
	}
});

test("add never evaluates JavaScript frontmatter engines", async () => {
	const f = await setup();
	const marker = join(f.client, "executed");
	const before = await snapshot(f.client);
	for (const language of ["js", "javascript", "JavaScript"]) {
		await put(
			f.source,
			"skills/alpha/SKILL.md",
			`---${language}\n(() => { require("node:fs").writeFileSync(${JSON.stringify(marker)}, "executed"); return { name: "alpha" }; })()\n---\nbody\n`,
		);
		const result = await run(
			f.client,
			f.cache,
			"add",
			"skills",
			f.source,
			"team",
			"--path",
			"skills",
		);
		expect(result.exitCode).not.toBe(0);
		expect(result.response.success).toBe(false);
		expect(result.response.errors.length).toBeGreaterThan(0);
		expect(await snapshot(f.client)).toEqual(before);
		await expect(lstat(marker)).rejects.toMatchObject({ code: "ENOENT" });
	}
});

test("sync overrides permissive policy, preserves other metadata, and keeps existing false bytes", async () => {
	const f = await setup();
	const authored = {
		interface: { display_name: "Alpha", short_description: "Useful skill" },
		dependencies: { tools: [{ type: "mcp", value: "example" }] },
		policy: { allow_implicit_invocation: true, other_policy: "preserve" },
		custom: { nested: [1, 2] },
	};
	const alreadyFalse = "# authored\npolicy: {allow_implicit_invocation: false, extra: keep}\n";
	const noPolicy = "# Display metadata.\ninterface:\n  display_name: No policy\n";
	const aliased =
		"defaults: &defaults\n  allow_implicit_invocation: true\n  extra: keep\npolicy: *defaults\n";
	const anchored =
		"policy: &policy {allow_implicit_invocation: true, extra: keep}\ncopy: *policy\n";
	const merged =
		"defaults: &defaults {extra: keep}\npolicy:\n  <<: *defaults\n  allow_implicit_invocation: true\n";
	for (const [name, metadata] of [
		["alpha", stringify(authored)],
		["already-false", alreadyFalse],
		["no-policy", noPolicy],
		["aliased", aliased],
		["anchored", anchored],
		["merged", merged],
	] as const) {
		await put(f.source, `skills/${name}/SKILL.md`, disabled(name).replaceAll("\n", "\r\n"));
		await put(f.source, `skills/${name}/agents/openai.yaml`, metadata);
	}
	const sourceBefore = await snapshot(f.source);
	const skillsBefore = await snapshot(join(f.source, "skills"));
	success(await run(f.client, f.cache, "add", "skills", f.source, "team", "--path", "skills"));
	expect(
		parse(await readFile(join(f.client, ".agents/skills/alpha/agents/openai.yaml"), "utf8")),
	).toEqual({
		...authored,
		policy: { ...authored.policy, allow_implicit_invocation: false },
	});
	expect(
		await readFile(join(f.client, ".agents/skills/already-false/agents/openai.yaml"), "utf8"),
	).toBe(alreadyFalse);
	expect(
		parse(
			await readFile(join(f.client, ".agents/skills/no-policy/agents/openai.yaml"), "utf8"),
		),
	).toEqual({
		interface: { display_name: "No policy" },
		policy: { allow_implicit_invocation: false },
	});
	expect(
		parse(await readFile(join(f.client, ".agents/skills/aliased/agents/openai.yaml"), "utf8")),
	).toEqual({
		defaults: { allow_implicit_invocation: true, extra: "keep" },
		policy: { allow_implicit_invocation: false, extra: "keep" },
	});
	expect(
		parse(await readFile(join(f.client, ".agents/skills/anchored/agents/openai.yaml"), "utf8")),
	).toEqual({
		policy: { allow_implicit_invocation: false, extra: "keep" },
		copy: { allow_implicit_invocation: true, extra: "keep" },
	});
	expect(
		parse(await readFile(join(f.client, ".agents/skills/merged/agents/openai.yaml"), "utf8")),
	).toEqual({
		defaults: { extra: "keep" },
		policy: { extra: "keep", allow_implicit_invocation: false },
	});
	expect(await snapshot(f.source)).toEqual(sourceBefore);
	const prepared = success(await run(f.client, f.cache, "patch", "prepare", "team"));
	for (const tree of [prepared.pristine, prepared.editable])
		expect(await snapshot(join(tree, "skills"))).toEqual(skillsBefore);
	expect(
		success(
			await run(f.client, f.cache, "patch", "capture", "team", "--from", prepared.workspace),
		),
	).toMatchObject({
		status: "unchanged",
		changed: 0,
	});
});

test("installed hashes converge, repair tampering, and remove generated policy when the flag is removed", async () => {
	const f = await setup();
	const authored =
		"# Restore these bytes after flag removal.\npolicy: {allow_implicit_invocation: true}\n";
	await put(f.source, "skills/generated/SKILL.md", disabled("generated"));
	await put(f.source, "skills/authored/SKILL.md", disabled("authored"));
	await put(f.source, "skills/authored/agents/openai.yaml", authored);
	success(await run(f.client, f.cache, "add", "skills", f.source, "team", "--path", "skills"));
	const before = await snapshot(f.client);
	const lock = await readFile(join(f.client, "skillbox/lock.json"), "utf8");
	const lockStat = await lstat(join(f.client, "skillbox/lock.json"));
	expect(success(await run(f.client, f.cache, "sync"))).toMatchObject({
		status: "unchanged",
		installed: 0,
		unchanged: 2,
	});
	expect(await snapshot(f.client)).toEqual(before);
	expect((await lstat(join(f.client, "skillbox/lock.json"))).mtimeMs).toBe(lockStat.mtimeMs);
	await put(
		f.client,
		".agents/skills/generated/agents/openai.yaml",
		"policy: {allow_implicit_invocation: true}\n",
	);
	expect(success(await run(f.client, f.cache, "sync"))).toMatchObject({
		status: "synced",
		installed: 1,
		unchanged: 1,
	});
	expect(await snapshot(f.client)).toEqual(before);
	expect(await readFile(join(f.client, "skillbox/lock.json"), "utf8")).toBe(lock);
	await put(f.source, "skills/generated/SKILL.md", skill("generated"));
	await put(f.source, "skills/authored/SKILL.md", skill("authored"));
	expect(success(await run(f.client, f.cache, "sync"))).toMatchObject({ installed: 2 });
	expect(await readdir(join(f.client, ".agents/skills/generated"))).toEqual(["SKILL.md"]);
	expect(
		await readFile(join(f.client, ".agents/skills/authored/agents/openai.yaml"), "utf8"),
	).toBe(authored);
	expect(success(await run(f.client, f.cache, "sync"))).toMatchObject({ status: "unchanged" });
});

test("malformed required OpenAI metadata fails before publishing any installation or lock changes", async () => {
	const f = await setup();
	await put(f.source, "skills/alpha/SKILL.md", disabled("alpha"));
	await put(f.source, "skills/zulu/SKILL.md", disabled("zulu"));
	success(await run(f.client, f.cache, "add", "skills", f.source, "team", "--path", "skills"));
	await put(
		f.source,
		"skills/alpha/SKILL.md",
		disabled("alpha").replace("original content", "changed but not published"),
	);
	const before = await snapshot(f.client);
	for (const metadata of [
		"policy: [unterminated",
		"policy: {}\npolicy: {}\n",
		"interface: {}\n---\npolicy: {}\n",
		"- sequence\n",
		"scalar\n",
		"null\n",
		"",
		"policy: true\n",
		"policy: []\n",
		"policy: null\n",
		"interface: *missing\n",
	]) {
		await put(f.source, "skills/zulu/agents/openai.yaml", metadata);
		const result = await run(f.client, f.cache, "sync");
		failure(result, "INVALID_SKILL_METADATA");
		expect(result.response.errors).toContainEqual(
			expect.objectContaining({
				skill: "zulu",
				input: expect.stringContaining("agents/openai.yaml"),
			}),
		);
		expect(await snapshot(f.client)).toEqual(before);
	}
});

test("a captured patch controls invocation policy without adding generated metadata to patch exports", async () => {
	const f = await setup();
	await put(f.source, "skills/original-dir/SKILL.md", skill("alpha"));
	success(await run(f.client, f.cache, "add", "skills", f.source, "team", "--path", "skills"));
	const sourceBefore = await snapshot(f.source);
	const prepared = success(await run(f.client, f.cache, "patch", "prepare", "team"));
	await put(prepared.editable, "skills/original-dir/SKILL.md", disabled("alpha"));
	expect(
		success(
			await run(f.client, f.cache, "patch", "capture", "team", "--from", prepared.workspace),
		),
	).toMatchObject({
		changed: 1,
		pendingIntents: 1,
	});
	const manifestPath = "skillbox/patches/team/original-dir/patch.toml";
	const manifest = parseToml(await readFile(join(f.client, manifestPath), "utf8"));
	manifest.files = { "./SKILL.md": { intent: "Require explicit invocation for this consumer." } };
	await put(f.client, manifestPath, stringifyToml(manifest));
	success(await run(f.client, f.cache, "sync"));
	expect(await readFile(join(f.client, ".agents/skills/alpha/agents/openai.yaml"), "utf8")).toBe(
		"policy:\n  allow_implicit_invocation: false\n",
	);
	expect(await snapshot(f.source)).toEqual(sourceBefore);
	expect(await readdir(join(prepared.editable, "skills/original-dir"))).toEqual(["SKILL.md"]);
	expect(await readdir(join(prepared.pristine, "skills/original-dir"))).toEqual(["SKILL.md"]);
	const next = success(
		await run(f.client, f.cache, "patch", "prepare", "team", "--output", "next-edit"),
	);
	expect(await readFile(join(next.editable, "skills/original-dir/SKILL.md"), "utf8")).toBe(
		disabled("alpha"),
	);
	expect(await readdir(join(next.editable, "skills/original-dir"))).toEqual(["SKILL.md"]);
	expect(
		success(await run(f.client, f.cache, "patch", "capture", "team", "--from", next.workspace)),
	).toMatchObject({
		status: "unchanged",
		changed: 0,
	});
	expect(success(await run(f.client, f.cache, "sync"))).toMatchObject({ status: "unchanged" });
	await rm(join(f.client, "skillbox/patches/team"), { recursive: true });
	success(await run(f.client, f.cache, "sync"));
	expect(await readdir(join(f.client, ".agents/skills/alpha"))).toEqual(["SKILL.md"]);
});
