// SPEC §4.1.2: readTomlKeys reads only the flat or one-level keys
// Codictator owns (Codex [features], pyproject [project] dependencies).
// Anything unparseable for those keys returns an error, never a guess.
import { makeError } from "./errors.ts";
import { err, ok, type Result } from "./result.ts";

type TomlValue = string | Array<string>;

function decodeTomlEscape(next: string): string | undefined {
	if (next === "n") {
		return "\n";
	}
	if (next === "t") {
		return "\t";
	}
	if (next === '"' || next === "\\") {
		return next;
	}
	return undefined;
}

function decodeTomlBasic(inner: string): string | undefined {
	let out = "";
	let index = 0;
	while (index < inner.length) {
		const char = inner.charAt(index);
		if (char === "\\") {
			const decoded = decodeTomlEscape(inner.charAt(index + 1));
			if (decoded === undefined) {
				return undefined;
			}
			out += decoded;
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

function parseTomlString(raw: string): string | undefined {
	if (raw.startsWith('"')) {
		if (!raw.endsWith('"') || raw.length < 2) {
			return undefined;
		}
		return decodeTomlBasic(raw.slice(1, -1));
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

type TomlScan = { depth: number; inString: string };

function scanTomlChar(state: TomlScan, char: string): void {
	if (char === '"' || char === "'") {
		state.inString = char;
	} else if (char === "[") {
		state.depth += 1;
	} else if (char === "]") {
		state.depth -= 1;
	}
}

// Scans one physical line, tracking bracket depth and string state across
// lines. A `#` outside strings and brackets ends the scan.
function scanTomlLine(raw: string, state: TomlScan): void {
	let index = 0;
	while (index < raw.length) {
		const char = raw.charAt(index);
		if (state.inString !== "") {
			if (char === "\\" && state.inString === '"') {
				index += 2;
				continue;
			}
			if (char === state.inString) {
				state.inString = "";
			}
			index += 1;
			continue;
		}
		if (char === "#" && state.depth === 0) {
			return;
		}
		scanTomlChar(state, char);
		index += 1;
	}
}

// Collects logical lines: a value opening [ continues until brackets close.
function tomlLogicalLines(text: string): Array<string> | undefined {
	const logical: Array<string> = [];
	let pending = "";
	const state: TomlScan = { depth: 0, inString: "" };
	for (const raw of text.split("\n")) {
		pending = pending === "" ? raw : `${pending}\n${raw}`;
		scanTomlLine(raw, state);
		if (state.depth < 0 || state.inString !== "") {
			return undefined;
		}
		if (state.depth > 0) {
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

function parseTomlHeader(line: string): string | undefined {
	const header = /^\[([A-Za-z0-9_.-]+)\]$/.exec(line);
	if (header === null) {
		return undefined;
	}
	return header[1] ?? "";
}

function enterTomlSection(
	sections: Map<string, Map<string, TomlValue>>,
	name: string,
): Map<string, TomlValue> {
	let section = sections.get(name);
	if (section === undefined) {
		section = new Map<string, TomlValue>();
		sections.set(name, section);
	}
	return section;
}

function parseTomlAssignment(
	line: string,
): { readonly key: string; readonly rawValue: string } | undefined {
	const assignment = /^([A-Za-z0-9_.-]+)\s*=\s*([\s\S]+)$/.exec(line);
	if (assignment === null) {
		return undefined;
	}
	const key = (assignment[1] ?? "").trim();
	const rawValue = (assignment[2] ?? "").trim();
	if (key === "" || rawValue === "") {
		return undefined;
	}
	return { key, rawValue };
}

function parseTomlValue(rawValue: string): TomlValue | undefined {
	if (rawValue.startsWith("[")) {
		const array = parseTomlArray(rawValue);
		return array ?? parseTomlScalar(rawValue);
	}
	return parseTomlScalar(rawValue);
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
		const header = parseTomlHeader(line);
		if (header !== undefined) {
			current = enterTomlSection(sections, header);
			continue;
		}
		const assignment = parseTomlAssignment(line);
		if (assignment === undefined) {
			return undefined;
		}
		const value = parseTomlValue(assignment.rawValue);
		if (value === undefined || current.has(assignment.key)) {
			return undefined;
		}
		current.set(assignment.key, value);
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
