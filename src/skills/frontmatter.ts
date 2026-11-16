import matter from "gray-matter";
import { parse } from "yaml";

export function parseFrontmatter(text: string) {
	return matter(text, { engines: { yaml: parse, javascript: parse } });
}
