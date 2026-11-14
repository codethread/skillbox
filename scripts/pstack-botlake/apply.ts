import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { PROVENANCE, SKILL_NAMES, buildPlan, targetPath, type FileEdit, type Op } from "./model.ts";

export type Failure = { code: string; message: string; details?: Record<string, unknown> };

export class ToolError extends Error {
	failure: Failure;
	constructor(code: string, message: string, details?: Record<string, unknown>) {
		super(message);
		this.failure = { code, message, details };
	}
}

function fail(code: string, message: string, details?: Record<string, unknown>): never {
	throw new ToolError(code, message, details);
}

/** Guard every target path against traversal and reserved Git metadata. */
export function safeRelative(path: string, what: string): string {
	const normalised = posix.normalize(path.replace(/^\.\//, ""));
	if (normalised.startsWith("../") || normalised === ".." || posix.isAbsolute(normalised)) {
		fail("PATH_UNSAFE", `${what} escapes its skill directory: ${path}`, { path });
	}
	if (normalised.split("/").includes(".git")) {
		fail("PATH_UNSAFE", `${what} targets Git metadata: ${path}`, { path });
	}
	return normalised;
}

function listFiles(root: string): string[] {
	const out: string[] = [];
	const walk = (dir: string, prefix: string) => {
		for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
			a.name.localeCompare(b.name),
		)) {
			const full = join(dir, entry.name);
			const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
			if (entry.isDirectory()) walk(full, rel);
			else if (entry.isFile()) out.push(rel);
			else fail("TREE_UNSUPPORTED", `unsupported file kind in source tree: ${rel}`);
		}
	};
	walk(root, "");
	return out;
}

/** Byte-and-mode equality is the pristine precondition for applying edits. */
export function assertPristine(sourceSkills: string, targetSkills: string): void {
	if (!existsSync(targetSkills)) {
		fail("TARGET_NOT_PRISTINE", "target has no skills directory", { targetSkills });
	}
	const sourceFiles = listFiles(sourceSkills);
	const targetFiles = listFiles(targetSkills);
	const sourceSet = new Set(sourceFiles);
	const targetSet = new Set(targetFiles);
	for (const file of sourceFiles) {
		if (!targetSet.has(file)) {
			fail(
				"TARGET_NOT_PRISTINE",
				`target is missing ${file}; start from a fresh copy of the pristine tree`,
				{
					file,
				},
			);
		}
		const sourceStat = statSync(join(sourceSkills, file));
		const targetStat = statSync(join(targetSkills, file));
		if ((sourceStat.mode & 0o111) !== (targetStat.mode & 0o111)) {
			fail("TARGET_NOT_PRISTINE", `executable mode differs for ${file}`, { file });
		}
		if (
			!readFileSync(join(sourceSkills, file)).equals(readFileSync(join(targetSkills, file)))
		) {
			fail("TARGET_NOT_PRISTINE", `target file differs from pristine source: ${file}`, {
				file,
			});
		}
	}
	for (const file of targetFiles) {
		if (!sourceSet.has(file)) {
			fail(
				"TARGET_NOT_PRISTINE",
				`target has an extra file: ${file}; start from a fresh copy`,
				{ file },
			);
		}
	}
}

function countOccurrences(haystack: string, needle: string): number {
	if (needle.length === 0) return 0;
	let count = 0;
	let index = haystack.indexOf(needle);
	while (index !== -1) {
		count += 1;
		index = haystack.indexOf(needle, index + needle.length);
	}
	return count;
}

type OpContext = { skill: string; target: string };

function applyRange(
	text: string,
	op: { start: string; end: string; replacement: string },
	context: OpContext,
	index: number,
): string {
	const failRange = (reason: string, details: Record<string, unknown>) => {
		fail(reason, `${context.skill}/${context.target} op ${index + 1}: ${reason}`, {
			skill: context.skill,
			target: context.target,
			op: index + 1,
			...details,
		});
	};
	const startCount = countOccurrences(text, op.start);
	const endCount = countOccurrences(text, op.end);
	if (startCount !== 1) {
		failRange(`range start matched ${startCount} time(s), expected 1`, {
			anchor: op.start.slice(0, 120),
		});
	}
	if (endCount !== 1) {
		failRange(`range end matched ${endCount} time(s), expected 1`, {
			anchor: op.end.slice(0, 120),
		});
	}
	const start = text.indexOf(op.start);
	const end = text.indexOf(op.end, start);
	if (end === -1)
		failRange("range end appears before range start", { anchor: op.end.slice(0, 120) });
	return `${text.slice(0, start)}${op.replacement}${text.slice(end + op.end.length)}`;
}

function applyOps(text: string, ops: Op[] | undefined, context: OpContext): string {
	if (!ops || ops.length === 0) return text;
	let out = text;
	for (const [index, op] of ops.entries()) {
		if (op.kind === "range") {
			out = applyRange(out, op, context, index);
			continue;
		}
		const anchor = op.anchor;
		const expect = op.expect ?? 1;
		const found = countOccurrences(out, anchor);
		if (found !== expect) {
			const firstLine = anchor.split("\n")[0].slice(0, 120);
			fail(
				found === 0 ? "ANCHOR_NOT_FOUND" : "ANCHOR_COUNT_MISMATCH",
				`${context.skill}/${context.target} op ${index + 1}: expected ${expect} occurrence(s), found ${found}: ${firstLine}`,
				{
					skill: context.skill,
					target: context.target,
					op: index + 1,
					anchor: firstLine,
					expected: expect,
					found,
				},
			);
		}
		out =
			op.kind === "replace"
				? out.split(anchor).join(op.replacement)
				: out.split(anchor).join(`${anchor}${op.content}`);
	}
	return out;
}

const LINK = /(!?)\[([^\]]*)\]\(\s*([^)\s]+?)(?:\s+"[^"]*")?\s*\)/g;
const URL_LIKE = /^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i;

export type LinkMap = Map<string, string>;

/** Map of pristine-source-relative path to skills-root-relative installed path for carried docs. */
export function buildCarryMap(plan: ReturnType<typeof buildPlan>): LinkMap {
	const map: LinkMap = new Map();
	for (const change of plan.changes) {
		if (!change.copyFrom) continue;
		map.set(posix.normalize(change.copyFrom), `${change.skill}/${targetPath(change)}`);
	}
	return map;
}

/**
 * Copy step for upstream text: keep a carried doc link resolvable inside the
 * flat skills tree, drop links to omitted images or unrelated plugin pages.
 */
export function rewriteLinks(
	text: string,
	fromPath: string,
	outPath: string,
	carryMap: LinkMap,
	sourceRoot: string,
): { text: string; removed: string[] } {
	const removed: string[] = [];
	const fromDir = posix.dirname(fromPath);
	const outDir = posix.dirname(outPath);
	const rewritten = text.replace(LINK, (whole, bang: string, label: string, href: string) => {
		if (URL_LIKE.test(href)) return whole;
		const [rawPath, anchor] = href.split("#");
		if (!rawPath) return whole;
		const resolved = posix.normalize(posix.join(fromDir, rawPath));
		let installed = carryMap.get(resolved);
		if (
			!installed &&
			resolved.startsWith("skills/") &&
			existsSync(join(sourceRoot, resolved))
		) {
			installed = resolved.slice("skills/".length);
		}
		if (!installed) {
			removed.push(resolved);
			return bang ? "" : label;
		}
		const next = posix.relative(outDir, installed) || ".";
		return `${bang}[${label}](${next}${anchor ? `#${anchor}` : ""})`;
	});
	return { text: rewritten, removed };
}

function templatePath(name: string): string {
	return join(import.meta.dir, "templates", name);
}

export function readTemplate(name: string): string {
	const path = templatePath(name);
	if (!existsSync(path)) fail("TEMPLATE_MISSING", `missing authored template: ${name}`, { path });
	return readFileSync(path, "utf8");
}

export type ApplyResult = {
	applied: Array<{ skill: string; target: string; change: "modified" | "added" | "deleted" }>;
	removedLinks: Array<{ file: string; target: string }>;
	intentsPath: string;
};

export function resolveSkillDirectory(skillsRoot: string, skill: string): string {
	const dir = join(skillsRoot, skill);
	if (!existsSync(join(dir, "SKILL.md"))) {
		fail("SKILL_MISSING", `skill directory not found in target: ${skill}`, { skill, dir });
	}
	return dir;
}

export function applyPlan(options: {
	source: string;
	target: string;
	intents: string;
}): ApplyResult {
	const sourceSkills = join(options.source, "skills");
	const targetSkills = join(options.target, "skills");
	if (!existsSync(join(sourceSkills, "poteto-mode", "SKILL.md"))) {
		fail("SOURCE_INVALID", "source is not a pstack root with skills/", {
			source: options.source,
		});
	}
	assertPristine(sourceSkills, targetSkills);

	const plan = buildPlan();
	const carryMap = buildCarryMap(plan);
	const applied: ApplyResult["applied"] = [];
	const removedLinks: ApplyResult["removedLinks"] = [];

	for (const change of plan.changes) {
		applyChange(change, {
			source: options.source,
			targetSkills,
			carryMap,
			removedLinks,
			applied,
		});
	}

	const intentsPath = resolve(options.intents);
	mkdirSync(dirname(intentsPath), { recursive: true });
	writeFileSync(intentsPath, renderIntents(plan.changes));
	return { applied, removedLinks, intentsPath };
}

function applyChange(
	change: FileEdit,
	context: {
		source: string;
		targetSkills: string;
		carryMap: LinkMap;
		removedLinks: ApplyResult["removedLinks"];
		applied: ApplyResult["applied"];
	},
): void {
	const rel = safeRelative(targetPath(change), `${change.skill} target`);
	const skillDir = resolveSkillDirectory(context.targetSkills, change.skill);
	const destination = join(skillDir, ...rel.split("/"));
	const publicTarget = `${change.skill}/${rel}`;

	if (change.delete) {
		if (!existsSync(destination)) {
			fail("DELETE_TARGET_MISSING", `cannot delete missing file: ${publicTarget}`, {
				target: publicTarget,
			});
		}
		rmSync(destination);
		context.applied.push({ skill: change.skill, target: change.target, change: "deleted" });
		return;
	}

	if (
		existsSync(destination) &&
		(change.content !== undefined || change.copyFrom) &&
		!change.replace
	) {
		fail("ADD_TARGET_EXISTS", `refusing to overwrite existing file: ${publicTarget}`, {
			target: publicTarget,
		});
	}

	let text: string | undefined;
	if (change.copyFrom) {
		const from = safeRelative(change.copyFrom, `${change.skill} copy source`);
		const sourcePath = join(context.source, ...from.split("/"));
		if (!existsSync(sourcePath)) {
			fail("COPY_SOURCE_MISSING", `carry source not found: ${from}`, { copyFrom: from });
		}
		const raw = readFileSync(sourcePath, "utf8");
		if (from.endsWith(".md")) {
			const rewritten = rewriteLinks(
				raw,
				from,
				publicTarget,
				context.carryMap,
				context.source,
			);
			for (const removed of rewritten.removed) {
				context.removedLinks.push({ file: publicTarget, target: removed });
			}
			text = rewritten.text;
		} else {
			text = raw;
		}
		text = applyOps(text, change.ops, { skill: change.skill, target: change.target });
		mkdirSync(dirname(destination), { recursive: true });
		writeFileSync(destination, text, { mode: statSync(sourcePath).mode });
		context.applied.push({
			skill: change.skill,
			target: change.target,
			change: change.replace ? "modified" : "added",
		});
		return;
	}

	if (change.content !== undefined) {
		const text = applyOps(change.content, change.ops, {
			skill: change.skill,
			target: change.target,
		});
		mkdirSync(dirname(destination), { recursive: true });
		writeFileSync(destination, text);
		context.applied.push({
			skill: change.skill,
			target: change.target,
			change: change.replace ? "modified" : "added",
		});
		return;
	}

	if (!existsSync(destination)) {
		fail("EDIT_TARGET_MISSING", `cannot edit missing file: ${publicTarget}`, {
			target: publicTarget,
		});
	}
	const before = readFileSync(destination, "utf8");
	const after = applyOps(before, change.ops, { skill: change.skill, target: change.target });
	if (after === before) {
		fail("EDIT_NO_CHANGE", `anchored edits changed nothing in ${publicTarget}`, {
			target: publicTarget,
		});
	}
	writeFileSync(destination, after);
	context.applied.push({ skill: change.skill, target: change.target, change: "modified" });
}

function tomlString(value: string): string {
	return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}

export function renderIntents(changes: FileEdit[]): string {
	const lines = [
		"# Generated by scripts/pstack-botlake.ts. One record per modified, added, or deleted file.",
		"schema = 1",
		'bundle = "pstack"',
		`source = ${tomlString(PROVENANCE.source)}`,
		`base_revision = ${tomlString(PROVENANCE.baseRevision)}`,
		`pstack_tree = ${tomlString(PROVENANCE.pstackTree)}`,
		`skills_tree = ${tomlString(PROVENANCE.skillsTree)}`,
		"",
	];
	for (const change of changes) {
		lines.push("[[change]]");
		lines.push(`skill = ${tomlString(change.skill)}`);
		lines.push(`target = ${tomlString(change.target)}`);
		lines.push(`intent = ${tomlString(change.intent)}`);
		lines.push("");
	}
	return lines.join("\n");
}

/** Count of distributed skill identities in a skills root. */
export function checkIdentityOrder(skillsRoot: string): string[] {
	return SKILL_NAMES.filter((name) => existsSync(join(skillsRoot, name, "SKILL.md")));
}

export function skillsRootFrom(
	target: string,
	flag?: string,
): { skillsRoot: string; mode: "tree" | "flat" } {
	const base = resolve(target);
	if (!existsSync(base)) fail("TARGET_MISSING", `target does not exist: ${target}`, { target });
	if (flag) {
		const root = join(base, flag);
		if (!existsSync(join(root, "poteto-mode", "SKILL.md"))) {
			fail("TARGET_NOT_A_SKILL_TREE", `--skills-root ${flag} has no poteto-mode/SKILL.md`, {
				target,
				flag,
			});
		}
		return { skillsRoot: root, mode: "tree" };
	}
	if (existsSync(join(base, "skills", "poteto-mode", "SKILL.md"))) {
		return { skillsRoot: join(base, "skills"), mode: "tree" };
	}
	if (existsSync(join(base, "poteto-mode", "SKILL.md"))) {
		return { skillsRoot: base, mode: "flat" };
	}
	fail("TARGET_NOT_A_SKILL_TREE", "target is neither a pstack root nor a flat skills directory", {
		target,
	});
}

export function relativeTo(root: string, path: string): string {
	return relative(root, path).split(sep).join("/");
}
