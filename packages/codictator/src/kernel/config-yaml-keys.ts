// SPEC §4.1.2: readYamlKeys reads only the flat or one-level keys
// Codictator owns (Dependabot updates). Anything unparseable for those keys
// returns an error, never a guess.
import { makeError } from "./errors.ts";
import { stableStringify } from "./json.ts";
import { err, ok, type Result } from "./result.ts";

type YamlNode = string | Array<YamlNode> | { readonly [key: string]: YamlNode };

function yamlScalar(raw: string): string | undefined {
	const trimmed = raw.trim();
	if (trimmed === "" || trimmed === "~" || trimmed === "null") {
		return "";
	}
	if (
		(trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) ||
		(trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2)
	) {
		return trimmed.slice(1, -1);
	}
	if (/[:#[\]{}|>&*!%@`,]/.test(trimmed.charAt(0))) {
		return undefined;
	}
	if (trimmed.includes(" #")) {
		return trimmed.slice(0, trimmed.indexOf(" #")).trimEnd();
	}
	return trimmed;
}

function yamlIndent(line: string): number {
	let count = 0;
	while (line.charAt(count) === " ") {
		count += 1;
	}
	return count;
}

// Indent of the next content line, or undefined when none follows.
function nextIndent(
	lines: ReadonlyArray<string>,
	start: number,
): number | undefined {
	for (let index = start; index < lines.length; index += 1) {
		const raw = lines[index] ?? "";
		if (raw.trim() === "" || raw.trimStart().startsWith("#")) {
			continue;
		}
		return yamlIndent(raw);
	}
	return undefined;
}

// Minimal block parser: mappings nested by indentation plus sequences of
// scalars. Anything else (tabs, anchors, flow maps, deep structures beyond
// the depth cap) is unparseable, never guessed.
function parseYamlBlock(
	lines: ReadonlyArray<string>,
	start: number,
	indent: number,
	depth: number,
): { readonly node: YamlNode; readonly next: number } | undefined {
	if (depth > 8) {
		return undefined;
	}
	const mapping: Record<string, YamlNode> = {};
	const sequence: Array<YamlNode> = [];
	let index = start;
	while (index < lines.length) {
		const raw = lines[index] ?? "";
		if (raw.trim() === "" || raw.trimStart().startsWith("#")) {
			index += 1;
			continue;
		}
		if (raw.includes("\t")) {
			return undefined;
		}
		const at = yamlIndent(raw);
		if (at < indent) {
			break;
		}
		if (at > indent) {
			return undefined;
		}
		const body = raw.slice(indent);
		if (body.startsWith("- ") || body === "-") {
			const item = body === "-" ? "" : body.slice(2);
			const scalar = yamlScalar(item);
			if (scalar === undefined) {
				return undefined;
			}
			sequence.push(scalar);
			index += 1;
			continue;
		}
		const colon = body.indexOf(":");
		if (colon < 0) {
			return undefined;
		}
		const key = body.slice(0, colon).trim();
		if (key === "" || /[\s#[\]{}]/.test(key)) {
			return undefined;
		}
		const rest = body.slice(colon + 1).trim();
		index += 1;
		if (rest !== "") {
			const scalar = yamlScalar(rest);
			if (scalar === undefined) {
				return undefined;
			}
			mapping[key] = scalar;
			continue;
		}
		const childIndent = nextIndent(lines, index);
		if (childIndent === undefined || childIndent <= indent) {
			mapping[key] = "";
			continue;
		}
		const child = parseYamlBlock(lines, index, childIndent, depth + 1);
		if (child === undefined) {
			return undefined;
		}
		mapping[key] = child.node;
		index = child.next;
	}
	if (sequence.length > 0) {
		if (Object.keys(mapping).length > 0) {
			return undefined;
		}
		return { node: sequence, next: index };
	}
	return { node: mapping, next: index };
}

function parseYaml(text: string): YamlNode | undefined {
	if (text.includes("\t")) {
		return undefined;
	}
	const lines = text.split("\n");
	const parsed = parseYamlBlock(lines, 0, 0, 0);
	if (parsed === undefined || parsed.next !== lines.length) {
		return undefined;
	}
	return parsed.node;
}

function lookupYaml(node: YamlNode, key: string): string | undefined {
	const dot = key.indexOf(".");
	const head = dot < 0 ? key : key.slice(0, dot);
	const tail = dot < 0 ? undefined : key.slice(dot + 1);
	let current: YamlNode = node;
	if (
		typeof current !== "object" ||
		current === null ||
		Array.isArray(current)
	) {
		return undefined;
	}
	const child: YamlNode | undefined = current[head];
	if (child === undefined) {
		return undefined;
	}
	current = child;
	if (tail !== undefined) {
		return lookupYaml(current, tail);
	}
	if (typeof current === "string") {
		return current;
	}
	if (Array.isArray(current)) {
		const flat: Array<string> = [];
		for (const item of current) {
			if (typeof item !== "string") {
				return undefined;
			}
			flat.push(item);
		}
		return flat.join("\n");
	}
	return stableStringify(current);
}

export function readYamlKeys(
	text: string,
	keys: ReadonlyArray<string>,
): Result<Readonly<Record<string, string>>> {
	if (text.trim() === "") {
		return ok({});
	}
	const parsed = parseYaml(text);
	if (parsed === undefined) {
		return err(
			makeError(
				"CDX-E101",
				"YAML is unparseable",
				"Fix the YAML syntax; keys are read exactly, never guessed.",
			),
		);
	}
	const found: Record<string, string> = {};
	for (const key of keys) {
		const value = lookupYaml(parsed, key);
		if (value !== undefined) {
			found[key] = value;
		}
	}
	return ok(found);
}
