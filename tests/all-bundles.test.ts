import { expect, test } from "bun:test";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
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

test("all imports enumerate shared exports and repeated add preserves all with named selectors", async () => {
	const f = await fixture();
	try {
		const producer = join(f.root, "producer");
		const url = await repository(producer);
		await put(producer, "skillbox/first/alpha/SKILL.md", skill("alpha"));
		await put(producer, "skillbox/first/extra/SKILL.md", skill("extra"));
		await put(producer, "skillbox/second/beta/SKILL.md", skill("beta"));
		await put(producer, "skillbox/.local/fake/SKILL.md", skill("fake"));
		await put(producer, "skillbox/.local/patches/private/SKILL.md", skill("private"));
		await put(producer, "skillbox/.prepare/fake/SKILL.md", skill("fake"));
		await put(producer, "raw/gamma/SKILL.md", skill("gamma"));
		success(
			await run(
				producer,
				f.cache,
				"add",
				"skills",
				".",
				"composed",
				"--path",
				"raw",
				"--no-install",
			),
		);
		await put(producer, "skillbox/.local/config.json", "{poisoned");
		await commit(producer);
		for (const [index, source] of [producer, url].entries()) {
			const client = join(f.root, `client-${index}`);
			await mkdir(client);
			success(
				await run(
					client,
					f.cache,
					"add",
					"skillbox",
					source,
					"all",
					"--pick",
					'{"first":["alpha"]}',
				),
			);
			expect((await readdir(join(client, ".agents/skills"))).sort()).toEqual([
				"alpha",
				"beta",
				"gamma",
			]);
			success(
				await run(
					client,
					f.cache,
					"add",
					"skillbox",
					source,
					"all",
					"--bundle",
					"second",
					"--omit",
					'{"second":["beta"]}',
				),
			);
			expect(
				(await json(join(client, "skillbox/config.json"))).sources[0].bundles,
			).toBeUndefined();
			expect((await readdir(join(client, ".agents/skills"))).sort()).toEqual([
				"alpha",
				"gamma",
			]);
			success(await run(client, f.cache, "add", "skillbox", source, "all"));
			expect((await readdir(join(client, ".agents/skills"))).sort()).toEqual([
				"alpha",
				"beta",
				"extra",
				"gamma",
			]);
			expect(await readFile(join(client, ".agents/skills/gamma/SKILL.md"), "utf8")).toBe(
				skill("gamma"),
			);
			const before = await snapshot(client);
			failure(
				await run(
					client,
					f.cache,
					"add",
					"skillbox",
					source,
					"all",
					"--pick",
					'{"missing":["alpha"]}',
				),
				"BUNDLE_NOT_FOUND",
			);
			expect(await snapshot(client)).toEqual(before);
			failure(
				await run(
					client,
					f.cache,
					"add",
					"skillbox",
					source,
					"all",
					"--omit",
					'{"first":["missing"]}',
				),
				"SKILL_NOT_FOUND",
			);
			expect(await snapshot(client)).toEqual(before);
		}
	} finally {
		await rm(f.root, { recursive: true, force: true });
	}
}, 60_000);
