import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, posix, resolve } from "node:path";
import { ADAPTER_POINTERS, RESIDUE_RULES, SKILL_NAMES } from "./model.ts";
import { skillsRootFrom } from "./apply.ts";

export type VerifyError = {
	code: string;
	message: string;
	file?: string;
	line?: number;
	action?: string;
};

export type VerifyReport = {
	ok: boolean;
	target: string;
	mode: "tree" | "flat";
	skills: { expected: number; found: number; missing: string[]; unexpected: string[] };
	files: { scanned: number; prose: number };
	links: { checked: number; broken: string[]; escaping: string[] };
	residue: {
		violations: Array<{
			rule: string;
			file: string;
			line: number;
			snippet: string;
			action: string;
		}>;
	};
	adapters: { missing: string[]; pointers: string[] };
	warnings: Array<{ file: string; line: number; snippet: string; note: string }>;
	errors: VerifyError[];
};

const TEXT_EXTENSIONS = new Set([
	".md",
	".sh",
	".ts",
	".mjs",
	".js",
	".json",
	".txt",
	".toml",
	".yml",
	".yaml",
]);
const SCAN_SKIP = new Set(["bun.lock"]);

function walkFiles(root: string): string[] {
	const out: string[] = [];
	const walk = (dir: string, prefix: string) => {
		for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
			a.name.localeCompare(b.name),
		)) {
			const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
			if (entry.isDirectory()) walk(join(dir, entry.name), rel);
			else if (entry.isFile()) out.push(rel);
		}
	};
	walk(root, "");
	return out;
}

function lineAt(text: string, index: number): number {
	return text.slice(0, index).split("\n").length;
}

function snippetAt(text: string, index: number): string {
	const start = text.lastIndexOf("\n", index) + 1;
	const end = text.indexOf("\n", index);
	return text
		.slice(start, end === -1 ? undefined : end)
		.trim()
		.slice(0, 160);
}

/** Strip fenced blocks and inline code so example links and examples do not count. */
function proseOnly(text: string): string {
	const lines = text.split("\n");
	let fenced = false;
	return lines
		.map((line) => {
			if (/^\s*(```|~~~)/.test(line)) {
				fenced = !fenced;
				return "";
			}
			if (fenced) return "";
			return line.replace(/`[^`]*`/g, (match) => " ".repeat(match.length));
		})
		.join("\n");
}

const LINK = /(!?)\[([^\]]*)\]\(\s*([^)\s]+?)(?:\s+"[^"]*")?\s*\)/g;

export function verifyTarget(options: { target: string; skillsRootFlag?: string }): VerifyReport {
	const { skillsRoot, mode } = skillsRootFrom(options.target, options.skillsRootFlag);
	const errors: VerifyError[] = [];

	const found = SKILL_NAMES.filter((name) => existsSync(join(skillsRoot, name, "SKILL.md")));
	const missing = SKILL_NAMES.filter((name) => !existsSync(join(skillsRoot, name, "SKILL.md")));
	// A flat install also holds unrelated project skills. Identity checks stay
	// scoped to the 58 PSTACK names; extra directories are reported, not failed.
	const unexpected = readdirSync(skillsRoot, { withFileTypes: true })
		.filter(
			(entry) =>
				entry.isDirectory() && !(SKILL_NAMES as readonly string[]).includes(entry.name),
		)
		.map((entry) => entry.name)
		.filter((name) => existsSync(join(skillsRoot, name, "SKILL.md")));
	for (const name of missing) {
		errors.push({
			code: "SKILL_MISSING",
			message: `missing distributed skill: ${name}`,
			file: name,
		});
	}

	for (const name of found) {
		const text = readFileSync(join(skillsRoot, name, "SKILL.md"), "utf8");
		const front = /^---\n([\s\S]*?)\n---/.exec(text);
		const match = front && /^name:\s*(.+)$/m.exec(front[1]);
		const declared = match?.[1]?.trim().replace(/^["']|["']$/g, "");
		if (declared !== name) {
			errors.push({
				code: "SKILL_NAME_MISMATCH",
				message: `${name}/SKILL.md frontmatter name is ${declared ?? "missing"}`,
				file: `${name}/SKILL.md`,
			});
		}
	}

	for (const dir of ["agents", "hooks", "automations", ".cursor-plugin"]) {
		if (existsSync(join(skillsRoot, dir))) {
			errors.push({
				code: "PLUGIN_RUNTIME_INSTALLED",
				message: `plugin runtime path must not be installed: ${dir}`,
				file: dir,
				action: "install only skill directories; plugin agents, hooks, and automations stay source context",
			});
		}
	}

	const adapterFile = join(skillsRoot, "poteto-mode", "references", "botlake-tools.md");
	const adaptersMissing: string[] = [];
	if (!existsSync(adapterFile)) {
		adaptersMissing.push("poteto-mode/references/botlake-tools.md");
		errors.push({
			code: "ADAPTER_MISSING",
			message: "shared Botlake adapter reference is missing",
			file: "poteto-mode/references/botlake-tools.md",
		});
	}
	const pointers: string[] = [];
	for (const pointer of ADAPTER_POINTERS) {
		const path = join(skillsRoot, pointer.skill, pointer.file.replace(/^\.\//, ""));
		if (!existsSync(path)) {
			errors.push({
				code: "POINTER_FILE_MISSING",
				message: "pointer file does not exist",
				file: `${pointer.skill}/${pointer.file}`,
			});
			continue;
		}
		const text = readFileSync(path, "utf8");
		if (!text.includes("botlake-tools.md")) {
			errors.push({
				code: "ADAPTER_POINTER_MISSING",
				message: "adapted file does not point at the shared Botlake adapter",
				file: `${pointer.skill}/${pointer.file.replace(/^\.\//, "")}`,
				action: "add a link to ../poteto-mode/references/botlake-tools.md (adjust depth for the file)",
			});
		} else {
			pointers.push(`${pointer.skill}/${pointer.file.replace(/^\.\//, "")}`);
		}
	}

	const files = found.flatMap((name) =>
		walkFiles(join(skillsRoot, name)).map((file) => `${name}/${file}`),
	);
	const residueViolations: VerifyReport["residue"]["violations"] = [];
	const warnings: VerifyReport["warnings"] = [];
	let scanned = 0;
	let prose = 0;
	let linksChecked = 0;
	const broken: string[] = [];
	const escaping: string[] = [];

	for (const file of files) {
		const full = join(skillsRoot, file);
		const extension = file.slice(file.lastIndexOf("."));
		const extensionless = !posix.basename(file).includes(".");
		if (
			(!TEXT_EXTENSIONS.has(extension) && !extensionless) ||
			SCAN_SKIP.has(posix.basename(file))
		)
			continue;
		const raw = readFileSync(full, "utf8");
		if (raw.includes("\u0000")) continue;
		scanned += 1;

		for (const rule of RESIDUE_RULES) {
			const regex = new RegExp(rule.pattern, "g");
			const matches: Array<{ line: number; snippet: string }> = [];
			for (const match of raw.matchAll(regex)) {
				const index = match.index ?? 0;
				matches.push({ line: lineAt(raw, index), snippet: snippetAt(raw, index) });
			}
			if (matches.length === 0) continue;
			for (const match of matches) {
				residueViolations.push({
					rule: rule.id,
					file,
					line: match.line,
					snippet: match.snippet,
					action: rule.action,
				});
			}
		}

		if (extension === ".md") {
			prose += 1;
			const text = proseOnly(raw);
			for (const match of text.matchAll(LINK)) {
				const href = match[3];
				if (/^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(href)) continue;
				linksChecked += 1;
				const [rawPath] = href.split("#");
				if (!rawPath) continue;
				if (/^(url|path|link|target|href)$/i.test(rawPath) || /[<>]|\*\.\.\./.test(rawPath))
					continue;
				const resolved = posix.normalize(posix.join(posix.dirname(file), rawPath));
				const label = `${file} -> ${href}`;
				if (resolved.startsWith("../") || resolved === ".." || posix.isAbsolute(resolved)) {
					escaping.push(label);
					errors.push({
						code: "LINK_ESCAPES_SKILLS",
						message: `link escapes the skills root: ${href}`,
						file,
						line: lineAt(raw, match.index ?? 0),
						action: "rewrite the link to an installed sibling skill file or a carried reference",
					});
					continue;
				}
				if (!existsSync(join(skillsRoot, resolved))) {
					broken.push(label);
					errors.push({
						code: "LINK_MISSING",
						message: `link target does not exist: ${href}`,
						file,
						line: lineAt(raw, match.index ?? 0),
						action: "carry the target file or remove the link",
					});
				}
			}
		}

		if (/\bCursor\b/.test(raw)) {
			for (const match of raw.matchAll(/\bCursor\b/g)) {
				warnings.push({
					file,
					line: lineAt(raw, match.index ?? 0),
					snippet: snippetAt(raw, match.index ?? 0),
					note: "mentions Cursor; keep only for external scope or provenance",
				});
			}
		}
	}

	for (const violation of residueViolations) {
		errors.push({
			code: "CURSOR_RESIDUE",
			message: `${violation.rule}: ${violation.snippet}`,
			file: violation.file,
			line: violation.line,
			action: violation.action,
		});
	}

	return {
		ok: errors.length === 0,
		target: resolve(options.target),
		mode,
		skills: { expected: SKILL_NAMES.length, found: found.length, missing, unexpected },
		files: { scanned, prose },
		links: { checked: linksChecked, broken, escaping },
		residue: {
			violations: residueViolations,
		},
		adapters: { missing: adaptersMissing, pointers },
		warnings,
		errors,
	};
}
