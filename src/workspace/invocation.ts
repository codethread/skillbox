import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { parseDocument, stringify } from "yaml";
import { z } from "zod";
import { responseError } from "../response.ts";
import { readOptional } from "./paths.ts";

const metadataSchema = z.looseObject({
	policy: z.record(z.string(), z.unknown()).optional(),
});

export async function applyInvocationPolicy(directory: string): Promise<void> {
	const text = await readFile(join(directory, "SKILL.md"), "utf8");
	const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
	if (!frontmatter || parseDocument(frontmatter[1]!).get("disable-model-invocation") !== true)
		return;

	const path = join(directory, "agents/openai.yaml");
	const authored = await readOptional(path);
	let output: string;
	try {
		const document = parseDocument(authored ?? "{}", { merge: true });
		if (document.errors.length) throw document.errors[0];
		const metadata = metadataSchema.parse(document.toJS());
		if (metadata.policy?.allow_implicit_invocation === false) return;
		output = stringify({
			...metadata,
			policy: { ...metadata.policy, allow_implicit_invocation: false },
		});
	} catch (cause) {
		throw responseError(
			"INVALID_SKILL_METADATA",
			`Invalid agents/openai.yaml for ${basename(directory)}.`,
			{ skill: basename(directory), input: path },
			cause,
		);
	}
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, output);
}
