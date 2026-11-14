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
	stat,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const temporary: string[] = [];

interface Repository {
	author: string;
	remote: string;
	revision: string;
}

interface Fixture {
	root: string;
	upstream: Repository;
	producer: Repository;
	producerCache: string;
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

test("a consumer imports a pinned adapted bundle, owns only its local layer, and restores it reproducibly", async () => {
	const f = await fixture();
	const consumer = await consumerDirectory(f.root, "consumer");
	const cache = join(f.root, "consumer-cache");
	const producerSource = pathToFileURL(f.producer.remote).href;

	const added = expectSuccess(
		await run(consumer, cache, "add", producerSource, "pstack", "native"),
	);
	expect(added).toMatchObject({ status: "added", installed: 3 });
	expect((await readdir(join(consumer, ".agents/skills"))).sort()).toEqual([
		"alpha",
		"gamma",
		"native-only",
	]);
	expect(
		await readFile(join(consumer, ".agents/skills/alpha/references/choice.md"), "utf8"),
	).toBe("Producer prefers interfaces.\n");
	expect(
		await readFile(join(consumer, ".agents/skills/alpha/references/nested/local.md"), "utf8"),
	).toBe("Producer-owned nested guidance.\n");
	expect(await exists(join(consumer, ".agents/skills/alpha/references/obsolete.md"))).toBe(false);
	expect(await exists(join(consumer, ".agents/skills/beta"))).toBe(false);
	expect(
		(await lstat(join(consumer, ".agents/skills/alpha/scripts/run.sh"))).mode & 0o111,
	).not.toBe(0);
	expect(
		(await lstat(join(consumer, ".agents/skills/gamma/scripts/check.sh"))).mode & 0o111,
	).not.toBe(0);

	const producerLock = await json(join(f.producer.author, "skillbox/patches/pstack/lock.json"));
	expect(producerLock.pin).toMatchObject({ type: "git", revision: f.upstream.revision });
	const consumerPatchLock = await readFile(
		join(consumer, "skillbox/patches/pstack/lock.json"),
		"utf8",
	);
	expect(consumerPatchLock).toContain(f.producer.revision);
	const installedLock = await json(join(consumer, "skillbox/lock.json"));
	expect(installedLock.skills.alpha).toMatchObject({
		source: producerSource,
		ref: f.producer.revision,
	});
	expect(
		(await files(join(consumer, "skillbox/patches/pstack"))).filter((path) =>
			path.endsWith("patch.toml"),
		),
	).toEqual([]);

	const consumerPack = join(consumer, "skillbox/patches/pstack");
	const savedPack = join(f.root, "saved-consumer-pstack-pack");
	await rename(consumerPack, savedPack);
	const beforeMissingPack = await projectState(consumer);
	const missingPack = await run(consumer, cache, "add", producerSource, "pstack");
	expect(missingPack.response.success).toBe(false);
	expect(missingPack.response.errors).toContainEqual(
		expect.objectContaining({ code: "PATCH_PACK_NOT_FOUND" }),
	);
	expect(await projectState(consumer)).toEqual(beforeMissingPack);
	await rename(savedPack, consumerPack);

	const prepared = expectSuccess(await run(consumer, cache, "patch", "prepare", "pstack"));
	await put(
		requiredPath(prepared, "editable"),
		"skills/alpha/references/consumer.md",
		"Consumer-owned guidance.\n",
	);
	const captured = expectSuccess(
		await run(
			consumer,
			cache,
			"patch",
			"capture",
			"pstack",
			"--from",
			requiredPath(prepared, "workspace"),
		),
	);
	expect(captured.pendingIntents).toBe(1);
	await annotateBlankIntents(
		join(consumer, "skillbox/patches/pstack"),
		"Keep consumer guidance distinct from the producer adaptation.",
	);
	await put(
		consumer,
		"skillbox/local/consumer-note/SKILL.md",
		skill("consumer-note", "This skill belongs only to the consumer."),
	);
	expectSuccess(await run(consumer, cache, "add", ".", "local"));
	expectSuccess(await run(consumer, cache, "sync"));
	expect(
		await readFile(join(consumer, ".agents/skills/alpha/references/consumer.md"), "utf8"),
	).toBe("Consumer-owned guidance.\n");
	expect(
		await readFile(join(consumer, ".agents/skills/consumer-note/SKILL.md"), "utf8"),
	).toContain("belongs only to the consumer");
	const localManifest = await readFile(
		join(consumer, "skillbox/patches/pstack/alpha/patch.toml"),
		"utf8",
	);
	expect(localManifest).toContain("Keep consumer guidance distinct");
	expect(localManifest).not.toContain("Producer-owned nested guidance");

	await writeFile(
		join(consumer, "skillbox/config.json"),
		`${JSON.stringify(
			{
				sources: [
					{ source: producerSource, bundles: ["pstack"] },
					{ source: ".", bundles: ["local"] },
				],
			},
			null,
			2,
		)}\n`,
	);
	expectSuccess(await run(consumer, cache, "sync"));
	expect(await exists(join(consumer, ".agents/skills/native-only"))).toBe(false);

	const unavailableUpstream = `${f.upstream.remote}-unavailable`;
	const unavailableProducer = `${f.producer.remote}-unavailable`;
	await rename(f.upstream.remote, unavailableUpstream);
	await rename(f.producer.remote, unavailableProducer);
	await removeGenerated(consumer);
	expectSuccess(await run(consumer, cache, "sync"));
	const restored = await snapshot(join(consumer, ".agents/skills"));
	const trackedTimes = await modificationTimes(consumer, [
		"skillbox/config.json",
		"skillbox/lock.json",
		".agents/skills/alpha/SKILL.md",
		".agents/skills/alpha/references/consumer.md",
		".agents/skills/consumer-note/SKILL.md",
	]);
	await Bun.sleep(20);
	expect(expectSuccess(await run(consumer, cache, "sync")).status).toBe("unchanged");
	expect(
		await modificationTimes(consumer, [
			"skillbox/config.json",
			"skillbox/lock.json",
			".agents/skills/alpha/SKILL.md",
			".agents/skills/alpha/references/consumer.md",
			".agents/skills/consumer-note/SKILL.md",
		]),
	).toEqual(trackedTimes);

	await rename(unavailableUpstream, f.upstream.remote);
	await rename(unavailableProducer, f.producer.remote);
	await git(consumer, "add", ".gitignore", "skillbox");
	await commit(consumer, "Track consumer bundle selection and local ownership");
	const cold = join(f.root, "cold-consumer");
	await git(f.root, "clone", "--quiet", consumer, cold);
	expectSuccess(await run(cold, join(f.root, "cold-cache"), "sync"));
	expect(await snapshot(join(cold, ".agents/skills"))).toEqual(restored);
}, 90_000);

test("consumer updates stage an exact producer commit and preserve prior state through conflicts", async () => {
	const f = await fixture();
	const consumer = await consumerDirectory(f.root, "consumer-update");
	const cache = join(f.root, "update-cache");
	const producerSource = pathToFileURL(f.producer.remote).href;
	const producerOne = f.producer.revision;
	expectSuccess(await run(consumer, cache, "add", producerSource, "pstack"));
	const originalInstalled = await snapshot(join(consumer, ".agents/skills"));

	const producerTwo = await changeProducerChoice(
		f,
		"Producer requires explicit interfaces.\n",
		"Refine the producer adaptation",
	);
	const beforeRepeatedAdd = await projectState(consumer);
	expect(
		expectSuccess(await run(consumer, cache, "add", producerSource, "pstack")),
	).toMatchObject({
		status: "unchanged",
		installed: 0,
	});
	expect(await projectState(consumer)).toEqual(beforeRepeatedAdd);
	expect(expectSuccess(await run(consumer, cache, "sync")).status).toBe("unchanged");
	expect(await snapshot(join(consumer, ".agents/skills"))).toEqual(originalInstalled);

	const beforeUpdate = await projectState(consumer);
	const staged = expectSuccess(await run(consumer, cache, "update", "pstack"));
	expect(staged).toMatchObject({
		status: "prepared",
		from: { type: "git", revision: producerOne },
		to: { type: "git", revision: producerTwo },
		conflicts: [],
	});
	expect(await projectState(consumer)).toEqual(beforeUpdate);
	expect(
		await readFile(
			join(requiredPath(staged, "editable"), "skills/alpha/references/choice.md"),
			"utf8",
		),
	).toBe("Producer requires explicit interfaces.\n");

	await put(
		f.producer.author,
		"skillbox/native/native-only/references/later.md",
		"A later producer commit.\n",
	);
	const producerThree = await commitAndPush(f.producer, "Push after consumer preparation");
	const accepted = expectSuccess(
		await run(
			consumer,
			cache,
			"patch",
			"capture",
			"pstack",
			"--from",
			requiredPath(staged, "workspace"),
		),
	);
	expect(accepted.pendingIntents).toBe(0);
	const acceptedLock = await readFile(
		join(consumer, "skillbox/patches/pstack/lock.json"),
		"utf8",
	);
	expect(acceptedLock).toContain(producerTwo);
	expect(acceptedLock).not.toContain(producerThree);
	expect(await snapshot(join(consumer, ".agents/skills"))).toEqual(originalInstalled);
	expectSuccess(await run(consumer, cache, "sync"));
	expect(
		await readFile(join(consumer, ".agents/skills/alpha/references/choice.md"), "utf8"),
	).toBe("Producer requires explicit interfaces.\n");

	const local = expectSuccess(await run(consumer, cache, "patch", "prepare", "pstack"));
	await put(
		requiredPath(local, "editable"),
		"skills/alpha/references/choice.md",
		"Consumer requires project-specific interfaces.\n",
	);
	expectSuccess(
		await run(
			consumer,
			cache,
			"patch",
			"capture",
			"pstack",
			"--from",
			requiredPath(local, "workspace"),
		),
	);
	await annotateBlankIntents(
		join(consumer, "skillbox/patches/pstack"),
		"Preserve the consumer's project-specific interface rule.",
	);
	expectSuccess(await run(consumer, cache, "sync"));

	const producerFour = await changeProducerChoice(
		f,
		"Producer replaced the interface rule entirely.\n",
		"Replace the producer interface rule",
	);
	const beforeConflict = await projectState(consumer);
	const producerState = await snapshot(join(f.producer.author, "skillbox"));
	const conflicted = await run(consumer, cache, "update", "pstack");
	expect(conflicted.response.success).toBe(false);
	expect(conflicted.response.errors.some((error) => error.code === "UPDATE_CONFLICT")).toBe(true);
	expect(conflicted.response.data).toMatchObject({
		status: "conflicted",
		from: { type: "git", revision: producerTwo },
		to: { type: "git", revision: producerFour },
		conflicts: [{ skill: "alpha", target: "./references/choice.md" }],
	});
	expect(await projectState(consumer)).toEqual(beforeConflict);
	expect(await snapshot(join(f.producer.author, "skillbox"))).toEqual(producerState);

	const candidate = conflicted.response.data!;
	await put(
		requiredPath(candidate, "editable"),
		"skills/alpha/references/choice.md",
		"Producer replaced the interface rule entirely.\nConsumer requires project-specific interfaces.\n",
	);
	const resolved = expectSuccess(
		await run(
			consumer,
			cache,
			"patch",
			"capture",
			"pstack",
			"--from",
			requiredPath(candidate, "workspace"),
		),
	);
	expect(resolved.pendingIntents).toBe(0);
	expect(await projectState(consumer)).not.toEqual(beforeConflict);
	expectSuccess(await run(consumer, cache, "sync"));
	expect(
		await readFile(join(consumer, ".agents/skills/alpha/references/choice.md"), "utf8"),
	).toBe(
		"Producer replaced the interface rule entirely.\nConsumer requires project-specific interfaces.\n",
	);
}, 90_000);

test("a local producer stays on a digest snapshot until explicit update and cold replay verifies it", async () => {
	const f = await fixture();
	const consumer = await consumerDirectory(f.root, "local-consumer");
	const cache = join(f.root, "local-consumer-cache");
	expectSuccess(await run(consumer, cache, "add", f.producer.author, "pstack"));
	const initialLock = await json(join(consumer, "skillbox/patches/pstack/lock.json"));
	expect(initialLock.pin).toMatchObject({ type: "local", digest: expect.any(String) });
	const initialPin = initialLock.pin as { type: "local"; digest: string };
	const beforeInvalidRef = await projectState(consumer);
	const invalidRef = await run(consumer, cache, "update", "pstack", "--ref", "main");
	expect(invalidRef.response.success).toBe(false);
	expect(invalidRef.response.errors).toContainEqual(
		expect.objectContaining({ code: "REF_UNSUPPORTED" }),
	);
	expect(await projectState(consumer)).toEqual(beforeInvalidRef);

	await put(
		f.producer.author,
		"skillbox/native/native-only/references/unrelated.md",
		"An unrelated producer bundle edit.\n",
	);
	const unrelated = expectSuccess(await run(consumer, cache, "update", "pstack"));
	expect(unrelated).toMatchObject({ from: initialPin, to: initialPin, conflicts: [] });
	await rm(requiredPath(unrelated, "workspace"), { recursive: true, force: true });

	const producerTwo = await changeProducerChoice(
		f,
		"Local producer requires explicit interfaces.\n",
		"Change the selected local producer bundle",
	);
	expect(expectSuccess(await run(consumer, cache, "sync")).status).toBe("unchanged");
	expect(
		await readFile(join(consumer, ".agents/skills/alpha/references/choice.md"), "utf8"),
	).toBe("Producer prefers interfaces.\n");

	const staged = expectSuccess(await run(consumer, cache, "update", "pstack"));
	expect(staged.from).toEqual(initialPin);
	expect(staged.to).toMatchObject({ type: "local", digest: expect.any(String) });
	const candidatePin = staged.to as { type: "local"; digest: string };
	expect(candidatePin.digest).not.toBe(initialPin.digest);
	expect(
		await readFile(
			join(requiredPath(staged, "editable"), "skills/alpha/references/choice.md"),
			"utf8",
		),
	).toBe("Local producer requires explicit interfaces.\n");

	await changeProducerChoice(
		f,
		"Local producer changed again after staging.\n",
		"Advance the local producer after consumer preparation",
	);
	expectSuccess(
		await run(
			consumer,
			cache,
			"patch",
			"capture",
			"pstack",
			"--from",
			requiredPath(staged, "workspace"),
		),
	);
	expectSuccess(await run(consumer, cache, "sync"));
	expect(
		await readFile(join(consumer, ".agents/skills/alpha/references/choice.md"), "utf8"),
	).toBe("Local producer requires explicit interfaces.\n");
	const acceptedLock = await json(join(consumer, "skillbox/patches/pstack/lock.json"));
	expect(acceptedLock.pin).toEqual(candidatePin);

	await git(consumer, "add", ".gitignore", "skillbox");
	await commit(consumer, "Track the local producer snapshot");
	const cold = join(f.root, "cold-local-consumer");
	await git(f.root, "clone", "--quiet", consumer, cold);
	const beforeFailure = await projectState(cold);
	const failed = await run(cold, join(f.root, "cold-local-cache"), "sync");
	expect(failed.response.success).toBe(false);
	expect(
		failed.response.errors.some((error) => error.code === "PRODUCER_SNAPSHOT_UNAVAILABLE"),
	).toBe(true);
	expect(await projectState(cold)).toEqual(beforeFailure);

	await git(f.producer.author, "reset", "--hard", "--quiet", producerTwo);
	expectSuccess(await run(cold, join(f.root, "cold-local-cache"), "sync"));
	expect(await readFile(join(cold, ".agents/skills/alpha/references/choice.md"), "utf8")).toBe(
		"Local producer requires explicit interfaces.\n",
	);
}, 90_000);

test("producer intent failures and mixed-source skill collisions leave a new consumer untouched", async () => {
	const f = await fixture();
	const producerSource = pathToFileURL(f.producer.remote).href;
	const prepared = expectSuccess(
		await run(f.producer.author, f.producerCache, "patch", "prepare", "pstack"),
	);
	await put(
		requiredPath(prepared, "editable"),
		"skills/alpha/references/pending.md",
		"A producer change without intent.\n",
	);
	expectSuccess(
		await run(
			f.producer.author,
			f.producerCache,
			"patch",
			"capture",
			"pstack",
			"--from",
			requiredPath(prepared, "workspace"),
		),
	);
	await commitAndPush(f.producer, "Publish a producer draft with missing intent");

	const invalidConsumer = await consumerDirectory(f.root, "invalid-consumer");
	const invalidBefore = await snapshot(invalidConsumer);
	const invalid = await run(
		invalidConsumer,
		join(f.root, "invalid-cache"),
		"add",
		producerSource,
		"pstack",
	);
	expect(invalid.response.success).toBe(false);
	expect(invalid.response.errors.some((error) => error.code === "PRODUCER_INTENT_REQUIRED")).toBe(
		true,
	);
	expect(await snapshot(invalidConsumer)).toEqual(invalidBefore);

	await annotateBlankIntents(
		join(f.producer.author, "skillbox/patches/pstack"),
		"Explain the producer's pending reference.",
	);
	expectSuccess(await run(f.producer.author, f.producerCache, "sync"));
	await put(
		f.producer.author,
		"skillbox/collision/alpha/SKILL.md",
		skill("alpha", "A native skill colliding with the adapted output."),
	);
	await commitAndPush(f.producer, "Add a colliding native bundle");

	const collisionConsumer = await consumerDirectory(f.root, "collision-consumer");
	const collisionBefore = await snapshot(collisionConsumer);
	const collision = await run(
		collisionConsumer,
		join(f.root, "collision-cache"),
		"add",
		producerSource,
		"pstack",
		"collision",
	);
	expect(collision.response.success).toBe(false);
	expect(collision.response.errors.some((error) => error.code === "SKILL_NAME_COLLISION")).toBe(
		true,
	);
	expect(await snapshot(collisionConsumer)).toEqual(collisionBefore);
}, 90_000);

async function fixture(): Promise<Fixture> {
	const root = await realpath(await mkdtemp(join(tmpdir(), "skillbox-consumer-")));
	temporary.push(root);
	const upstream = await repository(root, "upstream");
	await put(
		upstream.author,
		"plugin/skills/alpha/SKILL.md",
		skill("alpha", "Read [the choice](references/choice.md)."),
	);
	await put(
		upstream.author,
		"plugin/skills/alpha/references/choice.md",
		"Upstream prefers type aliases.\n",
	);
	await put(
		upstream.author,
		"plugin/skills/alpha/references/obsolete.md",
		"Obsolete upstream guidance.\n",
	);
	await put(
		upstream.author,
		"plugin/skills/alpha/scripts/run.sh",
		"#!/bin/sh\nprintf 'alpha\\n'\n",
	);
	await chmod(join(upstream.author, "plugin/skills/alpha/scripts/run.sh"), 0o644);
	await put(
		upstream.author,
		"plugin/skills/beta/SKILL.md",
		skill("beta", "A skill removed by the producer."),
	);
	upstream.revision = await commitAndPush(upstream, "Seed raw upstream skills");

	const producer = await repository(root, "producer");
	const producerCache = join(root, "producer-cache");
	await put(producer.author, ".gitignore", "/.agents/\n/.claude/\n/.skillbox-*/\n");
	const initialized = expectSuccess(
		await run(
			producer.author,
			producerCache,
			"patch",
			"init",
			"pstack",
			"--source",
			pathToFileURL(upstream.remote).href,
			"--root",
			"plugin",
			"--skills-root",
			"skills",
			"--ref",
			upstream.revision,
			"--update-ref",
			"main",
		),
	);
	const editable = requiredPath(initialized, "editable");
	await put(editable, "skills/alpha/references/choice.md", "Producer prefers interfaces.\n");
	await put(
		editable,
		"skills/alpha/references/nested/local.md",
		"Producer-owned nested guidance.\n",
	);
	await rm(join(editable, "skills/alpha/references/obsolete.md"));
	await chmod(join(editable, "skills/alpha/scripts/run.sh"), 0o755);
	await rm(join(editable, "skills/beta"), { recursive: true });
	await put(
		editable,
		"skills/gamma/SKILL.md",
		skill("gamma", "A new skill from the producer adaptation."),
	);
	await put(editable, "skills/gamma/scripts/check.sh", "#!/bin/sh\nprintf 'gamma\\n'\n");
	await chmod(join(editable, "skills/gamma/scripts/check.sh"), 0o755);
	const captured = expectSuccess(
		await run(
			producer.author,
			producerCache,
			"patch",
			"capture",
			"pstack",
			"--from",
			requiredPath(initialized, "workspace"),
		),
	);
	expect(captured.pendingIntents).toBeGreaterThan(0);
	await annotateBlankIntents(
		join(producer.author, "skillbox/patches/pstack"),
		"Adapt the upstream file for all downstream consumers.",
	);
	await put(
		producer.author,
		"skillbox/native/native-only/SKILL.md",
		skill("native-only", "A native producer skill."),
	);
	expectSuccess(await run(producer.author, producerCache, "sync"));
	await rm(requiredPath(initialized, "workspace"), { recursive: true, force: true });
	await git(producer.author, "add", ".gitignore", "skillbox");
	const tracked = await git(producer.author, "diff", "--cached", "--name-only");
	expect(
		tracked
			.split("\n")
			.filter(Boolean)
			.every((path) => path === ".gitignore" || path.startsWith("skillbox/")),
	).toBe(true);
	producer.revision = await commitAndPush(producer, "Publish the adapted pstack bundle");
	return { root, upstream, producer, producerCache };
}

async function changeProducerChoice(
	f: Fixture,
	contents: string,
	message: string,
): Promise<string> {
	const prepared = expectSuccess(
		await run(f.producer.author, f.producerCache, "patch", "prepare", "pstack"),
	);
	await put(requiredPath(prepared, "editable"), "skills/alpha/references/choice.md", contents);
	expectSuccess(
		await run(
			f.producer.author,
			f.producerCache,
			"patch",
			"capture",
			"pstack",
			"--from",
			requiredPath(prepared, "workspace"),
		),
	);
	await annotateBlankIntents(
		join(f.producer.author, "skillbox/patches/pstack"),
		"Keep the producer's shared interface guidance current.",
	);
	expectSuccess(await run(f.producer.author, f.producerCache, "sync"));
	await rm(requiredPath(prepared, "workspace"), { recursive: true, force: true });
	return commitAndPush(f.producer, message);
}

async function repository(root: string, name: string): Promise<Repository> {
	const author = join(root, `${name}-author`);
	const remote = join(root, `${name}.git`);
	await mkdir(author);
	await git(root, "init", "--bare", "--quiet", remote);
	await git(author, "init", "--quiet", "--initial-branch=main");
	await git(author, "remote", "add", "origin", remote);
	return { author, remote, revision: "" };
}

async function consumerDirectory(root: string, name: string): Promise<string> {
	const directory = join(root, name);
	await mkdir(directory);
	await git(directory, "init", "--quiet", "--initial-branch=main");
	await put(directory, ".gitignore", "/.agents/\n/.claude/\n/.skillbox-*/\n");
	return directory;
}

function skill(name: string, body: string): string {
	return `---\nname: ${name}\ndescription: Test ${name} workflow.\n---\n\n# ${name}\n\n${body}\n`;
}

async function annotateBlankIntents(root: string, intent: string): Promise<void> {
	for (const path of (await files(root)).filter((path) => path.endsWith("patch.toml"))) {
		const manifest = join(root, path);
		const text = await readFile(manifest, "utf8");
		await writeFile(
			manifest,
			text.replace(/^intent\s*=\s*""$/gm, `intent = ${JSON.stringify(intent)}`),
		);
	}
}

async function run(cwd: string, cache: string, ...args: string[]): Promise<Outcome> {
	const result = await processResult([process.execPath, cli, ...args], cwd, {
		SKILLBOX_CACHE_DIR: cache,
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

async function commitAndPush(repository: Repository, message: string): Promise<string> {
	const revision = await commit(repository.author, message);
	await git(repository.author, "push", "--quiet", "--set-upstream", "origin", "main");
	repository.revision = revision;
	return revision;
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
			const content = (await readFile(join(root, path))).toString("hex");
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

async function projectState(workspace: string) {
	return {
		tracking: await optionalSnapshot(join(workspace, "skillbox")),
		installed: await optionalSnapshot(join(workspace, ".agents/skills")),
		claude: await optionalLink(join(workspace, ".claude/skills")),
	};
}

async function removeGenerated(workspace: string): Promise<void> {
	await rm(join(workspace, ".agents"), { recursive: true, force: true });
	await rm(join(workspace, ".claude"), { recursive: true, force: true });
}

async function modificationTimes(root: string, paths: string[]): Promise<Record<string, number>> {
	return Object.fromEntries(
		await Promise.all(
			paths.map(async (path) => [path, (await stat(join(root, path))).mtimeMs]),
		),
	);
}
