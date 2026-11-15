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
		expect.objectContaining({ code: "SKILL_NAME_COLLISION" }),
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

test("a preconfigured adapted subset imports atomically, keeps its pin on later adds, and restores only selected output", async () => {
	const f = await fixture();
	const consumer = await consumerDirectory(f.root, "subset-consumer");
	const cache = join(f.root, "subset-cache");
	const source = pathToFileURL(f.producer.remote).href;
	expectSuccess(await run(consumer, cache, "add", source, "native"));
	const config = await json(join(consumer, "skillbox/config.json"));
	config.sources[0].bundles.push({ bundle: "pstack", skills: ["alpha", "missing"] });
	await put(consumer, "skillbox/config.json", `${JSON.stringify(config, null, 2)}\n`);
	const beforeUnknown = await projectState(consumer);
	const unknown = await run(consumer, cache, "add", source, "pstack");
	expect(unknown.exitCode).not.toBe(0);
	expect(unknown.stderr).toBe("");
	expect(unknown.response.errors).toContainEqual(
		expect.objectContaining({
			code: "SKILL_NOT_FOUND",
			source,
			input: "pstack",
			skill: "missing",
		}),
	);
	expect(await projectState(consumer)).toEqual(beforeUnknown);
	expect(await exists(join(consumer, "skillbox/patches/pstack"))).toBe(false);

	config.sources[0].bundles[1].skills = ["alpha"];
	await put(consumer, "skillbox/config.json", `${JSON.stringify(config, null, 2)}\n`);
	const baseLock = (await json(join(consumer, "skillbox/lock.json"))).skills["native-only"];
	expect(expectSuccess(await run(consumer, cache, "add", source, "pstack"))).toMatchObject({
		status: "added",
		installed: 1,
	});
	expect((await readdir(join(consumer, ".agents/skills"))).sort()).toEqual([
		"alpha",
		"native-only",
	]);
	const installedLock = await json(join(consumer, "skillbox/lock.json"));
	expect(Object.keys(installedLock.skills).sort()).toEqual(["alpha", "native-only"]);
	expect(installedLock.skills["native-only"]).toEqual(baseLock);
	expect(installedLock.skills.alpha).toMatchObject({
		source,
		ref: f.producer.revision,
		sourceType: "git",
	});
	expect(installedLock.skills.alpha.skillPath).toBeUndefined();
	expect(
		await readFile(join(consumer, ".agents/skills/alpha/references/choice.md"), "utf8"),
	).toBe("Producer prefers interfaces.\n");
	expect(
		await readFile(join(consumer, ".agents/skills/alpha/references/nested/local.md"), "utf8"),
	).toBe("Producer-owned nested guidance.\n");
	expect((await lstat(join(consumer, ".agents/skills/alpha/scripts/run.sh"))).mode & 0o111).toBe(
		0o111,
	);
	expect(
		(await files(join(consumer, "skillbox/patches/pstack"))).filter((path) =>
			path.endsWith("patch.toml"),
		),
	).toEqual([]);
	const pack = await snapshot(join(consumer, "skillbox/patches/pstack"));
	const initialLock = await readFile(join(consumer, "skillbox/lock.json"), "utf8");

	await changeProducerChoice(
		f,
		"A newer producer revision.\n",
		"Advance producer beyond consumer subset pin",
	);
	await put(
		f.producer.author,
		"skillbox/later/later-only/SKILL.md",
		skill("later-only", "Another native bundle."),
	);
	await commitAndPush(f.producer, "Publish another native bundle");
	expect(
		expectSuccess(await run(consumer, cache, "add", source, "pstack", "later")),
	).toMatchObject({ status: "added", installed: 1 });
	expect((await json(join(consumer, "skillbox/config.json"))).sources[0].bundles).toEqual([
		"later",
		"native",
		{ bundle: "pstack", skills: ["alpha"] },
	]);
	expect((await json(join(consumer, "skillbox/lock.json"))).skills.alpha).toEqual(
		installedLock.skills.alpha,
	);
	expect(await snapshot(join(consumer, "skillbox/patches/pstack"))).toEqual(pack);
	expect(
		await readFile(join(consumer, ".agents/skills/alpha/references/choice.md"), "utf8"),
	).toBe("Producer prefers interfaces.\n");
	const beforeRepeat = await projectState(consumer);
	expect(expectSuccess(await run(consumer, cache, "add", source, "pstack"))).toMatchObject({
		status: "unchanged",
		installed: 0,
	});
	expect(await projectState(consumer)).toEqual(beforeRepeat);
	const unknownRetained = await json(join(consumer, "skillbox/config.json"));
	unknownRetained.sources[0].bundles[2].skills.push("native-only");
	await put(consumer, "skillbox/config.json", `${JSON.stringify(unknownRetained, null, 2)}\n`);
	const beforeUnknownRetained = await projectState(consumer);
	const repeatedUnknown = await run(consumer, cache, "add", source, "pstack");
	expect(repeatedUnknown.exitCode).not.toBe(0);
	expect(repeatedUnknown.stderr).toBe("");
	expect(repeatedUnknown.response.errors).toContainEqual(
		expect.objectContaining({
			code: "SKILL_NOT_FOUND",
			source,
			input: "pstack",
			skill: "native-only",
		}),
	);
	expect(await projectState(consumer)).toEqual(beforeUnknownRetained);
	unknownRetained.sources[0].bundles[2].skills = ["alpha"];
	await put(consumer, "skillbox/config.json", `${JSON.stringify(unknownRetained, null, 2)}\n`);

	await removeGenerated(consumer);
	expectSuccess(await run(consumer, cache, "sync"));
	expect((await readdir(join(consumer, ".agents/skills"))).sort()).toEqual([
		"alpha",
		"later-only",
		"native-only",
	]);
	expect(
		await readFile(join(consumer, ".agents/skills/alpha/references/choice.md"), "utf8"),
	).toBe("Producer prefers interfaces.\n");
	expect(expectSuccess(await run(consumer, cache, "sync")).status).toBe("unchanged");
	const expanded = await json(join(consumer, "skillbox/config.json"));
	expanded.sources[0].bundles[2].skills.push("gamma");
	await put(consumer, "skillbox/config.json", `${JSON.stringify(expanded, null, 2)}\n`);
	expectSuccess(await run(consumer, cache, "sync"));
	expect((await json(join(consumer, "skillbox/lock.json"))).skills.alpha).toEqual(
		JSON.parse(initialLock).skills.alpha,
	);
	expect(await readFile(join(consumer, ".agents/skills/gamma/scripts/check.sh"), "utf8")).toBe(
		"#!/bin/sh\nprintf 'gamma\\n'\n",
	);
	expanded.sources[0].bundles[2].skills = ["gamma"];
	await put(consumer, "skillbox/config.json", `${JSON.stringify(expanded, null, 2)}\n`);
	expectSuccess(await run(consumer, cache, "sync"));
	expect((await readdir(join(consumer, ".agents/skills"))).sort()).toEqual([
		"gamma",
		"later-only",
		"native-only",
	]);
	expect(await snapshot(join(consumer, "skillbox/patches/pstack"))).toEqual(pack);
}, 90_000);

test("adapted subsets omit false collisions without bypassing unselected producer intent validation", async () => {
	const f = await fixture();
	const consumer = await consumerDirectory(f.root, "subset-collision-consumer");
	const cache = join(f.root, "subset-collision-cache");
	const source = pathToFileURL(f.producer.remote).href;
	await put(
		f.producer.author,
		"skillbox/collision/alpha/SKILL.md",
		skill("alpha", "Native collision owner."),
	);
	await commitAndPush(f.producer, "Publish a colliding native skill");
	expectSuccess(await run(consumer, cache, "add", source, "collision"));
	const config = await json(join(consumer, "skillbox/config.json"));
	config.sources[0].bundles.push({ bundle: "pstack", skills: ["gamma"] });
	await put(consumer, "skillbox/config.json", `${JSON.stringify(config, null, 2)}\n`);

	const prepared = expectSuccess(
		await run(f.producer.author, f.producerCache, "patch", "prepare", "pstack"),
	);
	await put(
		requiredPath(prepared, "editable"),
		"skills/alpha/references/pending.md",
		"Unselected producer guidance requires intent.\n",
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
	await commitAndPush(f.producer, "Publish unselected guidance without intent");
	const beforeIntent = await projectState(consumer);
	const failed = await run(consumer, cache, "add", source, "pstack");
	expect(failed.exitCode).not.toBe(0);
	expect(failed.stderr).toBe("");
	expect(failed.response.errors).toContainEqual(
		expect.objectContaining({ code: "PRODUCER_INTENT_REQUIRED" }),
	);
	expect(await projectState(consumer)).toEqual(beforeIntent);
	await annotateBlankIntents(
		join(f.producer.author, "skillbox/patches/pstack"),
		"Keep the producer's unselected guidance valid.",
	);
	await commitAndPush(f.producer, "Document producer intent");
	config.sources[0].bundles[1].skills = ["alpha"];
	await put(consumer, "skillbox/config.json", `${JSON.stringify(config, null, 2)}\n`);
	const beforeImportCollision = await projectState(consumer);
	const importCollision = await run(consumer, cache, "add", source, "pstack");
	expect(importCollision.exitCode).not.toBe(0);
	expect(importCollision.stderr).toBe("");
	expect(importCollision.response.errors).toContainEqual(
		expect.objectContaining({ code: "SKILL_NAME_COLLISION", skill: "alpha" }),
	);
	expect(await projectState(consumer)).toEqual(beforeImportCollision);
	config.sources[0].bundles[1].skills = ["gamma"];
	await put(consumer, "skillbox/config.json", `${JSON.stringify(config, null, 2)}\n`);
	expect(expectSuccess(await run(consumer, cache, "add", source, "pstack"))).toMatchObject({
		installed: 1,
	});
	expect((await readdir(join(consumer, ".agents/skills"))).sort()).toEqual(["alpha", "gamma"]);
	expect(await readFile(join(consumer, ".agents/skills/alpha/SKILL.md"), "utf8")).toContain(
		"Native collision owner.",
	);
	const local = expectSuccess(await run(consumer, cache, "patch", "prepare", "pstack"));
	await put(
		requiredPath(local, "editable"),
		"skills/alpha/references/consumer-pending.md",
		"Unselected consumer guidance still needs intent.\n",
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
	const beforeLocalIntent = await projectState(consumer);
	const localIntent = await run(consumer, cache, "add", source, "pstack");
	expect(localIntent.exitCode).not.toBe(0);
	expect(localIntent.stderr).toBe("");
	expect(localIntent.response.errors).toContainEqual(
		expect.objectContaining({ code: "INTENT_REQUIRED", skill: "alpha" }),
	);
	expect(await projectState(consumer)).toEqual(beforeLocalIntent);
	await annotateBlankIntents(
		join(consumer, "skillbox/patches/pstack"),
		"Keep the complete consumer patch layer valid.",
	);
	expectSuccess(await run(consumer, cache, "sync"));
	config.sources[0].bundles[1].skills.push("alpha");
	await put(consumer, "skillbox/config.json", `${JSON.stringify(config, null, 2)}\n`);
	const beforeCollision = await projectState(consumer);
	const collision = await run(consumer, cache, "sync");
	expect(collision.exitCode).not.toBe(0);
	expect(collision.stderr).toBe("");
	expect(collision.response.errors).toContainEqual(
		expect.objectContaining({ code: "SKILL_NAME_COLLISION", skill: "alpha" }),
	);
	expect(await projectState(consumer)).toEqual(beforeCollision);
}, 90_000);

test("a metadata-only export preserves alias files and modes through nested imports and cold restoration", async () => {
	const { run, ...f } = await exportFixture();
	const pack = join(f.producer.author, "skillbox/patches/deslop");
	expect(await files(pack)).toEqual(["bundle.toml", "lock.json"]);
	const originalPack = await snapshot(pack);
	const expected = await snapshot(join(f.upstream.author, "plugin/skills/alias-folder"));
	expect(await snapshot(join(f.producer.author, ".agents/skills/deslop"))).toEqual(expected);
	expect((await readdir(join(requiredPath(f.prepared, "editable"), "skills"))).sort()).toEqual([
		"alias-folder",
		"other",
	]);
	expect(
		expectSuccess(
			await run(
				f.producer.author,
				f.producerCache,
				"patch",
				"capture",
				"deslop",
				"--from",
				requiredPath(f.prepared, "workspace"),
			),
		).status,
	).toBe("unchanged");
	expect(await snapshot(pack)).toEqual(originalPack);

	const consumer = await consumerDirectory(f.root, "selected-consumer");
	const cache = join(f.root, "selected-cache");
	const source = `${f.source}#${f.producer.revision}`;
	expect(expectSuccess(await run(consumer, cache, "add", source, "deslop"))).toMatchObject({
		installed: 1,
	});
	expect(await readdir(join(consumer, ".agents/skills"))).toEqual(["deslop"]);
	expect(await snapshot(join(consumer, ".agents/skills/deslop"))).toEqual(expected);
	const consumerPack = join(consumer, "skillbox/patches/deslop");
	expect(await files(consumerPack)).toEqual(["bundle.toml", "lock.json"]);
	expect(await readFile(join(consumerPack, "bundle.toml"), "utf8")).not.toContain(
		"export_skills",
	);
	const prepared = expectSuccess(await run(consumer, cache, "patch", "prepare", "deslop"));
	const pristine = join(requiredPath(prepared, "workspace"), "pristine/skills");
	expect(await readdir(pristine)).toEqual(["alias-folder"]);
	expect(await snapshot(join(pristine, "alias-folder"))).toEqual(expected);

	const config = await json(join(consumer, "skillbox/config.json"));
	for (const name of ["other", "alias-folder"]) {
		config.sources[0].bundles = [{ bundle: "deslop", skills: [name] }];
		await put(consumer, "skillbox/config.json", `${JSON.stringify(config)}\n`);
		const before = await projectState(consumer);
		expectFailure(await run(consumer, cache, "sync"), "SKILL_NOT_FOUND");
		expect(await projectState(consumer)).toEqual(before);
	}
	config.sources[0].bundles = [{ bundle: "deslop", skills: ["deslop"] }];
	await put(consumer, "skillbox/config.json", `${JSON.stringify(config)}\n`);
	expectSuccess(await run(consumer, cache, "sync"));
	await setExportSkills(consumerPack, ["deslop", "deslop"]);
	expect(
		expectSuccess(
			await run(
				consumer,
				cache,
				"patch",
				"capture",
				"deslop",
				"--from",
				requiredPath(prepared, "workspace"),
			),
		).status,
	).toBe("unchanged");
	const intermediatePin = await commit(consumer, "Publish a selected imported bundle");
	await git(f.root, "clone", "--quiet", "--bare", consumer, join(f.root, "intermediate.git"));

	const nested = await consumerDirectory(f.root, "nested-consumer");
	const nestedCache = join(f.root, "nested-cache");
	expectSuccess(
		await run(
			nested,
			nestedCache,
			"add",
			`https://skillbox-export.invalid/intermediate.git#${intermediatePin}`,
			"deslop",
		),
	);
	expect(await readdir(join(nested, ".agents/skills"))).toEqual(["deslop"]);
	expect(await snapshot(join(nested, ".agents/skills/deslop"))).toEqual(expected);
	expect(await files(join(nested, "skillbox/patches/deslop"))).toEqual([
		"bundle.toml",
		"lock.json",
	]);
	await commit(nested, "Track the nested export");
	const cold = join(f.root, "cold-selected-consumer");
	await git(f.root, "clone", "--quiet", nested, cold);
	const coldCache = join(f.root, "cold-selected-cache");
	expectSuccess(await run(cold, coldCache, "sync"));
	expect(await snapshot(join(cold, ".agents/skills"))).toEqual(
		await snapshot(join(nested, ".agents/skills")),
	);
	const beforeRepeat = await projectState(cold);
	const times = await modificationTimes(cold, [
		"skillbox/lock.json",
		".agents/skills/deslop/scripts/run.sh",
	]);
	expect(expectSuccess(await run(cold, coldCache, "sync")).status).toBe("unchanged");
	expect(await projectState(cold)).toEqual(beforeRepeat);
	expect(
		await modificationTimes(cold, [
			"skillbox/lock.json",
			".agents/skills/deslop/scripts/run.sh",
		]),
	).toEqual(times);

	await put(
		consumer,
		"skillbox/deslop/native/SKILL.md",
		skill("native", "An ambiguous native export beside the imported pack."),
	);
	const ambiguousPin = await commit(consumer, "Introduce an ambiguous intermediate export");
	await git(consumer, "push", "--quiet", join(f.root, "intermediate.git"), "main");
	const beforeAmbiguous = await projectState(nested);
	expectFailure(
		await run(nested, nestedCache, "update", "deslop", "--ref", ambiguousPin),
		"BUNDLE_SOURCE_AMBIGUOUS",
	);
	expect(await projectState(nested)).toEqual(beforeAmbiguous);
}, 90_000);

test("first export customization keeps its Git descriptor and explicit update accepts the prepared producer pin", async () => {
	const { run, ...f } = await exportFixture();
	const pack = join(f.producer.author, "skillbox/patches/deslop");
	const descriptor = await readFile(join(pack, "bundle.toml"), "utf8");
	const originalLock = await json(join(pack, "lock.json"));
	const consumer = await consumerDirectory(f.root, "pinned-export-consumer");
	const cache = join(f.root, "pinned-export-cache");
	expectSuccess(
		await run(consumer, cache, "add", `${f.source}#${f.producer.revision}`, "deslop"),
	);
	const installed = await snapshot(join(consumer, ".agents/skills"));

	await put(
		requiredPath(f.prepared, "editable"),
		"skills/alias-folder/references/nested/choice.md",
		"The producer's first customization.\n",
	);
	const captured = expectSuccess(
		await run(
			f.producer.author,
			f.producerCache,
			"patch",
			"capture",
			"deslop",
			"--from",
			requiredPath(f.prepared, "workspace"),
		),
	);
	expect(captured).toMatchObject({ changed: 1, pendingIntents: 1 });
	expect(await readFile(join(pack, "bundle.toml"), "utf8")).toBe(descriptor);
	const customizedLock = await json(join(pack, "lock.json"));
	expect(customizedLock).toMatchObject({
		pin: originalLock.pin,
		sourceHash: originalLock.sourceHash,
	});
	expect(customizedLock.patchHash).not.toBe(originalLock.patchHash);
	expect(await files(pack)).toEqual([
		"alias-folder/changes/0001-captured.patch",
		"alias-folder/patch.toml",
		"bundle.toml",
		"lock.json",
	]);
	await annotateBlankIntents(pack, "Customize the selected upstream guidance.");
	expectSuccess(await run(f.producer.author, f.producerCache, "sync"));
	const candidatePin = await commitAndPush(f.producer, "Publish the first optional patch");
	const before = await projectState(consumer);
	expect(expectSuccess(await run(consumer, cache, "sync")).status).toBe("unchanged");
	const staged = expectSuccess(
		await run(consumer, cache, "update", "deslop", "--ref", candidatePin),
	);
	expect(staged).toMatchObject({
		status: "prepared",
		to: { type: "git", revision: candidatePin },
	});
	expect(await projectState(consumer)).toEqual(before);
	await put(
		f.producer.author,
		"skillbox/later/later/SKILL.md",
		skill("later", "Advance the producer after preparation."),
	);
	const laterPin = await commitAndPush(f.producer, "Advance beyond the prepared pin");
	expectSuccess(
		await run(
			consumer,
			cache,
			"patch",
			"capture",
			"deslop",
			"--from",
			requiredPath(staged, "workspace"),
		),
	);
	const accepted = await json(join(consumer, "skillbox/patches/deslop/lock.json"));
	expect(accepted.pin).toMatchObject({ type: "git", revision: candidatePin });
	expect(accepted.pin.revision).not.toBe(laterPin);
	expect(await snapshot(join(consumer, ".agents/skills"))).toEqual(installed);
	expect(await files(join(consumer, "skillbox/patches/deslop"))).toEqual([
		"bundle.toml",
		"lock.json",
	]);
	expectSuccess(await run(consumer, cache, "sync"));
	expect(
		await readFile(join(consumer, ".agents/skills/deslop/references/nested/choice.md"), "utf8"),
	).toBe("The producer's first customization.\n");
	expect(await readFile(join(pack, "bundle.toml"), "utf8")).toBe(descriptor);
	expect((await json(join(pack, "lock.json"))).pin).toEqual(originalLock.pin);
}, 90_000);

test("export policy changes need no recapture but invalid selectors and unselected members fail atomically", async () => {
	const { run, ...f } = await exportFixture();
	const pack = join(f.producer.author, "skillbox/patches/deslop");
	const consumer = await consumerDirectory(f.root, "invalid-export-consumer");
	const cache = join(f.root, "invalid-export-cache");
	const capture = () =>
		run(
			f.producer.author,
			f.producerCache,
			"patch",
			"capture",
			"deslop",
			"--from",
			requiredPath(f.prepared, "workspace"),
		);
	const originalLock = await json(join(pack, "lock.json"));
	for (const selection of [["missing"], ["alias-folder"], [], [""]]) {
		await setExportSkills(pack, selection);
		const beforeProducer = await projectState(f.producer.author);
		const beforeConsumer = await projectState(consumer);
		const code = selection.length && selection[0] ? "SKILL_NOT_FOUND" : "PATCH_PACK_INVALID";
		expectFailure(await capture(), code);
		expectFailure(await run(f.producer.author, f.producerCache, "sync"), code);
		expectFailure(await run(consumer, cache, "add", f.producer.author, "deslop"), code);
		expect(await projectState(f.producer.author)).toEqual(beforeProducer);
		expect(await projectState(consumer)).toEqual(beforeConsumer);
	}
	await setExportSkills(pack, ["other"]);
	expect(expectSuccess(await capture()).status).toBe("unchanged");
	expectSuccess(await run(f.producer.author, f.producerCache, "sync"));
	expect(await readdir(join(f.producer.author, ".agents/skills"))).toEqual(["other"]);
	expect(await json(join(pack, "lock.json"))).toEqual(originalLock);
	await setExportSkills(pack, ["deslop"]);
	expectSuccess(await run(f.producer.author, f.producerCache, "sync"));

	const editable = requiredPath(f.prepared, "editable");
	for (const invalid of [
		{
			content: skill("BadName", "Invalid content must not hide outside the export."),
			code: "INVALID_SKILL_NAME",
		},
		{
			content: "---\nname: other\n---\nMissing the required description.\n",
			code: "SKILLS_SKILL_SKIPPED",
		},
	]) {
		await put(editable, "skills/other/SKILL.md", invalid.content);
		const beforeInvalid = await projectState(f.producer.author);
		expectFailure(await capture(), invalid.code);
		expect(await projectState(f.producer.author)).toEqual(beforeInvalid);
	}
	await put(editable, "skills/other/SKILL.md", skill("other", "The original sibling."));
	await put(
		editable,
		"skills/duplicate/SKILL.md",
		skill("other", "A second unselected sibling with the same name."),
	);
	const beforeDuplicate = await projectState(f.producer.author);
	expectFailure(await capture(), "SKILLS_DUPLICATE_SKILL_NAME");
	expect(await projectState(f.producer.author)).toEqual(beforeDuplicate);
	await rm(join(editable, "skills/duplicate"), { recursive: true });
	await put(
		editable,
		"skills/other/SKILL.md",
		skill("renamed-other", "A post-patch frontmatter name."),
	);
	expect(expectSuccess(await capture()).pendingIntents).toBe(1);
	const beforeIntent = await projectState(f.producer.author);
	const beforeImport = await projectState(consumer);
	expectFailure(await run(f.producer.author, f.producerCache, "sync"), "INTENT_REQUIRED");
	expectFailure(
		await run(consumer, cache, "add", f.producer.author, "deslop"),
		"PRODUCER_INTENT_REQUIRED",
	);
	expect(await projectState(f.producer.author)).toEqual(beforeIntent);
	expect(await projectState(consumer)).toEqual(beforeImport);
	await annotateBlankIntents(pack, "Rename the unselected sibling for its own users.");
	expectSuccess(await run(consumer, cache, "add", f.producer.author, "deslop"));
	expect(await readdir(join(consumer, ".agents/skills"))).toEqual(["deslop"]);
	const patchedLock = await json(join(pack, "lock.json"));
	await setExportSkills(pack, ["renamed-other"]);
	expectSuccess(await run(f.producer.author, f.producerCache, "sync"));
	expect(await readdir(join(f.producer.author, ".agents/skills"))).toEqual(["renamed-other"]);
	expect(await json(join(pack, "lock.json"))).toEqual(patchedLock);
	const renamed = await consumerDirectory(f.root, "renamed-export-consumer");
	expectSuccess(await run(renamed, cache, "add", f.producer.author, "deslop"));
	const prepared = expectSuccess(await run(renamed, cache, "patch", "prepare", "deslop"));
	expect(await readdir(join(requiredPath(prepared, "workspace"), "pristine/skills"))).toEqual([
		"other",
	]);
}, 90_000);

test("selected exports validate only their own full bundle during multi-bundle sync", async () => {
	const { run, ...f } = await exportFixture();
	await put(
		f.upstream.author,
		"earlier/skills/first/SKILL.md",
		skill("first", "This skill belongs to the earlier bundle."),
	);
	await commitAndPush(f.upstream, "Publish a distinct earlier bundle");
	expectSuccess(
		await run(
			f.producer.author,
			f.producerCache,
			"patch",
			"init",
			"a-prior",
			"--source",
			pathToFileURL(f.upstream.remote).href,
			"--root",
			"earlier",
			"--skills-root",
			"skills",
			"--ref",
			f.upstream.revision,
		),
	);
	const config = await json(join(f.producer.author, "skillbox/config.json"));
	expect(config.sources[0].bundles).toEqual(["a-prior", "deslop"]);
	expectSuccess(await run(f.producer.author, f.producerCache, "sync"));
	expect((await readdir(join(f.producer.author, ".agents/skills"))).sort()).toEqual([
		"deslop",
		"first",
	]);
	const before = await projectState(f.producer.author);
	expect(expectSuccess(await run(f.producer.author, f.producerCache, "sync")).status).toBe(
		"unchanged",
	);
	expect(await projectState(f.producer.author)).toEqual(before);

	await put(
		requiredPath(f.prepared, "editable"),
		"skills/other/SKILL.md",
		skill("first", "This unselected sibling is not the earlier bundle's skill."),
	);
	expectSuccess(
		await run(
			f.producer.author,
			f.producerCache,
			"patch",
			"capture",
			"deslop",
			"--from",
			requiredPath(f.prepared, "workspace"),
		),
	);
	await annotateBlankIntents(
		join(f.producer.author, "skillbox/patches/deslop"),
		"Rename an unselected sibling without publishing it.",
	);
	expectSuccess(await run(f.producer.author, f.producerCache, "sync"));
	expect(await readFile(join(f.producer.author, ".agents/skills/first/SKILL.md"), "utf8")).toBe(
		skill("first", "This skill belongs to the earlier bundle."),
	);
	expect((await readdir(join(f.producer.author, ".agents/skills"))).sort()).toEqual([
		"deslop",
		"first",
	]);
	const beforeRepeat = await projectState(f.producer.author);
	expect(expectSuccess(await run(f.producer.author, f.producerCache, "sync")).status).toBe(
		"unchanged",
	);
	expect(await projectState(f.producer.author)).toEqual(beforeRepeat);
}, 90_000);

async function exportFixture() {
	const root = await realpath(await mkdtemp(join(tmpdir(), "skillbox-export-")));
	temporary.push(root);
	const upstream = await repository(root, "upstream");
	await put(upstream.author, "plugin/LICENSE", "License outside the exported skill.\n");
	await put(
		upstream.author,
		"plugin/skills/alias-folder/SKILL.md",
		skill("deslop", "Read [the choice](references/nested/choice.md)."),
	);
	await put(
		upstream.author,
		"plugin/skills/alias-folder/references/nested/choice.md",
		"Original upstream guidance.\n",
	);
	await put(
		upstream.author,
		"plugin/skills/alias-folder/scripts/run.sh",
		"#!/bin/sh\nprintf 'deslop\\n'\n",
	);
	await chmod(join(upstream.author, "plugin/skills/alias-folder/scripts/run.sh"), 0o755);
	await writeFile(
		join(upstream.author, "plugin/skills/alias-folder/references/data.bin"),
		new Uint8Array([0, 255, 1, 128]),
	);
	await put(
		upstream.author,
		"plugin/skills/other/SKILL.md",
		skill("other", "Keep this sibling editable but do not export it."),
	);
	upstream.revision = await commitAndPush(upstream, "Seed upstream skills with an aliased name");
	const producer = await repository(root, "producer");
	const producerCache = join(root, "producer-cache");
	await put(
		producer.author,
		".gitignore",
		"/.agents/\n/.claude/\n/.skillbox-*/\n/skillbox/.prepare/\n",
	);
	const prepared = expectSuccess(
		await run(
			producer.author,
			producerCache,
			"patch",
			"init",
			"deslop",
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
	await setExportSkills(join(producer.author, "skillbox/patches/deslop"), ["deslop"]);
	expectSuccess(await run(producer.author, producerCache, "sync"));
	producer.revision = await commitAndPush(
		producer,
		"Publish only pinned metadata and an export selector",
	);
	const gitConfig = join(root, "gitconfig");
	await git(
		root,
		"config",
		"--file",
		gitConfig,
		`url.${pathToFileURL(root).href}/.insteadOf`,
		"https://skillbox-export.invalid/",
	);
	return {
		root,
		upstream,
		producer,
		producerCache,
		prepared,
		source: "https://skillbox-export.invalid/producer.git",
		run: (cwd: string, cache: string, ...args: string[]) =>
			runWithEnv(
				{ GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_NOSYSTEM: "1" },
				cwd,
				cache,
				...args,
			),
	};
}

async function setExportSkills(pack: string, skills: string[]): Promise<void> {
	const path = join(pack, "bundle.toml");
	const descriptor = (await readFile(path, "utf8")).replace(/^export_skills\s*=.*\n?/gm, "");
	await writeFile(path, `${descriptor.trimEnd()}\nexport_skills = ${JSON.stringify(skills)}\n`);
}

function expectFailure(result: Outcome, code: string): void {
	expect(result.exitCode).not.toBe(0);
	expect(result.stderr).toBe("");
	expect(result.response.success).toBe(false);
	expect(result.response.errors).toContainEqual(expect.objectContaining({ code }));
}

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
	await put(
		producer.author,
		".gitignore",
		"/.agents/\n/.claude/\n/.skillbox-*/\n/skillbox/.prepare/\n",
	);
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
	await put(
		directory,
		".gitignore",
		"/.agents/\n/.claude/\n/.skillbox-*/\n/skillbox/.prepare/\n",
	);
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
	return runWithEnv({}, cwd, cache, ...args);
}

async function runWithEnv(
	env: Record<string, string>,
	cwd: string,
	cache: string,
	...args: string[]
): Promise<Outcome> {
	const result = await processResult([process.execPath, cli, ...args], cwd, {
		...env,
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
		if (entry.name === ".prepare") continue;
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
