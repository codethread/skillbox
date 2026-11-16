import { expect, test } from "bun:test";
import { mkdir, readFile, readlink, realpath, rename, rm, symlink } from "node:fs/promises";
import { basename, join } from "node:path";
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

async function personalWorkspace() {
	const f = await fixture();
	try {
		await put(f.client, "skillbox/team/alpha/SKILL.md", skill("alpha"));
		success(await run(f.client, f.cache, "add", "skillbox", ".", "team", "--bundle", "team"));
		await put(
			f.client,
			"skillbox/.local/config.json",
			JSON.stringify({
				sources: [{ type: "skillbox", id: "team", source: ".", bundles: ["team"] }],
				install: ["team"],
			}),
		);
		success(await run(f.client, f.cache, "sync"));
		return f;
	} catch (cause) {
		await rm(f.root, { recursive: true, force: true });
		throw cause;
	}
}

test("cold shared restoration remembers a private lock before it is subsequently lost", async () => {
	const f = await fixture();
	try {
		const raw = join(f.root, "raw");
		const url = await repository(raw);
		await put(raw, "skills/alpha/SKILL.md", skill("alpha", "pinned A"));
		await commit(raw);
		await put(f.client, "skillbox/config.json", JSON.stringify({ sources: [], install: [] }));
		success(await run(f.client, f.cache, "sync"));
		await put(
			f.client,
			"skillbox/.local/config.json",
			JSON.stringify({
				sources: [{ type: "skills", id: "team", source: url, path: "skills" }],
				install: ["team"],
			}),
		);
		success(await run(f.client, f.cache, "sync"));
		await rename(join(f.client, "skillbox/.local/config.json"), join(f.root, "saved.json"));
		await rm(join(f.client, "skillbox/.local/install-state.json"));
		await rm(join(f.client, ".agents"), { recursive: true });
		await rm(join(f.client, ".claude"), { recursive: true });
		success(await run(f.client, f.cache, "sync"));
		await rm(join(f.client, "skillbox/.local/lock.json"));
		await put(raw, "skills/alpha/SKILL.md", skill("alpha", "advanced B"));
		await commit(raw);
		await rename(join(f.root, "saved.json"), join(f.client, "skillbox/.local/config.json"));
		const before = await snapshot(f.client);
		failure(await run(f.client, f.cache, "sync"), "LOCK_MISSING");
		expect(await snapshot(f.client)).toEqual(before);
		expect(await json(join(f.client, "skillbox/.local/install-state.json"))).toMatchObject({
			owner: "shared",
			personalInitialized: true,
		});
	} finally {
		await rm(f.root, { recursive: true, force: true });
	}
}, 60_000);

for (const [privatePath, sharedPath, target] of [
	[".local/patches", "patches", "../patches"],
	[".local", ".", "."],
] as const) {
	test(`personal commands reject an aliased ${privatePath} parent before preparing`, async () => {
		const f = await personalWorkspace();
		try {
			await mkdir(join(f.client, "skillbox", sharedPath), { recursive: true });
			if (privatePath === ".local")
				await rename(join(f.client, "skillbox/.local"), join(f.root, "private-state"));
			await symlink(target, join(f.client, "skillbox", privatePath));
			const before = await snapshot(f.client);
			for (const args of [
				["patch", "prepare", "team"],
				["update", "team"],
				["sync"],
				["add", "skillbox", ".", "team", "--bundle", "team"],
			]) {
				failure(await run(f.client, f.cache, ...args), "SOURCE_PATH_UNSAFE");
				expect(await snapshot(f.client)).toEqual(before);
			}
		} finally {
			await rm(f.root, { recursive: true, force: true });
		}
	}, 60_000);

	test(`capture rejects an aliased ${privatePath} parent introduced after preparation`, async () => {
		const f = await personalWorkspace();
		try {
			const prepared = success(await run(f.client, f.cache, "patch", "prepare", "team"));
			await put(prepared.editable, "skills/alpha/SKILL.md", skill("alpha", "private edit"));
			await mkdir(join(f.client, "skillbox", sharedPath), { recursive: true });
			if (privatePath === ".local")
				await rename(join(f.client, "skillbox/.local"), join(f.root, "private-state"));
			await symlink(target, join(f.client, "skillbox", privatePath));
			const before = await snapshot(f.client);
			const preparationBefore = await snapshot(join(f.client, "skillbox/.prepare"));
			failure(
				await run(
					f.client,
					f.cache,
					"patch",
					"capture",
					"team",
					"--from",
					prepared.workspace,
				),
				"SOURCE_PATH_UNSAFE",
			);
			expect(await snapshot(f.client)).toEqual(before);
			expect(await snapshot(join(f.client, "skillbox/.prepare"))).toEqual(preparationBefore);
		} finally {
			await rm(f.root, { recursive: true, force: true });
		}
	}, 60_000);
}

for (const kind of ["shared", "local"] as const) {
	test(`${kind} preparation rejects a symlinked common preparation parent without blocking sync`, async () => {
		const f = await personalWorkspace();
		try {
			if (kind === "shared") await rm(join(f.client, "skillbox/.local/config.json"));
			success(await run(f.client, f.cache, "sync"));
			await mkdir(join(f.client, "preparation-store"));
			await symlink("../preparation-store", join(f.client, "skillbox/.prepare"));
			expect(await readlink(join(f.client, "skillbox/.prepare"))).toBe(
				"../preparation-store",
			);
			const before = await snapshot(f.client);
			for (const args of [
				["patch", "prepare", "team"],
				["update", "team"],
			]) {
				failure(await run(f.client, f.cache, ...args), "SOURCE_PATH_UNSAFE");
				expect(await snapshot(f.client)).toEqual(before);
			}
			expect(success(await run(f.client, f.cache, "sync"))).toMatchObject({
				status: "unchanged",
			});
			expect(await snapshot(f.client)).toEqual(before);
			expect(await readlink(join(f.client, "skillbox/.prepare"))).toBe(
				"../preparation-store",
			);
		} finally {
			await rm(f.root, { recursive: true, force: true });
		}
	}, 60_000);

	test(`${kind} preparations reject nested directory aliases for default and custom locations`, async () => {
		const f = await personalWorkspace();
		try {
			if (kind === "shared") await rm(join(f.client, "skillbox/.local/config.json"));
			await mkdir(join(f.client, "skillbox/.prepare/storage/team"), { recursive: true });
			await symlink("storage/team", join(f.client, "skillbox/.prepare/team"));
			let before = await snapshot(join(f.client, "skillbox/.prepare"));
			for (const args of [
				["patch", "prepare", "team"],
				["update", "team"],
			]) {
				failure(await run(f.client, f.cache, ...args), "SOURCE_PATH_UNSAFE");
				expect(await snapshot(join(f.client, "skillbox/.prepare"))).toEqual(before);
			}
			await rm(join(f.client, "skillbox/.prepare/team"));
			await mkdir(join(f.client, "skillbox/.prepare/team"));
			await symlink("../storage/team", join(f.client, "skillbox/.prepare/team/alias"));
			before = await snapshot(join(f.client, "skillbox/.prepare"));
			failure(
				await run(
					f.client,
					f.cache,
					"patch",
					"prepare",
					"team",
					"--output",
					"skillbox/.prepare/team/alias/edit",
				),
				"SOURCE_PATH_UNSAFE",
			);
			expect(await snapshot(join(f.client, "skillbox/.prepare"))).toEqual(before);
		} finally {
			await rm(f.root, { recursive: true, force: true });
		}
	}, 60_000);
}

test("first-use dangling private state files are not permission to resolve fresh pins", async () => {
	const f = await fixture();
	try {
		await put(f.client, "raw/alpha/SKILL.md", skill("alpha"));
		await put(
			f.client,
			"skillbox/.local/config.json",
			JSON.stringify({
				sources: [{ type: "skills", id: "team", source: ".", path: "raw" }],
				install: ["team"],
			}),
		);
		await symlink("missing.json", join(f.client, "skillbox/.local/lock.json"));
		const before = await snapshot(f.client);
		for (const args of [
			["sync"],
			["add", "skills", ".", "team", "--path", "raw"],
			["patch", "prepare", "team"],
			["update", "team"],
		]) {
			failure(await run(f.client, f.cache, ...args), "SOURCE_PATH_UNSAFE");
			expect(await snapshot(f.client)).toEqual(before);
		}
		await rm(join(f.client, "skillbox/.local/lock.json"));
		await symlink("missing.json", join(f.client, "skillbox/.local/install-state.json"));
		const receiptBefore = await snapshot(f.client);
		for (const args of [["sync"], ["add", "skills", ".", "team", "--path", "raw"]]) {
			failure(await run(f.client, f.cache, ...args), "SOURCE_PATH_UNSAFE");
			expect(await snapshot(f.client)).toEqual(receiptBefore);
		}
	} finally {
		await rm(f.root, { recursive: true, force: true });
	}
}, 60_000);

test("selected workspace metadata cannot be redirected through a skillbox root alias", async () => {
	const f = await fixture();
	try {
		await put(f.client, "raw/alpha/SKILL.md", skill("alpha"));
		await put(
			f.client,
			"skillbox/.local/config.json",
			JSON.stringify({
				sources: [{ type: "skills", id: "team", source: ".", path: "raw" }],
				install: ["team"],
			}),
		);
		await rename(join(f.client, "skillbox"), join(f.client, "aliased-tracking"));
		await symlink("aliased-tracking", join(f.client, "skillbox"));
		const before = await snapshot(f.client);
		failure(await run(f.client, f.cache, "sync"), "SOURCE_PATH_UNSAFE");
		expect(await snapshot(f.client)).toEqual(before);
	} finally {
		await rm(f.root, { recursive: true, force: true });
	}
}, 60_000);

test("capture rejects a nested preparation alias introduced after preparation", async () => {
	const f = await personalWorkspace();
	try {
		const prepared = success(await run(f.client, f.cache, "patch", "prepare", "team"));
		await put(prepared.editable, "skills/alpha/SKILL.md", skill("alpha", "private edit"));
		await rename(
			join(f.client, "skillbox/.prepare/team"),
			join(f.client, "skillbox/.prepare/stored"),
		);
		await symlink("stored", join(f.client, "skillbox/.prepare/team"));
		const before = await snapshot(f.client);
		const sharedBefore = await snapshot(join(f.client, "skillbox/.prepare"));
		failure(
			await run(f.client, f.cache, "patch", "capture", "team", "--from", prepared.workspace),
			"SOURCE_PATH_UNSAFE",
		);
		expect(await snapshot(f.client)).toEqual(before);
		expect(await snapshot(join(f.client, "skillbox/.prepare"))).toEqual(sharedBefore);
	} finally {
		await rm(f.root, { recursive: true, force: true });
	}
}, 60_000);

test("producer ownership validates shared paths without inspecting private or preparation aliases", async () => {
	const f = await fixture();
	try {
		const producer = join(f.root, "producer");
		await put(producer, "raw/alpha/SKILL.md", skill("alpha"));
		success(
			await run(
				producer,
				f.cache,
				"add",
				"skills",
				".",
				"team",
				"--path",
				"raw",
				"--no-install",
			),
		);
		await mkdir(join(producer, "skillbox/patches"));
		await symlink("patches", join(producer, "skillbox/.prepare"));
		await put(producer, "skillbox/.local/config.json", "{invalid");
		await symlink("../patches", join(producer, "skillbox/.local/patches"));
		await symlink("missing.json", join(producer, "skillbox/.local/lock.json"));
		success(
			await run(f.client, f.cache, "add", "skillbox", producer, "team", "--bundle", "team"),
		);
		await rename(join(producer, "skillbox/patches"), join(producer, "patch-store"));
		await symlink("../patch-store", join(producer, "skillbox/patches"));
		const before = await snapshot(f.client);
		const producerBefore = await snapshot(producer);
		failure(await run(f.client, f.cache, "sync"), "SOURCE_PATH_UNSAFE");
		expect(await snapshot(f.client)).toEqual(before);
		expect(await snapshot(producer)).toEqual(producerBefore);
	} finally {
		await rm(f.root, { recursive: true, force: true });
	}
}, 60_000);

test("custom preparation output cannot alias shared tracking from outside skillbox", async () => {
	const f = await personalWorkspace();
	try {
		await mkdir(join(f.client, "skillbox/patches"));
		await symlink("skillbox/patches", join(f.client, "scratch"));
		const before = await snapshot(f.client);
		const sharedBefore = await snapshot(join(f.client, "skillbox/patches"));
		failure(
			await run(
				f.client,
				f.cache,
				"patch",
				"prepare",
				"team",
				"--output",
				"scratch/personal-edit",
			),
			"DESTINATION_INVALID",
		);
		expect(await snapshot(f.client)).toEqual(before);
		expect(await snapshot(join(f.client, "skillbox/patches"))).toEqual(sharedBefore);
	} finally {
		await rm(f.root, { recursive: true, force: true });
	}
}, 60_000);

test("capture cannot alias private metadata from outside skillbox", async () => {
	const f = await personalWorkspace();
	try {
		const prepared = success(await run(f.client, f.cache, "patch", "prepare", "team"));
		await put(prepared.editable, "skills/alpha/SKILL.md", skill("alpha", "private edit"));
		await rename(prepared.workspace, join(f.client, "skillbox/.local/foreign"));
		await symlink("skillbox/.local/foreign", join(f.client, "scratch"));
		const before = await snapshot(f.client);
		const sharedBefore = await snapshot(join(f.client, "skillbox/.prepare"));
		failure(
			await run(f.client, f.cache, "patch", "capture", "team", "--from", "scratch"),
			"DESTINATION_INVALID",
		);
		expect(await snapshot(f.client)).toEqual(before);
		expect(await snapshot(join(f.client, "skillbox/.prepare"))).toEqual(sharedBefore);
	} finally {
		await rm(f.root, { recursive: true, force: true });
	}
}, 60_000);

test("external preparation and capture allow the platform tmp alias with missing descendants", async () => {
	const f = await personalWorkspace();
	try {
		const output = join("/tmp", basename(f.root), "external/nested/edit");
		const prepared = success(
			await run(f.client, f.cache, "patch", "prepare", "team", "--output", output),
		);
		expect(await realpath(prepared.workspace)).toBe(
			await realpath(join(f.root, "external/nested/edit")),
		);
		expect(await readFile(join(prepared.pristine, "skills/alpha/SKILL.md"), "utf8")).toBe(
			skill("alpha"),
		);
		await put(
			prepared.editable,
			"skills/alpha/SKILL.md",
			skill("alpha", "external private edit"),
		);
		const captured = success(
			await run(f.client, f.cache, "patch", "capture", "team", "--from", output),
		);
		expect(captured.intentFiles).toEqual(["skillbox/.local/patches/team/alpha/patch.toml"]);
	} finally {
		await rm(f.root, { recursive: true, force: true });
	}
}, 60_000);
