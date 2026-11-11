import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { responseError } from "../response.ts";
import configure from "./skillbox-configure/SKILL.md" with { type: "text" };
import configuration from "./skillbox-configure/references/configuration.md" with { type: "text" };
import author from "./skillbox-author/SKILL.md" with { type: "text" };
import example from "./skillbox-author/references/example.md" with { type: "text" };
import migrate from "./skillbox-migrate/SKILL.md" with { type: "text" };

const metadataSchema = z.object({ name: z.string(), description: z.string() });
const listInputSchema = z.object({
	limit: z.coerce.number().int().min(1).max(100).default(20),
	offset: z.coerce.number().int().min(0).default(0),
});
const dataSchemas = {
	list: z.object({
		skills: z.array(metadataSchema),
		total: z.number().int().min(0),
		nextOffset: z.number().int().min(0).nullable(),
	}),
	get: z.object({ name: z.string(), body: z.string() }),
	file: z.object({ name: z.string(), path: z.string(), content: z.string() }),
};
const failureSchema = z.object({
	success: z.literal(false),
	data: z.null(),
	errors: z.array(
		z.object({
			code: z.string(),
			message: z.string(),
			source: z.string().optional(),
			skill: z.string().optional(),
			input: z.string().optional(),
		}),
	),
});
const catalog = [
	parseBundledSkill(configure, new Map([["references/configuration.md", configuration]])),
	parseBundledSkill(author, new Map([["references/example.md", example]])),
	parseBundledSkill(migrate, new Map()),
].sort((left, right) => left.name.localeCompare(right.name));

interface BundledSkill {
	/** Stable name used for selective retrieval. */
	name: string;
	/** Discovery trigger without instruction content. */
	description: string;
	/** Instructions without YAML frontmatter. */
	body: string;
	/** Explicitly bundled resources, addressed by relative path. */
	files: ReadonlyMap<string, string>;
}

export function listBundledSkills(input: unknown) {
	const { limit, offset } = listInputSchema.parse(input);
	const skills = catalog.slice(offset, offset + limit).map(({ name, description }) => ({
		name,
		description,
	}));
	const next = offset + skills.length;
	return { skills, total: catalog.length, nextOffset: next < catalog.length ? next : null };
}

export function getBundledSkill(name: string) {
	const skill = findBundledSkill(name);
	return { name: skill.name, body: skill.body };
}

export function getBundledSkillFile(name: string, path: string) {
	const skill = findBundledSkill(name);
	const content = skill.files.get(path);
	if (content === undefined) {
		throw responseError(
			"SKILL_FILE_NOT_FOUND",
			`No bundled resource '${path}' for '${name}'. Use skills get ${name} to find resource paths.`,
			{ skill: name, input: path },
		);
	}
	return { name: skill.name, path, content };
}

export function bundledSkillSchema(command: string) {
	const key = z.enum(["list", "get", "file"]).parse(command);
	return z.toJSONSchema(
		z.union([
			z.object({ success: z.literal(true), data: dataSchemas[key], errors: z.tuple([]) }),
			failureSchema,
		]),
	);
}

// -----------------------------------------------------------------------------

function findBundledSkill(name: string): BundledSkill {
	const skill = catalog.find((entry) => entry.name === name);
	if (!skill) {
		throw responseError(
			"SKILL_NOT_FOUND",
			`Unknown bundled skill '${name}'. Use skills list to discover names.`,
			{ skill: name },
		);
	}
	return skill;
}

function parseBundledSkill(raw: string, files: ReadonlyMap<string, string>): BundledSkill {
	const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(raw);
	if (!match) throw new Error("Bundled skill is missing YAML frontmatter.");
	return {
		...metadataSchema.parse(parseYaml(match[1]!)),
		body: match[2]!.trimStart(),
		files,
	};
}
