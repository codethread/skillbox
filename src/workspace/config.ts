import { join, posix } from "node:path";
import { z } from "zod";
import { readOptional } from "./paths.ts";
import { responseError } from "../response.ts";

export const configPath = "skillbox/config.json";
export const bundleSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/);
export const relativePathSchema = z
	.string()
	.min(1)
	.refine(
		(value) =>
			value === "." ||
			(!posix.isAbsolute(value) &&
				!value.includes("\\") &&
				!/[\0\r\n]/.test(value) &&
				value.split("/").every((part) => part !== ".." && part !== ".git" && part !== "")),
		"Expected a relative path without traversal.",
	);
const names = z
	.array(bundleSchema)
	.min(1)
	.refine((items) => new Set(items).size === items.length, "Duplicate selected names.");
export const refSchema = z
	.string()
	.min(1)
	.refine((s) => !s.startsWith("-") && !/[\0\r\n]/.test(s));
const common = {
	id: bundleSchema,
	source: z
		.string()
		.min(1)
		.refine((s) => !s.startsWith("-") && !/[\0\r\n]/.test(s)),
	ref: refSchema.optional(),
};
export const contributionSchema = z.discriminatedUnion("type", [
	z
		.strictObject({
			type: z.literal("skills"),
			...common,
			path: relativePathSchema,
			pick: names.optional(),
			omit: names.optional(),
		})
		.superRefine((value, ctx) => {
			if (value.pick && value.omit)
				ctx.addIssue({ code: "custom", message: "pick and omit are mutually exclusive." });
		}),
	z
		.strictObject({
			type: z.literal("skillbox"),
			...common,
			bundles: names,
			pick: z.record(bundleSchema, names).optional(),
			omit: z.record(bundleSchema, names).optional(),
		})
		.superRefine((value, ctx) => {
			for (const key of new Set([
				...Object.keys(value.pick ?? {}),
				...Object.keys(value.omit ?? {}),
			])) {
				if (!value.bundles.includes(key))
					ctx.addIssue({
						code: "custom",
						message: `Selector for unrequested bundle: ${key}.`,
					});
				if (value.pick?.[key] && value.omit?.[key])
					ctx.addIssue({
						code: "custom",
						message: `pick and omit are mutually exclusive for ${key}.`,
					});
			}
		}),
]);
export type Contribution = z.infer<typeof contributionSchema>;
export const configSchema = z
	.strictObject({
		sources: z.array(contributionSchema),
		install: z
			.array(bundleSchema)
			.refine((items) => new Set(items).size === items.length, "Duplicate install bundles."),
	})
	.superRefine((config, ctx) => {
		const keys = config.sources.map(contributionIdentity);
		if (new Set(keys).size !== keys.length)
			ctx.addIssue({ code: "custom", message: "Duplicate contribution identity." });
	});
export type Config = z.infer<typeof configSchema>;

export function contributionIdentity(value: Contribution): string {
	return JSON.stringify([
		value.type,
		value.id,
		value.source,
		value.type === "skills" ? value.path : null,
	]);
}

export async function readConfig(root: string): Promise<Config | undefined> {
	const text = await readOptional(join(root, configPath));
	if (text === undefined) return undefined;
	try {
		return configSchema.parse(JSON.parse(text));
	} catch (cause) {
		throw responseError(
			"CONFIG_INVALID",
			`Invalid ${configPath}: ${cause instanceof Error ? cause.message : String(cause)}`,
			{ input: configPath },
			cause,
		);
	}
}

/** A repeated add replaces selectors deliberately; skillbox bundle requests merge. */
export function withContribution(config: Config, incoming: Contribution, install: boolean): Config {
	const key = contributionIdentity(incoming);
	const current = config.sources.find((value) => contributionIdentity(value) === key);
	let next = { ...incoming, ref: incoming.ref ?? current?.ref };
	if (incoming.type === "skillbox" && current?.type === "skillbox") {
		const pick = { ...current.pick };
		const omit = { ...current.omit };
		for (const bundle of incoming.bundles) {
			delete pick[bundle];
			delete omit[bundle];
			if (incoming.pick?.[bundle]) pick[bundle] = incoming.pick[bundle];
			if (incoming.omit?.[bundle]) omit[bundle] = incoming.omit[bundle];
		}
		next = {
			...incoming,
			ref: incoming.ref ?? current.ref,
			bundles: [...new Set([...current.bundles, ...incoming.bundles])],
			...(Object.keys(pick).length ? { pick } : {}),
			...(Object.keys(omit).length ? { omit } : {}),
		};
	}
	return {
		sources: current
			? config.sources.map((value) => (value === current ? next : value))
			: [...config.sources, next],
		install: install ? [...new Set([...config.install, incoming.id])] : config.install,
	};
}

export function selectMembers<M extends { name: string }>(
	members: M[],
	pick: string[] | undefined,
	omit: string[] | undefined,
): M[] {
	for (const name of pick ?? omit ?? [])
		if (!members.some((member) => member.name === name))
			throw responseError("SKILL_NOT_FOUND", `No selected skill named ${name}.`, {
				skill: name,
			});
	return members.filter(
		(member) => (!pick || pick.includes(member.name)) && !omit?.includes(member.name),
	);
}
