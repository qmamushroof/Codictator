// SPEC §4.4.5 output parsers: sarif, json (dotted select), regex (named
// groups) and exit-code. Tool output is untrusted: an absolute path or a
// `..` segment never becomes a finding (dropped, counted as an escape),
// and every shape violation fails the batch closed (CDX-E207).
import {
	err,
	makeError,
	ok,
	parseJson,
	type Result,
} from "../../../kernel/index.ts";
import { field, isRecord } from "../manifest.ts";

export type OutputFormat = "sarif" | "json" | "regex" | "exit-code";

export interface JsonSelect {
	readonly results: string;
	readonly path: string;
	readonly line: string;
	readonly rule: string;
	readonly message: string;
}

export interface ParsedToolFinding {
	readonly toolRule: string;
	readonly path: string | undefined;
	readonly line: number | undefined;
	readonly message: string;
}

export interface ParsedToolOutput {
	readonly findings: ReadonlyArray<ParsedToolFinding>;
	// Paths dropped as outside the repo (SPEC §4.4.8 EC-9); the caller
	// raises one CDX-E207 when this is non-zero.
	readonly escapes: number;
}

export function parseError(detail: string): Result<never> {
	return err(
		makeError(
			"CDX-E207",
			`external tool output is unusable: ${detail}`,
			"Fix the tool output format or the pack output binding, then retry.",
		),
	);
}

function getPath(value: unknown, dotted: string): unknown {
	let current: unknown = value;
	for (const segment of dotted.split(".")) {
		if (Array.isArray(current)) {
			const index = Number(segment);
			if (!Number.isInteger(index) || index < 0) {
				return undefined;
			}
			const next: unknown = current[index];
			current = next;
		} else if (isRecord(current)) {
			current = current[segment];
		} else {
			return undefined;
		}
		if (current === undefined) {
			return undefined;
		}
	}
	return current;
}

function cleanPath(raw: unknown): string | undefined | "escape" {
	if (typeof raw !== "string" || raw.length === 0) {
		return undefined;
	}
	const slashed = raw.replace(/\\/g, "/");
	const path = slashed.startsWith("file://")
		? slashed.slice("file://".length)
		: slashed;
	if (
		path.startsWith("/") ||
		/^[A-Za-z]:/.test(path) ||
		path.startsWith("\\\\")
	) {
		return "escape";
	}
	for (const segment of path.split("/")) {
		if (segment === "..") {
			return "escape";
		}
	}
	return path;
}

function cleanLine(raw: unknown): number | undefined {
	if (typeof raw === "number" && Number.isInteger(raw) && raw >= 1) {
		return raw;
	}
	if (typeof raw === "string" && raw !== "") {
		const parsed = Number(raw);
		if (Number.isInteger(parsed) && parsed >= 1) {
			return parsed;
		}
	}
	return undefined;
}

function cleanMessage(raw: unknown, toolRule: string): string {
	if (typeof raw === "string" && raw.length > 0) {
		return raw;
	}
	return `tool rule ${toolRule} reported a finding`;
}

export function pushEntry(
	out: Array<ParsedToolFinding>,
	escapes: { count: number },
	entry: { toolRule: string; path: unknown; line: unknown; message: unknown },
): void {
	if (typeof entry.toolRule !== "string" || entry.toolRule.length === 0) {
		return;
	}
	const path = cleanPath(entry.path);
	if (path === "escape") {
		escapes.count += 1;
		return;
	}
	out.push({
		toolRule: entry.toolRule,
		path,
		line: cleanLine(entry.line),
		message: cleanMessage(entry.message, entry.toolRule),
	});
}

// SPEC §4.4.5: json with a dotted-path select for results, path, line,
// rule and message. A non-array results node fails the batch (CDX-E207).
export function parseJsonOutput(
	text: string,
	select: JsonSelect,
): Result<ParsedToolOutput> {
	const parsed = parseJson(text);
	if (!parsed.ok) {
		return parseError("json output is not JSON");
	}
	const results = getPath(parsed.value, select.results);
	if (!Array.isArray(results)) {
		return parseError("json output has no results array at select.results");
	}
	const findings: Array<ParsedToolFinding> = [];
	const escapes = { count: 0 };
	for (const entry of results) {
		if (!isRecord(entry)) {
			continue;
		}
		const toolRule = getPath(entry, select.rule);
		if (typeof toolRule !== "string" || toolRule.length === 0) {
			continue;
		}
		pushEntry(findings, escapes, {
			toolRule,
			path: getPath(entry, select.path),
			line: getPath(entry, select.line),
			message: getPath(entry, select.message),
		});
	}
	return ok({ findings, escapes: escapes.count });
}

// SPEC §4.4.5: regex with named groups path, line, rule, message, applied
// per output line. A findings-coded run that parses to zero entries is an
// unparseable-tool-output failure (CDX-E207), decided by the caller.
export function parseRegexOutput(
	text: string,
	pattern: RegExp,
): Result<ParsedToolOutput> {
	const findings: Array<ParsedToolFinding> = [];
	const escapes = { count: 0 };
	for (const content of text.split("\n")) {
		if (content === "") {
			continue;
		}
		const matched = pattern.exec(content);
		const groups = matched?.groups;
		if (groups === undefined) {
			continue;
		}
		const toolRule: unknown = field(groups, "rule");
		if (typeof toolRule !== "string" || toolRule.length === 0) {
			continue;
		}
		pushEntry(findings, escapes, {
			toolRule,
			path: field(groups, "path"),
			line: field(groups, "line"),
			message: field(groups, "message"),
		});
	}
	return ok({ findings, escapes: escapes.count });
}
