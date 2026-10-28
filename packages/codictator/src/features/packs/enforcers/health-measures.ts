// SPEC §5.6 measures: size, complexity and export/import scans behind
// the code-health enforcers. Lexer-light mirrors of the §6.1 algorithms;
// the packs module cannot import the pack supplies (§3.3).
import type { Ports } from "../../../kernel/index.ts";
import type { CheckContext, Enforcer, Finding } from "../../engine/index.ts";
import type { PackRule } from "../index.ts";
import type { EnforcerDecl } from "../manifest.ts";
import {
	type RuleBinding,
	readErrorFinding,
	readLossyText,
	tunableNumber,
} from "./binding.ts";
import { blankCode, blankComments } from "./health-lex.ts";

function lineStartsFor(text: string): Array<number> {
	const starts: Array<number> = [0];
	for (let index = 0; index < text.length; index += 1) {
		if (text.charAt(index) === "\n") {
			starts.push(index + 1);
		}
	}
	return starts;
}

function lineAtIndex(starts: ReadonlyArray<number>, index: number): number {
	let line = 1;
	for (let cursor = 0; cursor < starts.length; cursor += 1) {
		if ((starts[cursor] ?? 0) > index) {
			break;
		}
		line = cursor + 1;
	}
	return line;
}

// SPEC §6.1: 1 + `if`, `for`, `while`, `case`, `catch`, `&&`, `||`, `??`
// and the ternary `?` (excluding `?.`, `??` and `?:`).
export function countCyclomatic(blanked: string): number {
	const words = blanked.match(/\b(if|for|while|case|catch)\b/g) ?? [];
	const ands = blanked.match(/&&/g) ?? [];
	const ors = blanked.match(/\|\|/g) ?? [];
	const nullish = blanked.match(/\?\?/g) ?? [];
	const withoutNullish = blanked.split("??").join("  ");
	const ternary = withoutNullish.match(/\?(?![?.:])/g) ?? [];
	return (
		1 +
		words.length +
		ands.length +
		ors.length +
		nullish.length +
		ternary.length
	);
}

function matchBrace(blanked: string, open: number): number {
	let depth = 0;
	for (let index = open; index < blanked.length; index += 1) {
		const char = blanked.charAt(index);
		if (char === "{") {
			depth += 1;
		} else if (char === "}") {
			depth -= 1;
			if (depth === 0) {
				return index;
			}
		}
	}
	return -1;
}

export interface FunctionSpan {
	readonly line: number;
	readonly lines: number;
}

// SPEC §6.1: size by brace matching from `function`, method and arrow
// starts. One span per body, judged on its own.
export function measureFunctionSpans(text: string): Array<FunctionSpan> {
	const blanked = blankCode(text);
	const starts = lineStartsFor(text);
	const froms: Array<number> = [];
	for (const match of blanked.matchAll(/\bfunction\b|=>/g)) {
		froms.push(match.index ?? -1);
	}
	const spans: Array<FunctionSpan> = [];
	for (const from of froms) {
		if (from < 0) {
			continue;
		}
		const open = blanked.indexOf("{", from);
		if (open < 0) {
			spans.push({ line: lineAtIndex(starts, from), lines: 1 });
			continue;
		}
		const close = matchBrace(blanked, open);
		if (close < 0) {
			continue;
		}
		spans.push({
			line: lineAtIndex(starts, from),
			lines: lineAtIndex(starts, close) - lineAtIndex(starts, from) + 1,
		});
	}
	return spans.sort((a, b) => a.line - b.line);
}

export function parseMarkers(text: string): Map<string, string> {
	const markers = new Map<string, string>();
	for (const line of text.split("\n")) {
		const colon = line.indexOf(":");
		if (colon < 0) {
			continue;
		}
		const key = line.slice(0, colon).trim().toLowerCase();
		const value = line.slice(colon + 1).trim();
		if (key.length > 0) {
			markers.set(key, value);
		}
	}
	return markers;
}

export function parseMarkerInt(
	markers: Map<string, string>,
	key: string,
): number | undefined {
	const raw = markers.get(key);
	if (raw === undefined) {
		return undefined;
	}
	const parsed = Number.parseInt(raw, 10);
	return Number.isInteger(parsed) ? parsed : undefined;
}

export async function loadScopeText(
	ports: Ports,
	binding: RuleBinding,
	file: string,
	findings: Array<Finding>,
): Promise<string | undefined> {
	const loaded = await readLossyText(ports.fs, file);
	if (!loaded.ok) {
		findings.push(readErrorFinding(binding, file, loaded.error, "read"));
		return undefined;
	}
	return loaded.value.text;
}

export function baseEnforcer(
	rule: PackRule,
	binding: RuleBinding,
	decl: EnforcerDecl,
	check: (ctx: CheckContext) => Promise<Array<Finding>>,
): Enforcer {
	return {
		id: rule.id,
		kinds: binding.triggers,
		budgetMs: decl.budgetMs,
		check,
	};
}

export function limitOf(
	binding: RuleBinding,
	name: string,
	fallback: number,
): number {
	return tunableNumber(binding, name) ?? fallback;
}

const TS_EXTENSIONS: ReadonlyArray<string> = [
	".ts",
	".tsx",
	".js",
	".jsx",
	".mjs",
	".cjs",
	".mts",
	".cts",
];

export function isTsFile(path: string): boolean {
	const lowered = path.toLowerCase();
	return TS_EXTENSIONS.some((extension) => lowered.endsWith(extension));
}

export function isMarkerFile(path: string): boolean {
	return path === "sample.txt" || path.endsWith("/sample.txt");
}

export function exportedNamesOf(blanked: string): Array<string> {
	const names: Array<string> = [];
	for (const match of blanked.matchAll(
		/\bexport\s+(?:default\b|(?:async\s+)?(?:function\s*\*?\s*|class\s+|interface\s+|type\s+|enum\s+|const\s+|let\s+|var\s+)([A-Za-z_$][\w$]*))/g,
	)) {
		const name = match[1] ?? "";
		if (name !== "") {
			names.push(name);
		}
	}
	for (const match of blanked.matchAll(/\bexport\s*\{([^}]*)\}/g)) {
		for (const part of (match[1] ?? "").split(",")) {
			const identifier = part.trim().match(/([A-Za-z_$][\w$]*)$/);
			if (identifier !== null) {
				names.push(identifier[1] ?? "");
			}
		}
	}
	return [...new Set(names)].sort();
}

function baseNameOf(path: string): string {
	const slash = path.lastIndexOf("/");
	const base = slash < 0 ? path : path.slice(slash + 1);
	const dot = base.lastIndexOf(".");
	return dot < 0 ? base : base.slice(0, dot);
}

export function isEntryFile(path: string): boolean {
	const base = baseNameOf(path).toLowerCase();
	return (
		base === "main" ||
		base === "index" ||
		base === "cli" ||
		path.includes(".test.")
	);
}

export function fileImportsTarget(importing: string, target: string): boolean {
	const needle = baseNameOf(target);
	const specs: Array<string> = [];
	const blanked = blankComments(importing);
	for (const match of blanked.matchAll(
		/\b(?:from|import\s*\(|require\s*\(|import)\s*["']([^"']+)["']/g,
	)) {
		specs.push(match[1] ?? "");
	}
	return specs.some((spec) => {
		const last = spec.split("/").pop() ?? "";
		const stem = last.replace(/\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/, "");
		return stem === needle;
	});
}
