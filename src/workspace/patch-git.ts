import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { statOptional } from "./paths.ts";

const execute = promisify(execFile);

export interface PatchGit {
	diffFiles(before: string, after: string): Promise<{ target: string; body: string }[]>;
	fetchTree(
		repository: string,
		ref: string,
		root: string,
		destination: string,
	): Promise<{ revision: string; tree: string }>;
	patchTargets(patch: string): Promise<string[]>;
	applyPatch(root: string, patch: string): Promise<void>;
}

export function createPatchGit(): PatchGit {
	async function git(args: string[], cwd?: string, isolate = false): Promise<string> {
		const env = { ...process.env };
		delete env.GIT_DIR;
		delete env.GIT_WORK_TREE;
		delete env.GIT_INDEX_FILE;
		// Git ignores a ceiling equal to cwd; stop discovery at its parent.
		if (isolate && cwd) env.GIT_CEILING_DIRECTORIES = dirname(cwd);
		const { stdout } = await execute("git", args, { cwd, env, maxBuffer: 64 * 1024 * 1024 });
		return stdout;
	}
	return {
		async diffFiles(before, after) {
			const repository = await mkdtemp(join(tmpdir(), "skillbox-diff-"));
			try {
				await git(["init", "--quiet", repository]);
				await git(["config", "core.fileMode", "true"], repository);
				if (await statOptional(before))
					await cp(before, repository, { recursive: true, preserveTimestamps: true });
				await git(["add", "--force", "--all", "--", "."], repository);
				const baseTree = (await git(["write-tree"], repository)).trim();
				for (const name of await readdir(repository)) {
					if (name !== ".git")
						await rm(join(repository, name), { recursive: true, force: true });
				}
				if (await statOptional(after))
					await cp(after, repository, { recursive: true, preserveTimestamps: true });
				await git(["add", "--force", "--all", "--", "."], repository);
				const names = (
					await git(
						["diff", "--cached", "--name-only", "--no-renames", "-z", baseTree],
						repository,
					)
				)
					.split("\0")
					.filter(Boolean);
				const patches = [];
				for (const target of names) {
					const body = await git(
						[
							"diff",
							"--cached",
							"--binary",
							"--full-index",
							"--no-renames",
							"--no-ext-diff",
							"--no-textconv",
							"--src-prefix=a/",
							"--dst-prefix=b/",
							baseTree,
							"--",
							target,
						],
						repository,
					);
					patches.push({ target, body });
				}
				return patches;
			} finally {
				await rm(repository, { recursive: true, force: true });
			}
		},
		async fetchTree(repository, ref, root, destination) {
			const checkout = await mkdtemp(join(dirname(destination), "checkout-"));
			try {
				await git(["init", "--quiet", checkout]);
				await git(["remote", "add", "origin", repository], checkout);
				await git(["fetch", "--quiet", "--depth=1", "--no-tags", "origin", ref], checkout);
				const revision = (await git(["rev-parse", "FETCH_HEAD^{commit}"], checkout)).trim();
				const tree = (
					await git(
						["rev-parse", root === "." ? `${revision}^{tree}` : `${revision}:${root}`],
						checkout,
					)
				).trim();
				await git(["checkout", "--quiet", "--detach", revision], checkout);
				await mkdir(destination);
				await cp(join(checkout, root), destination, {
					recursive: true,
					preserveTimestamps: true,
					filter: (path) => path !== join(checkout, ".git"),
				});
				return { revision, tree };
			} finally {
				await rm(checkout, { recursive: true, force: true });
			}
		},
		async patchTargets(patch) {
			const output = await git(
				["apply", "--no-index", "--numstat", "-z", "--", patch],
				dirname(patch),
				true,
			);
			return output
				.split("\0")
				.filter(Boolean)
				.map((record) => record.split("\t").slice(2).join("\t"));
		},
		async applyPatch(root, patch) {
			const args = ["apply", "--no-index", "--binary", "--whitespace=nowarn"];
			await git([...args, "--check", "--", patch], root, true);
			await git([...args, "--", patch], root, true);
		},
	};
}
