import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";

const registry = "https://registry.npmjs.org";
const root = process.cwd();
const { values } = parseArgs({
	options: {
		packed: { type: "boolean", default: false },
		archive: { type: "string" },
		help: { type: "boolean", short: "h", default: false },
	},
});

if (values.help) {
	console.log(`Usage: bun <skill-dir>/scripts/verify-release.ts [--packed] [--archive FILE]

Run from the Skillbox repository root. Verify the exact archive, a fresh npm
installation, CLI version/help/guidance, and local add/restore/repeated sync.
Default: compare npm metadata and downloaded bytes with the frozen archive,
then install the exact published version. --packed installs the archive offline.
Archive default: dist/release/codethread-skillbox-VERSION.tgz.
Exit 0: verified; 2: npm unavailable/pending (never permission to republish);
other nonzero: verification failed. This script never publishes or retries.`);
	process.exit(0);
}

const manifestSchema = z.object({
	name: z.literal("@codethread/skillbox"),
	version: z.string().regex(/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/),
	license: z.literal("MIT"),
	bin: z.object({ skillbox: z.literal("./bin/skillbox.mjs") }),
	engines: z.object({ node: z.string() }),
	dependencies: z.record(z.string(), z.unknown()).optional(),
	optionalDependencies: z.record(z.string(), z.unknown()).optional(),
	peerDependencies: z.record(z.string(), z.unknown()).optional(),
	scripts: z.record(z.string(), z.string()),
});
const manifest = manifestSchema.parse(JSON.parse(await readFile("package.json", "utf8")));
const archive = resolve(
	values.archive ?? `dist/release/codethread-skillbox-${manifest.version}.tgz`,
);
const archiveBytes = await readFile(archive);
const integrity = archiveIntegrity(archiveBytes);
const specifier = `${manifest.name}@${manifest.version}`;
const entries = run(["tar", "-tzf", archive], root).trim().split("\n").sort();
assert.deepEqual(
	entries,
	[
		"package/LICENSE",
		"package/README.md",
		"package/bin/skillbox.mjs",
		"package/dist/THIRD-PARTY-NOTICES.txt",
		"package/dist/cli.mjs",
		"package/package.json",
	].sort(),
	"Archive must contain only the public CLI, metadata, README and licenses",
);
console.log(JSON.stringify({ specifier, archive, integrity }));

const workspace = await realpath(await mkdtemp(join(tmpdir(), "skillbox-release-")));
try {
	await mkdir(join(workspace, "unpacked"));
	run(["tar", "-xzf", archive, "-C", join(workspace, "unpacked")], root);
	const unpacked = join(workspace, "unpacked/package");
	const packedManifest = manifestSchema.parse(
		JSON.parse(await readFile(join(unpacked, "package.json"), "utf8")),
	);
	assert.deepEqual(packedManifest, manifest, "Archive metadata differs from the checkout");
	for (const field of ["dependencies", "optionalDependencies", "peerDependencies"] as const) {
		assert.equal(
			Object.keys(packedManifest[field] ?? {}).length,
			0,
			`${field} must be bundled`,
		);
	}
	for (const hook of ["preinstall", "install", "postinstall"]) {
		assert.equal(packedManifest.scripts[hook], undefined, `Unexpected ${hook} hook`);
	}
	assert.equal(
		await readFile(join(unpacked, "LICENSE"), "utf8"),
		await readFile(join(root, "LICENSE"), "utf8"),
	);
	assert.ok((await readFile(join(unpacked, "LICENSE"), "utf8")).includes("MIT License"));
	assert.ok(
		(await readFile(join(unpacked, "dist/THIRD-PARTY-NOTICES.txt"), "utf8")).includes(
			"commander@",
		),
	);

	if (!values.packed && !(await verifyPublished())) {
		process.exitCode = 2;
	} else {
		await smokeInstall(workspace, values.packed ? archive : specifier);
		console.log(
			JSON.stringify({
				status: "verified",
				mode: values.packed ? "packed" : "published",
				specifier,
				integrity,
			}),
		);
	}
} finally {
	await rm(workspace, { recursive: true, force: true });
}

// -----------------------------------------------------------------------------

async function verifyPublished(): Promise<boolean> {
	const response = await fetch(`${registry}/${encodeURIComponent(manifest.name)}`, {
		signal: AbortSignal.timeout(30_000),
	});
	if (response.status === 404) return pending("package-metadata");
	assert.ok(response.ok, `Registry lookup failed: HTTP ${response.status}`);
	const packument = z
		.object({
			versions: z.record(z.string(), z.unknown()),
			"dist-tags": z.record(z.string(), z.string()),
		})
		.parse(await response.json());
	const version = packument.versions[manifest.version];
	if (version === undefined) return pending("version-metadata");
	const published = z
		.object({
			name: z.literal(manifest.name),
			version: z.literal(manifest.version),
			dist: z.object({ integrity: z.string(), tarball: z.url() }),
		})
		.parse(version);
	assert.equal(
		published.dist.integrity,
		integrity,
		"Published integrity differs from the frozen archive; stop, never republish",
	);
	const tarball = await fetch(published.dist.tarball, { signal: AbortSignal.timeout(30_000) });
	if (tarball.status === 404) return pending("tarball");
	assert.ok(tarball.ok, `Tarball lookup failed: HTTP ${tarball.status}`);
	assert.equal(
		archiveIntegrity(new Uint8Array(await tarball.arrayBuffer())),
		integrity,
		"Downloaded tarball differs from the frozen archive",
	);
	if (packument["dist-tags"].latest !== manifest.version) return pending("latest-tag");
	return true;
}

function pending(stage: string): false {
	console.error(
		JSON.stringify({
			status: "unavailable",
			stage,
			specifier,
			archive,
			integrity,
			action: "Check recorded npm acceptance; wait if accepted. Never republish an accepted or available version.",
		}),
	);
	return false;
}

async function smokeInstall(directory: string, target: string): Promise<void> {
	const consumer = join(directory, "consumer");
	await mkdir(consumer);
	await writeFile(join(consumer, "package.json"), '{"private":true}\n');
	run(
		[
			"npm",
			"install",
			target,
			"--ignore-scripts",
			"--no-audit",
			"--no-fund",
			"--cache",
			join(directory, "npm-cache"),
			"--registry",
			registry,
			...(values.packed ? ["--offline"] : []),
		],
		consumer,
	);
	const cli = join(consumer, "node_modules/.bin/skillbox");
	for (const flag of ["--version", "-v"]) {
		assert.equal(run(["node", cli, flag], consumer), `${manifest.version}\n`);
	}
	assert.ok(run(["node", cli, "--help"], consumer).includes("-v, --version"));
	const guidance = response(["node", cli, "skills", "list"], consumer);
	assert.ok(
		z
			.object({ skills: z.array(z.object({ name: z.string() })).min(1) })
			.parse(guidance)
			.skills.some((skill) => skill.name === "skillbox-configure"),
	);

	const source = join(directory, "source/skillbox/testing/release-smoke");
	await mkdir(join(source, "references"), { recursive: true });
	const instructions =
		"---\nname: release-smoke\ndescription: Verify a release in a disposable workspace.\n---\n\nRead [the fixture](references/fixture.md).\n";
	await writeFile(join(source, "SKILL.md"), instructions);
	await writeFile(join(source, "references/fixture.md"), "Release smoke resource.\n");
	const client = join(directory, "client");
	await mkdir(client);
	const unrelatedLock = '{"unrelated":"must remain untouched"}\n';
	await writeFile(join(client, "skills-lock.json"), unrelatedLock);
	const invoke = (...args: string[]) => response(["node", cli, ...args], client);
	z.object({ installed: z.literal(1) }).parse(
		invoke("add", join(directory, "source"), "testing"),
	);
	const config = await readFile(join(client, "skillbox/config.json"), "utf8");
	const lock = await readFile(join(client, "skillbox/lock.json"), "utf8");
	const installed = join(client, ".agents/skills/release-smoke");
	assert.equal(await readFile(join(installed, "SKILL.md"), "utf8"), instructions);
	await rm(join(client, ".agents"), { recursive: true });
	await rm(join(client, ".claude/skills"));
	assert.deepEqual(invoke("sync"), { status: "synced", installed: 1, unchanged: 0, removed: 0 });
	assert.equal(await readFile(join(installed, "SKILL.md"), "utf8"), instructions);
	assert.equal(
		await readFile(join(installed, "references/fixture.md"), "utf8"),
		"Release smoke resource.\n",
	);
	assert.equal(
		await realpath(join(client, ".claude/skills")),
		await realpath(join(client, ".agents/skills")),
	);
	assert.deepEqual(invoke("sync"), {
		status: "unchanged",
		installed: 0,
		unchanged: 1,
		removed: 0,
	});
	assert.equal(await readFile(join(client, "skillbox/config.json"), "utf8"), config);
	assert.equal(await readFile(join(client, "skillbox/lock.json"), "utf8"), lock);
	assert.equal(await readFile(join(client, "skills-lock.json"), "utf8"), unrelatedLock);
}

function response(command: string[], cwd: string): unknown {
	const result = z
		.object({ success: z.literal(true), data: z.unknown(), errors: z.tuple([]) })
		.parse(JSON.parse(run(command, cwd)));
	return result.data;
}

function run(command: string[], cwd: string): string {
	const child = Bun.spawnSync(command, {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env, NO_COLOR: "1", DO_NOT_TRACK: "1", CI: "1" },
	});
	assert.equal(child.exitCode, 0, `${command.join(" ")}\n${child.stdout}\n${child.stderr}`);
	return child.stdout.toString();
}

function archiveIntegrity(bytes: Uint8Array): string {
	return `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
}
