// SPEC §4.1.2: readTomlKeys and readYamlKeys read only the flat or
// one-level keys Codictator owns (Codex [features], Dependabot updates,
// pyproject [project] dependencies). Anything unparseable for those keys
// returns an error, never a guess.
import { makeError } from "./errors.ts";
import { stableStringify } from "./json.ts";
import { err, ok, type Result } from "./result.ts";

type TomlValue = string | Array<string>;

function parseTomlString(raw: string): string | undefined {
	if (raw.startsWith('"')) {
		if (!raw.endsWith('"') || raw.length < 2) {
			return undefined;
		}
		const inner = raw.slice(1, -1);
		let out = "";
		let index = 0;
		while (index < inner.length) {
			const char = inner.charAt(index);
			if (char === "\\") {
				const next = inner.charAt(index + 1);
				if (next === "n") {
					out += "\n";
				} else if (next === "t") {
					out += "\t";
				} else if (next === '"' || next === "\\") {
					out += next;
				} else {
					return undefined;
				}
				index += 2;
				continue;
			}
			if (char === "\n") {
				return undefined;
			}
			out += char;
			index += 1;
		}
		return out;
	}
	if (raw.startsWith("'") && raw.endsWith("'") && raw.length >= 2) {
		return raw.slice(1, -1);
	}
	return undefined;
}

function parseTomlScalar(raw: string): string | undefined {
	const quoted = parseTomlString(raw);
	if (quoted !== undefined) {
		return quoted;
	}
	if (
		raw === "true" ||
		raw === "false" ||
		/^[+-]?[\d_]+(\.\d+)?([eE][+-]?\d+)?$/.test(raw)
	) {
		return raw;
	}
	return undefined;
}

// Collects logical lines: a value opening [ continues until brackets close.
function tomlLogicalLines(text: string): Array<string> | undefined {
	const logical: Array<string> = [];
	let pending = "";
	let depth = 0;
	let inString = "";
	for (const raw of text.split("\n")) {
		pending = pending === "" ? raw : `${pending}\n${raw}`;
		let index = 0;
		while (index < raw.length) {
			const char = raw.charAt(index);
			if (inString !== "") {
				if (char === "\\" && inString === '"') {
					index += 2;
					continue;
				}
				if (char === inString) {
					inString = "";
				}
				index += 1;
				continue;
			}
			if (char === '"' || char === "'") {
				inString = char;
			} else if (char === "[") {
				depth += 1;
			} else if (char === "]") {
				depth -= 1;
			} else if (char === "#" && depth === 0) {
				break;
			}
			index += 1;
		}
		if (depth < 0 || inString !== "") {
			return undefined;
		}
		if (depth > 0) {
			continue;
		}
		logical.push(pending);
		pending = "";
	}
	if (pending !== "") {
		return undefined;
	}
	return logical;
}

function parseTomlArray(raw: string): Array<string> | undefined {
	const trimmed = raw.trim();
	if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
		return undefined;
	}
	const inner = trimmed.slice(1, -1).trim();
	if (inner === "") {
		return [];
	}
	const items: Array<string> = [];
	for (const part of inner.split(",")) {
		if (part.trim() === "") {
			continue;
		}
		const scalar = parseTomlScalar(part.trim());
		if (scalar === undefined) {
			return undefined;
		}
		items.push(scalar);
	}
	return items;
}

function parseToml(
	text: string,
):
	| { readonly sections: ReadonlyMap<string, ReadonlyMap<string, TomlValue>> }
	| undefined {
	const logical = tomlLogicalLines(text);
	if (logical === undefined) {
		return undefined;
	}
	const sections = new Map<string, Map<string, TomlValue>>();
	const top = new Map<string, TomlValue>();
	sections.set("", top);
	let current = top;
	for (const raw of logical) {
		const line = raw.trim();
		if (line === "") {
			continue;
		}
		const header = /^\[([A-Za-z0-9_.-]+)\]$/.exec(line);
		if (header !== null) {
			const name = header[1] ?? "";
			let section = sections.get(name);
			if (section === undefined) {
				section = new Map<string, TomlValue>();
				sections.set(name, section);
			}
			current = section;
			continue;
		}
		const assignment = /^([A-Za-z0-9_.-]+)\s*=\s*([\s\S]+)$/.exec(line);
		if (assignment === null) {
			return undefined;
		}
		const key = (assignment[1] ?? "").trim();
		const rawValue = (assignment[2] ?? "").trim();
		if (key === "" || rawValue === "") {
			return undefined;
		}
		const array = rawValue.startsWith("[")
			? parseTomlArray(rawValue)
			: undefined;
		const scalar = array ?? parseTomlScalar(rawValue);
		if (scalar === undefined) {
			return undefined;
		}
		if (current.has(key)) {
			return undefined;
		}
		current.set(key, scalar);
	}
	return { sections };
}

function lookupToml(
	sections: ReadonlyMap<string, ReadonlyMap<string, TomlValue>>,
	key: string,
): string | undefined {
	const dot = key.indexOf(".");
	if (dot < 0) {
		const value = sections.get("")?.get(key);
		if (value === undefined) {
			return undefined;
		}
		return Array.isArray(value) ? value.join("\n") : value;
	}
	const section = sections.get(key.slice(0, dot));
	const value = section?.get(key.slice(dot + 1));
	if (value === undefined) {
		return undefined;
	}
	return Array.isArray(value) ? value.join("\n") : value;
}

export function readTomlKeys(
	text: string,
	keys: ReadonlyArray<string>,
): Result<Readonly<Record<string, string>>> {
	const parsed = parseToml(text);
	if (parsed === undefined) {
		return err(
			makeError(
				"CDX-E101",
				"TOML is unparseable",
				"Fix the TOML syntax; keys are read exactly, never guessed.",
			),
		);
	}
	const found: Record<string, string> = {};
	for (const key of keys) {
		const value = lookupToml(parsed.sections, key);
		if (value !== undefined) {
			found[key] = value;
		}
	}
	return ok(found);
}

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
