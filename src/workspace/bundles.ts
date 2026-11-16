import { createHash } from "node:crypto";
import {
	cp,
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
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { xdgCache } from "xdg-basedir";
import { ResponseError, responseError } from "../response.ts";
import { parseFrontmatter } from "../skills/frontmatter.ts";
import {
	bundleSchema,
	contributionIdentity,
	readConfig,
	selectMembers,
	type Config,
} from "./config.ts";
import {
	emptyLock,
	jsonText,
	pinSchema,
	readLock,
	type Lock,
	type Member,
	type Pin,
} from "./lock.ts";
import { hashTree, regularTree, replayPatches, requireIntents } from "./patches.ts";
import { readOptional, statOptional } from "./paths.ts";
import type { PatchGit } from "./patch-git.ts";

export interface ComposedBundle {
	/** Flattened origins, retaining upstream directory independently from skill name. */
	members: Member[];
	/** Digest before this workspace's own patches. */
	sourceHash: string;
}
export interface Bundles {
	/** Resolve missing registrations or explicitly refreshed contributions; never float existing pins. */
	resolvePins(
		root: string,
		config: Config,
		lock: Lock,
		refresh?: Map<string, string | undefined>,
	): Promise<Lock>;
	/** Materialize a complete exported bundle, independently of install[]. */
	compose(
		root: string,
		config: Config,
		lock: Lock,
		bundle: string,
		destination: string,
		patches?: boolean,
	): Promise<ComposedBundle>;
	diffFiles: PatchGit["diffFiles"];
	replay(pack: string, skills: string): Promise<void>;
}
interface Context {
	root: string;
	config: Config;
	lock: Lock;
	source: string;
	revision?: string;
	pinnedRoot?: string;
}

/** Raw immutable Git trees are shared outside the repository. Composition itself is disposable. */
export function createBundles(git: PatchGit, configuredCache: string | undefined): Bundles {
	if (configuredCache !== undefined && !configuredCache.trim())
		throw new Error("SKILLBOX_CACHE_DIR must not be empty.");
	const cache = resolve(
		configuredCache ?? join(xdgCache ?? join(homedir(), ".cache"), "skillbox"),
	);
	async function cached(directory: string, expected: Extract<Pin, { type: "git" }>) {
		try {
			const metadata = z
				.strictObject({ pin: pinSchema, contentHash: z.string() })
				.parse(JSON.parse(await readFile(join(directory, "pin.json"), "utf8")));
			const root = join(directory, "tree");
			if (
				JSON.stringify(metadata.pin) !== JSON.stringify(expected) ||
				metadata.contentHash !== (await cacheDigest(root))
			)
				throw new Error("Cached pin or tree content differs from its manifest.");
			return { root, pin: expected };
		} catch (cause) {
			throw responseError(
				"SOURCE_CACHE_CORRUPT",
				`Invalid cached source: ${directory}. Remove the corrupt cache entry explicitly before retrying.`,
				{ input: directory },
				cause,
			);
		}
	}
	async function checkout(
		source: string,
		ref: string,
		expected?: Extract<Pin, { type: "git" }>,
	): Promise<{ root: string; pin: Extract<Pin, { type: "git" }> }> {
		const repository = repositorySource(source);
		const parent = join(cache, "git", createHash("sha256").update(repository).digest("hex"));
		await mkdir(parent, { recursive: true });
		if (expected && (await statOptional(join(parent, expected.revision))))
			return cached(join(parent, expected.revision), expected);
		const staging = await mkdtemp(join(parent, ".fetch-"));
		try {
			const fetched = await git.fetchTree(repository, ref, ".", join(staging, "tree"));
			const pin = pinSchema.parse({ type: "git", ...fetched });
			if (pin.type !== "git") throw new Error("Expected Git pin.");
			if (expected && JSON.stringify(pin) !== JSON.stringify(expected))
				throw responseError(
					"PIN_MISMATCH",
					`Git source differs from locked pin: ${source}.`,
					{ source },
				);
			await writeFile(
				join(staging, "pin.json"),
				jsonText({ pin, contentHash: await cacheDigest(join(staging, "tree")) }),
			);
			const target = join(parent, pin.revision);
			if (!(await statOptional(target))) {
				try {
					await rename(staging, target);
				} catch (cause) {
					if (
						!["EEXIST", "ENOTEMPTY"].includes(
							(cause as NodeJS.ErrnoException).code ?? "",
						)
					)
						throw cause;
				}
			}
			return await cached(target, pin);
		} catch (cause) {
			if (cause instanceof ResponseError) throw cause;
			throw responseError(
				"SOURCE_RESOLUTION_FAILED",
				`Could not resolve ${source} at ${ref}: ${cause instanceof Error ? cause.message : String(cause)}`,
				{ source, input: ref },
				cause,
			);
		} finally {
			await rm(staging, { recursive: true, force: true });
		}
	}
	return {
		diffFiles: git.diffFiles,
		replay: (pack, skills) => replayPatches(pack, skills, git),
		async resolvePins(root, config, lock, refresh = new Map()) {
			const sources: Lock["sources"] = {};
			for (const contribution of config.sources) {
				const key = contributionIdentity(contribution);
				const current = lock.sources[key];
				if (isLocalSource(contribution.source) && (contribution.ref || refresh.get(key)))
					throw responseError(
						"REF_UNSUPPORTED",
						"Local authored sources do not accept --ref; use file:// for pinned Git.",
						{ source: contribution.source },
					);
				let pin: Pin;
				if (current && !refresh.has(key)) pin = current.pin;
				else if (isLocalSource(contribution.source)) {
					await realpath(resolve(root, contribution.source));
					pin = { type: "local" };
				} else
					pin = (
						await checkout(
							contribution.source,
							refresh.get(key) ?? contribution.ref ?? "HEAD",
						)
					).pin;
				sources[key] = { contribution, pin };
			}
			return { ...lock, sources };
		},
		async compose(root, config, lock, bundle, destination, patches = true) {
			const active = new Set<string>();
			const context: Context = { root: await realpath(root), config, lock, source: "." };
			const staging = await mkdtemp(join(dirname(destination), ".compose-"));
			let sequence = 0;
			async function composeBundle(
				ctx: Context,
				id: string,
				target: string,
				ownPatches: boolean,
			): Promise<ComposedBundle> {
				const key = `${ctx.root}\0${id}`;
				if (active.has(key))
					throw responseError(
						"BUNDLE_IMPORT_CYCLE",
						`Bundle composition cycle at ${id}.`,
						{ source: ctx.source, input: id },
					);
				active.add(key);
				try {
					await mkdir(target, { recursive: true });
					const members: Member[] = [];
					async function merge(incoming: Member[], sourceRoot: string) {
						for (const member of incoming) {
							if (
								members.some(
									(other) =>
										other.name === member.name ||
										other.directory === member.directory,
								)
							)
								throw responseError(
									"SKILL_NAME_COLLISION",
									`Skill collision in ${id}: ${member.name} (${member.directory}).`,
									{ skill: member.name, input: id },
								);
							await cp(
								join(sourceRoot, member.directory),
								join(target, member.directory),
								{ recursive: true, preserveTimestamps: true },
							);
							members.push(member);
						}
					}
					const native = await regularPath(ctx.root, `skillbox/${id}`);
					await merge(
						await discover(
							native,
							ctx.source,
							originPath(ctx, `skillbox/${id}`),
							ctx.revision,
						),
						native,
					);
					const contributions = ctx.config.sources.filter((value) => value.id === id);
					if (!members.length && !contributions.length)
						throw responseError("BUNDLE_NOT_FOUND", `No bundle named ${id}.`, {
							source: ctx.source,
							input: id,
						});
					for (const contribution of contributions) {
						const entry = ctx.lock.sources[contributionIdentity(contribution)];
						if (!entry)
							throw responseError(
								"PIN_MISSING",
								`Missing locked source for ${contribution.source}. Register it with add.`,
								{ source: contribution.source },
							);
						let upstream: Context;
						if (entry.pin.type === "local") {
							if (!isLocalSource(contribution.source))
								throw responseError(
									"PIN_MISMATCH",
									"Remote source has a local pin.",
									{ source: contribution.source },
								);
							const resolvedRoot = resolve(ctx.root, contribution.source);
							if (
								ctx.pinnedRoot &&
								(isAbsolute(contribution.source) ||
									(resolvedRoot !== ctx.pinnedRoot &&
										!resolvedRoot.startsWith(ctx.pinnedRoot + sep)))
							)
								throw responseError(
									"PRODUCER_SOURCE_ESCAPE",
									"A pinned producer local source must stay inside its checkout.",
									{ source: contribution.source },
								);
							const sourceRoot = await realpath(resolvedRoot);
							if (
								ctx.pinnedRoot &&
								(isAbsolute(contribution.source) ||
									(sourceRoot !== ctx.pinnedRoot &&
										!sourceRoot.startsWith(ctx.pinnedRoot + sep)))
							)
								throw responseError(
									"PRODUCER_SOURCE_ESCAPE",
									"A pinned producer local source must stay inside its checkout.",
									{ source: contribution.source },
								);
							upstream =
								sourceRoot === ctx.root
									? ctx
									: contribution.type === "skills"
										? {
												root: sourceRoot,
												source: ctx.pinnedRoot
													? ctx.source
													: contribution.source,
												revision: ctx.pinnedRoot ? ctx.revision : undefined,
												config: { sources: [], install: [] },
												lock: emptyLock(),
												pinnedRoot: ctx.pinnedRoot,
											}
										: await producerContext(
												sourceRoot,
												ctx.pinnedRoot ? ctx.source : contribution.source,
												ctx.pinnedRoot ? ctx.revision : undefined,
												ctx.pinnedRoot,
											);
						} else {
							const fetched = await checkout(
								contribution.source,
								entry.pin.revision,
								entry.pin,
							);
							const sourceRoot = await realpath(fetched.root);
							upstream =
								contribution.type === "skills"
									? {
											root: sourceRoot,
											source: contribution.source,
											revision: entry.pin.revision,
											config: { sources: [], install: [] },
											lock: emptyLock(),
											pinnedRoot: sourceRoot,
										}
									: await producerContext(
											sourceRoot,
											contribution.source,
											entry.pin.revision,
											sourceRoot,
										);
						}
						if (contribution.type === "skills") {
							const directory = await regularPath(upstream.root, contribution.path);
							if (!(await statOptional(directory)))
								throw responseError(
									"SOURCE_NOT_FOUND",
									`Missing skills directory: ${contribution.path}.`,
									{ source: contribution.source, input: contribution.path },
								);
							const discovered = await discover(
								directory,
								upstream.source,
								originPath(upstream, contribution.path),
								upstream.revision,
							);
							if (!discovered.length)
								throw responseError(
									"BUNDLE_EMPTY",
									`No skills in ${contribution.path}.`,
									{ source: contribution.source },
								);
							await merge(
								selectMembers(discovered, contribution.pick, contribution.omit),
								directory,
							);
						} else {
							for (const selected of contribution.bundles) {
								// The native member is already present. Other local references recurse normally.
								if (upstream.root === ctx.root && selected === id) {
									const ownNative = await discover(
										native,
										ctx.source,
										originPath(ctx, `skillbox/${id}`),
										ctx.revision,
									);
									if (!ownNative.length)
										throw responseError(
											"BUNDLE_IMPORT_CYCLE",
											`Self composition without native members: ${id}.`,
											{ input: id },
										);
									if (
										contribution.pick?.[selected] ||
										contribution.omit?.[selected]
									)
										throw responseError(
											"SELF_SELECTOR_INVALID",
											"Selectors cannot filter an implicit native contribution through a redundant self reference.",
											{ input: id },
										);
									continue;
								}
								const directory = join(staging, String(sequence++));
								const composed = await composeBundle(
									upstream,
									selected,
									directory,
									true,
								);
								await merge(
									selectMembers(
										composed.members,
										contribution.pick?.[selected],
										contribution.omit?.[selected],
									),
									directory,
								);
							}
						}
					}
					const sourceHash = await hashTree(target);
					if (ownPatches) {
						const pack = join(ctx.root, "skillbox/patches", id);
						await requireIntents(pack);
						await replayPatches(pack, target, git);
					}
					const final = await discover(
						target,
						ctx.source,
						originPath(ctx, `skillbox/${id}`),
						ctx.revision,
					);
					return {
						sourceHash,
						members: final.map((member) => ({
							...(members.find(
								(original) => original.directory === member.directory,
							) ?? member),
							name: member.name,
						})),
					};
				} finally {
					active.delete(key);
				}
			}
			try {
				return await composeBundle(context, bundle, destination, patches);
			} finally {
				await rm(staging, { recursive: true, force: true });
			}
		},
	};
}

export function isLocalSource(source: string): boolean {
	return isAbsolute(source) || source.startsWith(".");
}

function originPath(ctx: Context, path: string): string {
	return ctx.pinnedRoot
		? join(relative(ctx.pinnedRoot, ctx.root), path).split(sep).join("/")
		: path;
}

async function producerContext(
	root: string,
	source: string,
	revision?: string,
	pinnedRoot?: string,
): Promise<Context> {
	const config = (await readConfig(root)) ?? { sources: [], install: [] };
	const lock = await readLock(root);
	if (config.sources.length && !lock)
		throw responseError(
			"PRODUCER_LOCK_MISSING",
			`Producer ${source} has no committed source pins.`,
			{ source },
		);
	return { root, config, lock: lock ?? emptyLock(), source, revision, pinnedRoot };
}

export async function discover(
	directory: string,
	source: string,
	path: string,
	revision?: string,
): Promise<Member[]> {
	const entry = await statOptional(directory);
	if (!entry) return [];
	if (!entry.isDirectory())
		throw responseError("SOURCE_PATH_UNSAFE", `Expected real directory: ${directory}.`, {
			input: directory,
		});
	const members: Member[] = [];
	for (const child of (await readdir(directory)).sort()) {
		const childEntry = await statOptional(join(directory, child));
		if (!childEntry?.isDirectory()) {
			if (childEntry?.isSymbolicLink())
				throw responseError(
					"SOURCE_PATH_UNSAFE",
					`Skill directories cannot be symlinks: ${child}.`,
					{ input: join(directory, child) },
				);
			continue;
		}
		const text = await readOptional(join(directory, child, "SKILL.md"));
		if (text === undefined) continue;
		bundleSchema.parse(child);
		await regularTree(join(directory, child));
		const attributes: unknown = parseFrontmatter(text).data;
		if (
			!attributes ||
			typeof attributes !== "object" ||
			!("name" in attributes) ||
			typeof attributes.name !== "string" ||
			!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(attributes.name)
		)
			throw responseError(
				"INVALID_SKILL_NAME",
				`Missing or invalid SKILL.md name: ${child}.`,
				{ input: join(directory, child, "SKILL.md") },
			);
		if (members.some((member) => member.name === attributes.name))
			throw responseError(
				"SKILL_NAME_COLLISION",
				`Duplicate skill name: ${attributes.name}.`,
				{
					skill: attributes.name,
				},
			);
		members.push({
			name: attributes.name,
			directory: child,
			source,
			path: `${path === "." ? "" : path + "/"}${child}`,
			...(revision ? { revision } : {}),
		});
	}
	return members;
}

async function regularPath(root: string, path: string): Promise<string> {
	let current = root;
	for (const part of path.split("/")) {
		if (part === ".") continue;
		current = join(current, part);
		const entry = await statOptional(current);
		if (entry?.isSymbolicLink())
			throw responseError(
				"SOURCE_PATH_UNSAFE",
				`Source paths cannot traverse symlinks: ${current}.`,
				{ input: current },
			);
		if (!entry) break;
	}
	return join(root, path);
}

async function cacheDigest(root: string): Promise<string> {
	const hash = createHash("sha256");
	async function visit(path: string): Promise<void> {
		const entry = await lstat(join(root, path));
		const type = entry.isDirectory()
			? "d"
			: entry.isFile()
				? "f"
				: entry.isSymbolicLink()
					? "l"
					: "unsupported";
		if (type === "unsupported") throw new Error(`Unsupported cached entry: ${path}.`);
		hash.update(`${path}\0${type}\0${entry.mode & 0o777}\0`);
		if (entry.isDirectory())
			for (const name of (await readdir(join(root, path))).sort())
				await visit(path ? path + "/" + name : name);
		else if (entry.isSymbolicLink()) hash.update(await readlink(join(root, path))).update("\0");
		else {
			const body = await readFile(join(root, path));
			hash.update(`${body.length}\0`).update(body);
		}
	}
	await visit("");
	return hash.digest("hex");
}

function repositorySource(source: string): string {
	if (/^[\w.-]+\/[\w.-]+$/.test(source)) return `https://github.com/${source}.git`;
	if (/^https?:\/\/github.com\/[^/]+\/[^/]+\/?$/.test(source))
		return source.replace(/\/$/, "").replace(/(?:\.git)?$/, ".git");
	return source;
}
