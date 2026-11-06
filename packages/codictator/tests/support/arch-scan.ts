// Shared src-text scan helpers for the §10.3 architecture tests. Kept here
// so no single arch test file breaches core/file-size; behaviour unchanged.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function srcRoot(): string {
	return fileURLToPath(new URL("../../src/", import.meta.url));
}

export function toPosixPath(value: string): string {
	return value.split(path.sep).join("/");
}

export function collectSrcFiles(): Array<string> {
	const root = srcRoot();
	const found: Array<string> = [];
	const walk = (dir: string): void => {
		const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
			a.name < b.name ? -1 : 1,
		);
		for (const entry of entries) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				walk(full);
			} else if (entry.isFile() && entry.name.endsWith(".ts")) {
				found.push(full);
			}
		}
	};
	walk(root);
	return found;
}

export function relativeToSrc(file: string): string {
	return toPosixPath(path.relative(srcRoot(), file));
}

export function readSrc(file: string): string {
	return readFileSync(file, "utf8");
}

export function repoRoot(): string {
	return path.resolve(srcRoot(), "..", "..", "..");
}

export function relativeToRepo(file: string): string {
	return toPosixPath(path.relative(repoRoot(), file));
}

export type StringSpan = {
	readonly start: number;
	readonly end: number;
	readonly startLine: number;
	readonly startCol: number;
	readonly endLine: number;
	readonly endCol: number;
};

export type JsonParseMatch = {
	readonly offset: number;
	readonly line: number;
	readonly column: number;
};

export function offsetToLineColumn(
	text: string,
	offset: number,
): { readonly line: number; readonly column: number } {
	let line = 1;
	let column = 1;
	for (let index = 0; index < offset; index += 1) {
		if (text[index] === "\n") {
			line += 1;
			column = 1;
		} else {
			column += 1;
		}
	}
	return { line, column };
}

function scanQuotedEnd(text: string, index: number, quote: string): number {
	let cursor = index + 1;
	while (cursor < text.length) {
		const current = text[cursor] ?? "";
		if (current === "\\") {
			cursor += 2;
			continue;
		}
		if (current === quote) {
			return cursor;
		}
		cursor += 1;
	}
	return text.length;
}

function scanBacktick(
	text: string,
	index: number,
	push: (start: number, end: number) => void,
): number {
	let cursor = index + 1;
	let partStart = index;
	while (cursor < text.length) {
		const current = text[cursor] ?? "";
		const next = text[cursor + 1] ?? "";
		if (current === "\\") {
			cursor += 2;
			continue;
		}
		if (current === "`") {
			push(partStart, cursor);
			return cursor + 1;
		}
		if (current === "$" && next === "{") {
			push(partStart, cursor - 1);
			let depth = 1;
			cursor += 2;
			while (cursor < text.length && depth > 0) {
				if (text[cursor] === "{") {
					depth += 1;
				} else if (text[cursor] === "}") {
					depth -= 1;
				}
				cursor += 1;
			}
			partStart = cursor;
			continue;
		}
		cursor += 1;
	}
	return text.length;
}

function skipLineComment(text: string, index: number): number {
	const end = text.indexOf("\n", index + 2);
	return end < 0 ? text.length : end + 1;
}

function skipBlockComment(text: string, index: number): number {
	const end = text.indexOf("*/", index + 2);
	return end < 0 ? text.length : end + 2;
}

function toLineSpans(
	text: string,
	ranges: ReadonlyArray<{ readonly start: number; readonly end: number }>,
): Array<StringSpan> {
	return ranges.map((range) => {
		const start = offsetToLineColumn(text, range.start);
		const end = offsetToLineColumn(text, range.end);
		return {
			start: range.start,
			end: range.end,
			startLine: start.line,
			startCol: start.column,
			endLine: end.line,
			endCol: end.column,
		};
	});
}

export function stringLiteralSpans(text: string): Array<StringSpan> {
	const ranges: Array<{ readonly start: number; readonly end: number }> = [];
	let cursor = 0;
	while (cursor < text.length) {
		const current = text[cursor] ?? "";
		const next = text[cursor + 1] ?? "";
		if (current === "/" && next === "/") {
			cursor = skipLineComment(text, cursor);
			continue;
		}
		if (current === "/" && next === "*") {
			cursor = skipBlockComment(text, cursor);
			continue;
		}
		if (current === "'" || current === '"') {
			const end = scanQuotedEnd(text, cursor, current);
			ranges.push({ start: cursor, end });
			cursor = end + 1;
			continue;
		}
		if (current === "`") {
			cursor = scanBacktick(text, cursor, (start, end) => {
				ranges.push({ start, end });
			});
			continue;
		}
		cursor += 1;
	}
	return toLineSpans(text, ranges);
}

export function findJsonParseMatches(text: string): Array<JsonParseMatch> {
	const pattern = /JSON\.parse\s*\(/g;
	const matches: Array<JsonParseMatch> = [];
	let match = pattern.exec(text);
	while (match !== null) {
		const location = offsetToLineColumn(text, match.index);
		matches.push({
			offset: match.index,
			line: location.line,
			column: location.column,
		});
		match = pattern.exec(text);
	}
	return matches;
}

export function spanKey(repoRel: string, span: StringSpan): string {
	return `${repoRel}:${span.startLine}:${span.startCol}-${span.endLine}:${span.endCol}`;
}

export function containingSpan(
	spans: ReadonlyArray<StringSpan>,
	offset: number,
): StringSpan | undefined {
	for (const span of spans) {
		if (offset > span.start && offset < span.end) {
			return span;
		}
	}
	return undefined;
}
