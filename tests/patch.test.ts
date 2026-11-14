import { afterEach, expect, test } from "bun:test";
import {
	chmod,
	lstat,
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	readlink,
	realpath,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const temporary: string[] = [];
const reason = "Prefer interfaces because this project extends shared contracts.";

interface Fixture {
	root: string;
	client: string;
	source: string;
	cache: string;
	revision: string;
}

interface Outcome {
	exitCode: number;
	stderr: string;
	response: {
		success: boolean;
		data: Record<string, unknown> | null;
		errors: { code: string; message: string }[];
	};
}

afterEach(async () => {
	await Promise.all(
		temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })),
	);
});

test("init pins and registers a bundle, creates an editable workspace, and does not install", async () => {
	const f = await fixture();
	const invalid = await initialize(f, "skillbox/patches/pstack");
	expect(invalid.response.errors.some((error) => error.code === "DESTINATION_INVALID")).toBe(
		true,
	);
	expect(await exists(join(f.client, "skillbox"))).toBe(false);
	await put(f.source, "skillbox/native/owned/SKILL.md", skill("owned", "An owned native skill."));
	expectSuccess(await run(f, "add", f.source, "native"));
	const nativeState = await projectState(f);
	const nativeLock = await json(join(f.client, "skillbox/lock.json"));

	const initialized = expectSuccess(await initialize(f));
	const workspace = requiredPath(initialized, "workspace");
	const editable = requiredPath(initialized, "editable");
	expect(workspace).toBe(join(f.client, ".skillbox-prepare-pstack"));
	expect(editable).toBe(join(workspace, "edited"));
	expect(await exists(join(editable, "skills/alpha/SKILL.md"))).toBe(true);
	expect(await liveState(f)).toEqual({
		installed: nativeState.installed,
		claude: nativeState.claude,
	});

	const lock = await json(join(f.client, "skillbox/patches/pstack/lock.json"));
	expect(lock.revision).toBe(f.revision);
	expect(lock.source).toBe(pathToFileURL(f.source).href);
	expect(lock.root).toBe("plugin");
	expect(await exists(join(f.client, ".agents/skills/alpha"))).toBe(false);

	expectSuccess(await run(f, "sync"));
	expect((await readdir(join(f.client, ".agents/skills"))).sort()).toEqual([
		"alpha",
		"beta",
		"owned",
	]);
	expect(await readlink(join(f.client, ".claude/skills"))).toBe("../.agents/skills");
	const installedLock = await json(join(f.client, "skillbox/lock.json"));
	expect(installedLock.skills.owned).toEqual(nativeLock.skills.owned);
	expect(installedLock.skills.alpha.skillPath).toBe("plugin/skills/alpha/SKILL.md");

	const other = await fixture();
	const output = join(other.root, "author-here");
	const explicit = expectSuccess(await initialize(other, output));
	expect(requiredPath(explicit, "workspace")).toBe(output);
	expect(requiredPath(explicit, "editable")).toBe(join(output, "edited"));
	expect(await exists(join(other.client, ".agents/skills/alpha"))).toBe(false);
}, 60_000);

test("capture writes replayable draft artifacts for nested, deleted, binary, and mode changes without installing", async () => {
	const f = await fixture();
	const initialized = expectSuccess(await initialize(f, join(f.root, "edit")));
	expectSuccess(await run(f, "sync"));
	const beforeCapture = await liveState(f);
	const edited = requiredPath(initialized, "editable");
	const workspace = requiredPath(initialized, "workspace");

	await put(
		edited,
		"skills/alpha/references/choice.md",
		"Use interfaces for project contracts.\n",
	);
	await put(
		edited,
		"skills/alpha/references/nested/local.md",
		"Keep the reason alongside the patch.\n",
	);
	await rm(join(edited, "skills/alpha/references/obsolete.md"));
	await writeFile(
		join(edited, "skills/alpha/references/sample.bin"),
		Buffer.from([0, 255, 3, 9, 0]),
	);
	await chmod(join(edited, "skills/alpha/scripts/run.sh"), 0o644);

	const captured = expectSuccess(await run(f, "patch", "capture", "pstack", "--from", workspace));
	expect(captured.status).toBe("captured");
	expect(captured.pendingIntents).toBe(5);
	expect(captured.intentFiles).toEqual(["skillbox/patches/pstack/alpha/patch.toml"]);
	expect(await liveState(f)).toEqual(beforeCapture);

	const manifestPath = join(f.client, "skillbox/patches/pstack/alpha/patch.toml");
	const manifest = await readFile(manifestPath, "utf8");
	for (const target of [
		"./references/choice.md",
		"./references/nested/local.md",
		"./references/obsolete.md",
		"./references/sample.bin",
		"./scripts/run.sh",
	]) {
		expect(manifest).toContain(target);
		expect(intentFor(manifest, target)).toBe("");
		await annotateIntent(manifestPath, target, `${reason} (${target})`);
	}
	const artifacts = await files(join(f.client, "skillbox/patches/pstack/alpha"));
	expect(artifacts.filter((path) => path.endsWith(".patch"))).toHaveLength(5);

	expectSuccess(await run(f, "sync"));
	expect(await exists(join(f.client, ".agents/skills/alpha/references/obsolete.md"))).toBe(false);
	expect((await lstat(join(f.client, ".agents/skills/alpha/scripts/run.sh"))).mode & 0o111).toBe(
		0,
	);
	expect(await readFile(join(f.client, ".agents/skills/alpha/references/sample.bin"))).toEqual(
		Buffer.from([0, 255, 3, 9, 0]),
	);
	const expected = await snapshot(join(f.client, ".agents/skills"));

	await rename(f.source, `${f.source}-unavailable`);
	await removeGenerated(f);
	expectSuccess(await run(f, "sync"));
	expect(await snapshot(join(f.client, ".agents/skills"))).toEqual(expected);
	expect(expectSuccess(await run(f, "sync")).status).toBe("unchanged");
}, 60_000);

test("sync rejects blank draft intents atomically", async () => {
	const f = await fixture();
	const initialized = expectSuccess(await initialize(f));
	expectSuccess(await run(f, "sync"));
	await put(
		requiredPath(initialized, "editable"),
		"skills/alpha/references/choice.md",
		"Prefer interfaces for shared contracts.\n",
	);
	const captured = expectSuccess(
		await run(
			f,
			"patch",
			"capture",
			"pstack",
			"--from",
			requiredPath(initialized, "workspace"),
		),
	);
	expect(captured.pendingIntents).toBe(1);
	const before = await projectState(f);
	const failed = await run(f, "sync");
	expect(failed.response.success).toBe(false);
	expect(failed.response.errors.some((error) => error.code === "INTENT_REQUIRED")).toBe(true);
	expect(await projectState(f)).toEqual(before);
}, 60_000);

test("manual intent and TOML formatting edits do not invalidate hashes or require recapture", async () => {
	const f = await fixture();
	const initialized = expectSuccess(await initialize(f));
	expectSuccess(await run(f, "sync"));
	const installed = await snapshot(join(f.client, ".agents/skills"));
	await put(
		requiredPath(initialized, "editable"),
		"skills/alpha/references/choice.md",
		"Prefer interfaces for shared contracts.\n",
	);
	expectSuccess(
		await run(
			f,
			"patch",
			"capture",
			"pstack",
			"--from",
			requiredPath(initialized, "workspace"),
		),
	);
	const manifestPath = join(f.client, "skillbox/patches/pstack/alpha/patch.toml");
	await annotateIntent(manifestPath, "./references/choice.md", reason);
	await writeFile(
		manifestPath,
		`# Maintainers may format and explain this file.\n\n${(await readFile(manifestPath, "utf8")).replace("schema = 1", "schema=1")}`,
	);
	expect(await snapshot(join(f.client, ".agents/skills"))).toEqual(installed);
	expectSuccess(await run(f, "sync"));
	expect(
		await readFile(join(f.client, ".agents/skills/alpha/references/choice.md"), "utf8"),
	).toContain("interfaces");

	await annotateIntent(
		manifestPath,
		"./references/choice.md",
		"Use interfaces so downstream consumers can extend the contract.",
	);
	const unchanged = expectSuccess(await run(f, "sync"));
	expect(unchanged.status).toBe("unchanged");
}, 60_000);

test("repeated capture appends diffs while preserving file intent across moved lines and later edits", async () => {
	const f = await fixture();
	const initialized = expectSuccess(await initialize(f));
	expectSuccess(await run(f, "sync"));
	const workspace = requiredPath(initialized, "workspace");
	const edited = requiredPath(initialized, "editable");
	await put(
		edited,
		"skills/alpha/references/choice.md",
		"Shared contracts\nPrefer interfaces for shared contracts.\nAdapter notes\n",
	);
	const first = expectSuccess(await run(f, "patch", "capture", "pstack", "--from", workspace));
	expect(first.pendingIntents).toBe(1);
	const manifestPath = join(f.client, "skillbox/patches/pstack/alpha/patch.toml");
	const firstManifest = await readFile(manifestPath, "utf8");
	expect(patchTargets(firstManifest)).toEqual(["./references/choice.md"]);

	await put(
		edited,
		"skills/alpha/references/choice.md",
		"Shared contracts\nAdapter notes\nPrefer interfaces for shared contracts.\n",
	);
	await annotateIntent(manifestPath, "./references/choice.md", reason);
	await put(edited, "skills/alpha/references/new.md", "A newly adapted reference.\n");
	const second = expectSuccess(await run(f, "patch", "capture", "pstack", "--from", workspace));
	expect(second.pendingIntents).toBe(1);
	expect(second.intentFiles).toEqual(["skillbox/patches/pstack/alpha/patch.toml"]);
	const secondManifest = await readFile(manifestPath, "utf8");
	expect(intentFor(secondManifest, "./references/choice.md")).toBe(reason);
	expect(intentFor(secondManifest, "./references/new.md")).toBe("");
	expect(patchTargets(secondManifest)).toEqual([
		"./references/choice.md",
		"./references/choice.md",
		"./references/new.md",
	]);

	await annotateIntent(
		manifestPath,
		"./references/new.md",
		"Add project-specific adapter guidance.",
	);
	expectSuccess(await run(f, "sync"));
	const installed = await snapshot(join(f.client, ".agents/skills"));
	await put(
		edited,
		"skills/alpha/references/choice.md",
		"Shared contracts\nAdapter notes\nPrefer interfaces for shared contracts and adapters.\n",
	);
	const third = expectSuccess(await run(f, "patch", "capture", "pstack", "--from", workspace));
	expect(third.pendingIntents).toBe(0);
	expect(await snapshot(join(f.client, ".agents/skills"))).toEqual(installed);
	const thirdManifest = await readFile(manifestPath, "utf8");
	expect(intentFor(thirdManifest, "./references/choice.md")).toBe(reason);
	expect(intentFor(thirdManifest, "./references/new.md")).toBe(
		"Add project-specific adapter guidance.",
	);
	expect(patchTargets(thirdManifest)).toEqual([
		"./references/choice.md",
		"./references/choice.md",
		"./references/new.md",
		"./references/choice.md",
	]);
	expectSuccess(await run(f, "sync"));
	expect(await readFile(join(f.client, ".agents/skills/alpha/references/new.md"), "utf8")).toBe(
		"A newly adapted reference.\n",
	);

	await put(
		edited,
		"skills/alpha/references/choice.md",
		"Prefer type aliases for shared contracts.\n",
	);
	const reverted = expectSuccess(await run(f, "patch", "capture", "pstack", "--from", workspace));
	expect(reverted.pendingIntents).toBe(0);
	const revertedManifest = await readFile(manifestPath, "utf8");
	expect(intentFor(revertedManifest, "./references/choice.md")).toBe(reason);
	expect(patchTargets(revertedManifest)).toEqual([
		"./references/choice.md",
		"./references/choice.md",
		"./references/new.md",
		"./references/choice.md",
		"./references/choice.md",
	]);
	expectSuccess(await run(f, "sync"));
	expect(
		await readFile(join(f.client, ".agents/skills/alpha/references/choice.md"), "utf8"),
	).toBe("Prefer type aliases for shared contracts.\n");
}, 60_000);

test("capture can remove a skill over multiple edits, including its remaining supporting files", async () => {
	const f = await fixture();
	const initialized = expectSuccess(await initialize(f));
	const workspace = requiredPath(initialized, "workspace");
	const editable = requiredPath(initialized, "editable");
	await rm(join(editable, "skills/alpha/SKILL.md"));
	expectSuccess(await run(f, "patch", "capture", "pstack", "--from", workspace));
	const manifestPath = join(f.client, "skillbox/patches/pstack/alpha/patch.toml");
	await annotateIntent(manifestPath, "./SKILL.md", "Omit alpha from this project.");
	await rm(join(editable, "skills/alpha"), { recursive: true });
	const captured = expectSuccess(await run(f, "patch", "capture", "pstack", "--from", workspace));
	expect(captured.changed).toBe(4);
	const manifest = await readFile(manifestPath, "utf8");
	expect(intentFor(manifest, "./SKILL.md")).toBe("Omit alpha from this project.");
	for (const target of patchTargets(manifest).filter((target) => target !== "./SKILL.md"))
		await annotateIntent(
			manifestPath,
			target,
			"Remove supporting files for the omitted skill.",
		);
	expectSuccess(await run(f, "sync"));
	expect((await readdir(join(f.client, ".agents/skills"))).sort()).toEqual(["beta"]);
}, 60_000);

test("update advances a clean source pin without installing until sync", async () => {
	const f = await fixture();
	await initializeAnnotatedChoice(f);
	const installed = await snapshot(join(f.client, ".agents/skills"));
	const installedLock = await readFile(join(f.client, "skillbox/lock.json"), "utf8");
	await put(
		f.source,
		"plugin/skills/beta/SKILL.md",
		skill("beta", "A newer upstream instruction."),
	);
	const next = await commit(f.source, "Change unrelated skill");

	const updated = expectSuccess(await run(f, "update", "pstack"));
	expect(updated.status).toBe("updated");
	expect((await json(join(f.client, "skillbox/patches/pstack/lock.json"))).revision).toBe(next);
	expect(await snapshot(join(f.client, ".agents/skills"))).toEqual(installed);
	expect(await readFile(join(f.client, "skillbox/lock.json"), "utf8")).toBe(installedLock);

	expectSuccess(await run(f, "sync"));
	expect(await readFile(join(f.client, ".agents/skills/beta/SKILL.md"), "utf8")).toContain(
		"newer upstream",
	);
	expect(
		await readFile(join(f.client, ".agents/skills/alpha/references/choice.md"), "utf8"),
	).toContain("interfaces");
	expect((await json(join(f.client, "skillbox/lock.json"))).skills.alpha.ref).toBe(next);

	await put(f.source, "plugin/README.md", "# Updated source context, unchanged skills\n");
	const docsRevision = await commit(f.source, "Update source documentation only");
	expectSuccess(await run(f, "update", "pstack"));
	expectSuccess(await run(f, "sync"));
	expect((await json(join(f.client, "skillbox/lock.json"))).skills.alpha.ref).toBe(docsRevision);
}, 60_000);

test("update conflicts preserve tracked and live state, then rename adoption captures without installing", async () => {
	const f = await fixture();
	await initializeAnnotatedChoice(f);
	const workspace = join(f.client, ".skillbox-prepare-pstack");
	await put(
		join(workspace, "edited"),
		"skills/alpha/references/choice.md",
		"Prefer interfaces for shared contracts and adapters.\n",
	);
	expectSuccess(await run(f, "patch", "capture", "pstack", "--from", workspace));
	await rename(
		join(f.source, "plugin/skills/alpha/references/choice.md"),
		join(f.source, "plugin/skills/alpha/references/preferences.md"),
	);
	await put(
		f.source,
		"plugin/skills/alpha/references/preferences.md",
		"Upstream now prefers explicit type aliases.\n",
	);
	const next = await commit(f.source, "Rename the upstream reference");
	const beforeConflict = await projectState(f);
	const conflict = await run(f, "update", "pstack", "--ref", next);
	expect(conflict.response.success).toBe(false);
	expect(conflict.response.errors.some((error) => error.code === "UPDATE_CONFLICT")).toBe(true);
	expect(await projectState(f)).toEqual(beforeConflict);

	const data = conflict.response.data!;
	const edited = requiredPath(data, "editable");
	await put(
		edited,
		"skills/alpha/references/preferences.md",
		"Prefer interfaces for extensible project contracts.\n",
	);
	await put(edited, "skills/alpha/references/unrelated.md", "This new change needs a reason.\n");
	const adopted = expectSuccess(
		await run(
			f,
			"patch",
			"adopt",
			"pstack",
			"--from",
			requiredPath(data, "workspace"),
			"--map",
			"alpha/references/choice.md=alpha/references/preferences.md",
		),
	);
	expect(adopted.pendingIntents).toBe(1);
	expect((await json(join(f.client, "skillbox/patches/pstack/lock.json"))).revision).toBe(next);
	expect(await optionalSnapshot(join(f.client, ".agents/skills"))).toEqual(
		beforeConflict.installed,
	);
	const manifestPath = join(f.client, "skillbox/patches/pstack/alpha/patch.toml");
	const manifest = await readFile(manifestPath, "utf8");
	expect(intentFor(manifest, "./references/preferences.md")).toBe(reason);
	expect(intentFor(manifest, "./references/unrelated.md")).toBe("");
	await annotateIntent(
		manifestPath,
		"./references/unrelated.md",
		"Document the renamed workflow.",
	);

	expectSuccess(await run(f, "sync"));
	expect(await exists(join(f.client, ".agents/skills/alpha/references/choice.md"))).toBe(false);
	expect(
		await readFile(join(f.client, ".agents/skills/alpha/references/preferences.md"), "utf8"),
	).toContain("interfaces");
}, 60_000);

test("sync validates patch artifacts and incomplete packs without mutating installation", async () => {
	const f = await fixture();
	await initializeAnnotatedChoice(f);
	const patchRoot = join(f.client, "skillbox/patches/pstack/alpha");
	const patch = (await files(patchRoot)).find((path) => path.endsWith(".patch"))!;
	const patchText = await readFile(join(patchRoot, patch), "utf8");
	await writeFile(
		join(patchRoot, patch),
		patchText.replace(
			"+Prefer interfaces for shared contracts.",
			"+Prefer concrete types instead.",
		),
	);
	const tampered = await projectState(f);
	const failed = await run(f, "sync");
	expect(failed.response.success).toBe(false);
	expect(await projectState(f)).toEqual(tampered);

	const other = await fixture();
	expectSuccess(await initialize(other));
	await rm(join(other.client, "skillbox/patches/pstack/lock.json"));
	const incomplete = await projectState(other);
	const invalid = await run(other, "sync");
	expect(invalid.response.success).toBe(false);
	expect(invalid.response.errors.some((error) => error.code === "PATCH_PACK_INVALID")).toBe(true);
	expect(await projectState(other)).toEqual(incomplete);

	const sourceHash = await fixture();
	expectSuccess(await initialize(sourceHash));
	const sourceLockPath = join(sourceHash.client, "skillbox/patches/pstack/lock.json");
	const sourceLock = await json(sourceLockPath);
	sourceLock.sourceHash = "0".repeat(64);
	await writeFile(sourceLockPath, `${JSON.stringify(sourceLock, null, 2)}\n`);
	const beforeSourceValidation = await liveState(sourceHash);
	expect((await run(sourceHash, "sync")).response.success).toBe(false);
	expect(await liveState(sourceHash)).toEqual(beforeSourceValidation);

	const outputHash = await fixture();
	expectSuccess(await initialize(outputHash));
	const outputLockPath = join(outputHash.client, "skillbox/patches/pstack/lock.json");
	const outputLock = await json(outputLockPath);
	outputLock.outputs.alpha = "0".repeat(64);
	await writeFile(outputLockPath, `${JSON.stringify(outputLock, null, 2)}\n`);
	const beforeOutputValidation = await liveState(outputHash);
	expect((await run(outputHash, "sync")).response.success).toBe(false);
	expect(await liveState(outputHash)).toEqual(beforeOutputValidation);
}, 60_000);

test("capture only creates artifacts when unrelated native content drifts; sync rejects the drift atomically", async () => {
	const f = await fixture();
	await put(
		f.source,
		"skillbox/native/owned/SKILL.md",
		skill("owned", "Keep the original native content."),
	);
	expectSuccess(await run(f, "add", f.source, "native"));
	const initialized = expectSuccess(await initialize(f));
	expectSuccess(await run(f, "sync"));
	await put(
		requiredPath(initialized, "editable"),
		"skills/alpha/references/choice.md",
		"Prefer interfaces for shared contracts.\n",
	);
	await put(
		f.source,
		"skillbox/native/owned/SKILL.md",
		skill("owned", "Unrelated native drift."),
	);
	const captured = expectSuccess(
		await run(
			f,
			"patch",
			"capture",
			"pstack",
			"--from",
			requiredPath(initialized, "workspace"),
		),
	);
	expect(captured.pendingIntents).toBe(1);
	const manifestPath = join(f.client, "skillbox/patches/pstack/alpha/patch.toml");
	await annotateIntent(manifestPath, "./references/choice.md", reason);
	const beforeSync = await projectState(f);
	const failed = await run(f, "sync");
	expect(failed.response.success).toBe(false);
	expect(failed.response.errors.some((error) => error.code === "LOCK_HASH_MISMATCH")).toBe(true);
	expect(await projectState(f)).toEqual(beforeSync);
}, 60_000);

test("prepare recreates an editable workspace for a draft bundle and capture rejects edits outside skills", async () => {
	const f = await fixture();
	const initialized = expectSuccess(await initialize(f));
	const invalid = await run(
		f,
		"patch",
		"prepare",
		"pstack",
		"--output",
		"skillbox/patches/pstack/review",
	);
	expect(invalid.response.errors.some((error) => error.code === "DESTINATION_INVALID")).toBe(
		true,
	);
	expect(await exists(join(f.client, "skillbox/patches/pstack/review"))).toBe(false);
	await put(
		requiredPath(initialized, "editable"),
		"skills/alpha/references/choice.md",
		"Prefer interfaces.\n",
	);
	expectSuccess(
		await run(
			f,
			"patch",
			"capture",
			"pstack",
			"--from",
			requiredPath(initialized, "workspace"),
		),
	);
	await rm(requiredPath(initialized, "workspace"), { recursive: true });
	const prepared = expectSuccess(await run(f, "patch", "prepare", "pstack"));
	expect(
		await readFile(
			join(requiredPath(prepared, "editable"), "skills/alpha/references/choice.md"),
			"utf8",
		),
	).toContain("interfaces");
	await put(
		requiredPath(prepared, "editable"),
		"README.md",
		"A change outside distributed skills.\n",
	);
	const before = await projectState(f);
	const outside = await run(
		f,
		"patch",
		"capture",
		"pstack",
		"--from",
		requiredPath(prepared, "workspace"),
	);
	expect(outside.response.success).toBe(false);
	expect(outside.response.errors.some((error) => error.code === "CAPTURE_OUTSIDE_SKILLS")).toBe(
		true,
	);
	expect(await projectState(f)).toEqual(before);
}, 60_000);

test("a cold offline sync fails without changing the recorded pin or installation", async () => {
	const f = await fixture();
	expectSuccess(await initialize(f));
	await rename(f.source, `${f.source}-unavailable`);
	expectSuccess(await run(f, "sync"));
	expect(await exists(join(f.client, ".agents/skills/alpha/SKILL.md"))).toBe(true);
	await rm(f.cache, { recursive: true, force: true });
	const before = await projectState(f);
	const failed = await run(f, "sync");
	expect(failed.response.success).toBe(false);
	expect(failed.response.errors.some((error) => error.code === "PINNED_SOURCE_UNAVAILABLE")).toBe(
		true,
	);
	expect(await projectState(f)).toEqual(before);
}, 60_000);

async function fixture(): Promise<Fixture> {
	const root = await realpath(await mkdtemp(join(tmpdir(), "skillbox-patches-")));
	temporary.push(root);
	const source = join(root, "source");
	const client = join(root, "client");
	await mkdir(source);
	await mkdir(client);
	await git(source, "init", "--quiet", "--initial-branch=main");
	await git(client, "init", "--quiet", "--initial-branch=main");
	await put(client, ".gitignore", "/.agents/skills/\n/.claude/skills\n/.skillbox-*/\n");
	await put(
		source,
		"plugin/skills/alpha/SKILL.md",
		skill("alpha", "Read [the reference](references/choice.md)."),
	);
	await put(
		source,
		"plugin/skills/alpha/references/choice.md",
		"Prefer type aliases for shared contracts.\n",
	);
	await put(source, "plugin/skills/alpha/references/obsolete.md", "A reference we may remove.\n");
	await put(source, "plugin/skills/alpha/scripts/run.sh", "#!/bin/sh\nprintf 'checked\\n'\n");
	await chmod(join(source, "plugin/skills/alpha/scripts/run.sh"), 0o755);
	await writeFile(
		join(source, "plugin/skills/alpha/references/sample.bin"),
		Buffer.from([0, 1, 2, 0]),
	);
	await put(
		source,
		"plugin/skills/beta/SKILL.md",
		skill("beta", "The original upstream instruction."),
	);
	await put(source, "plugin/README.md", "# Complete source context\n");
	await put(source, "plugin/agents/special.md", "This plugin agent must not be installed.\n");
	await put(source, "plugin/hooks/session.sh", "This plugin hook must not run.\n");
	return {
		root,
		source,
		client,
		cache: join(root, "cache"),
		revision: await commit(source, "Initial source"),
	};
}

function skill(name: string, body: string): string {
	return `---\nname: ${name}\ndescription: Test ${name} workflow.\n---\n\n# ${name}\n\n${body}\n`;
}

async function initialize(f: Fixture, output?: string): Promise<Outcome> {
	return run(
		f,
		"patch",
		"init",
		"pstack",
		"--source",
		pathToFileURL(f.source).href,
		"--root",
		"plugin",
		"--skills-root",
		"skills",
		"--ref",
		f.revision,
		"--update-ref",
		"main",
		...(output ? ["--output", output] : []),
	);
}

async function initializeAnnotatedChoice(f: Fixture): Promise<void> {
	const initialized = expectSuccess(await initialize(f));
	expectSuccess(await run(f, "sync"));
	await put(
		requiredPath(initialized, "editable"),
		"skills/alpha/references/choice.md",
		"Prefer interfaces for shared contracts.\n",
	);
	expectSuccess(
		await run(
			f,
			"patch",
			"capture",
			"pstack",
			"--from",
			requiredPath(initialized, "workspace"),
		),
	);
	await annotateIntent(
		join(f.client, "skillbox/patches/pstack/alpha/patch.toml"),
		"./references/choice.md",
		reason,
	);
	expectSuccess(await run(f, "sync"));
}

async function annotateIntent(path: string, target: string, intent: string): Promise<void> {
	const text = await readFile(path, "utf8");
	const header = `[files.${JSON.stringify(target)}]`;
	const start = text.indexOf(header);
	expect(start).toBeGreaterThanOrEqual(0);
	const end = text.indexOf("\n[", start + header.length);
	const sectionEnd = end === -1 ? text.length : end;
	const section = text.slice(start, sectionEnd);
	const updated = section.replace(/^intent\s*=.*$/m, `intent = ${JSON.stringify(intent)}`);
	expect(updated).not.toBe(section);
	await writeFile(path, `${text.slice(0, start)}${updated}${text.slice(sectionEnd)}`);
}

function intentFor(manifest: string, target: string): string {
	const header = `[files.${JSON.stringify(target)}]`;
	const start = manifest.indexOf(header);
	expect(start).toBeGreaterThanOrEqual(0);
	const end = manifest.indexOf("\n[", start + header.length);
	const section = manifest.slice(start, end === -1 ? manifest.length : end);
	const match = /^intent\s*=\s*("(?:[^"\\]|\\.)*")$/m.exec(section);
	expect(match).not.toBeNull();
	return JSON.parse(match![1]!);
}

function patchTargets(manifest: string): string[] {
	return [...manifest.matchAll(/^target\s*=\s*("(?:[^"\\]|\\.)*")$/gm)].map((match) =>
		JSON.parse(match[1]!),
	);
}

async function run(f: Fixture, ...args: string[]): Promise<Outcome> {
	const result = await processResult([process.execPath, cli, ...args], f.client, {
		SKILLBOX_CACHE_DIR: f.cache,
		NO_COLOR: "1",
		DO_NOT_TRACK: "1",
	});
	return { ...result, response: JSON.parse(result.stdout) };
}

function expectSuccess(result: Outcome): Record<string, unknown> {
	expect(result.response).toMatchObject({ success: true, errors: [] });
	expect(result.exitCode).toBe(0);
	expect(result.stderr).toBe("");
	return result.response.data!;
}

function requiredPath(data: Record<string, unknown>, key: string): string {
	expect(typeof data[key]).toBe("string");
	return data[key] as string;
}

async function processResult(command: string[], cwd: string, env: Record<string, string> = {}) {
	const child = Bun.spawn(command, {
		cwd,
		env: { ...process.env, ...env },
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

async function git(cwd: string, ...args: string[]): Promise<string> {
	const result = await processResult(["git", ...args], cwd);
	expect(result.exitCode).toBe(0);
	return result.stdout.trim();
}

async function commit(source: string, message: string): Promise<string> {
	await git(source, "add", "--all");
	await git(
		source,
		"-c",
		"user.name=Skillbox Test",
		"-c",
		"user.email=skillbox@example.test",
		"-c",
		"commit.gpgsign=false",
		"commit",
		"--quiet",
		"-m",
		message,
	);
	return git(source, "rev-parse", "HEAD");
}

async function put(root: string, path: string, contents: string): Promise<void> {
	await mkdir(dirname(join(root, path)), { recursive: true });
	await writeFile(join(root, path), contents);
}

async function json(path: string) {
	return JSON.parse(await readFile(path, "utf8"));
}

async function exists(path: string): Promise<boolean> {
	return (
		(await lstat(path).catch((error: NodeJS.ErrnoException) => {
			if (error.code === "ENOENT") return null;
			throw error;
		})) !== null
	);
}

async function files(root: string, prefix = ""): Promise<string[]> {
	const result: string[] = [];
	for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
		const path = join(prefix, entry.name);
		if (entry.isDirectory()) result.push(...(await files(root, path)));
		else result.push(path);
	}
	return result.sort();
}

async function snapshot(root: string): Promise<Record<string, unknown>> {
	const entries = await Promise.all(
		(await files(root)).map(async (path) => {
			const entry = await lstat(join(root, path));
			const content = entry.isSymbolicLink()
				? await readlink(join(root, path))
				: (await readFile(join(root, path))).toString("hex");
			return [path, { content, mode: entry.mode & 0o111 }];
		}),
	);
	return Object.fromEntries(entries);
}

async function optionalSnapshot(root: string): Promise<Record<string, unknown> | null> {
	return (await exists(root)) ? snapshot(root) : null;
}

async function optionalLink(path: string): Promise<string | null> {
	return (await exists(path)) ? readlink(path) : null;
}

async function projectState(f: Fixture) {
	return {
		tracking: await optionalSnapshot(join(f.client, "skillbox")),
		...(await liveState(f)),
	};
}

async function liveState(f: Fixture) {
	return {
		installed: await optionalSnapshot(join(f.client, ".agents/skills")),
		claude: await optionalLink(join(f.client, ".claude/skills")),
	};
}

async function removeGenerated(f: Fixture): Promise<void> {
	await rm(join(f.client, ".agents/skills"), { recursive: true, force: true });
	await rm(join(f.client, ".claude/skills"), { force: true });
}
