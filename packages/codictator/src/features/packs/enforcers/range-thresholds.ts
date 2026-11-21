// SPEC §4.10.4 core/no-threshold-lowering, L4 range judge: the
// coverage-threshold keys table. Each changed config file's thresholds are
// read at the range base and at HEAD; a key whose number falls, or that
// disappears, is the violation. Tightening is free.
//
// Parsing limits (deterministic, no evaluation of config code):
// - package.json reads as JSON; `jest.coverageThreshold` numeric leaves.
// - jest.config.* / vitest.config.* are scanned, not executed: the first
//   `coverageThreshold` (jest) or `thresholds` (vitest) object literal is
//   walked for `key: <number>` pairs, nested keys joined with dots. Values
//   computed at runtime, spread in, or imported are not seen.
// - pyproject.toml: `fail_under` inside `[tool.coverage.report]`;
//   .coveragerc: `fail_under` (`=` or `:`) inside `[report]`.
import { field, isRecord } from "../manifest.ts";
import { findingFor } from "./binding.ts";
import {
	forEachBaseHead,
	notFixture,
	parseJsonText,
	type RangeArgs,
} from "./range-base.ts";

type Thresholds = Map<string, number>;

function baseName(file: string): string {
	return file.slice(file.lastIndexOf("/") + 1);
}

function jsonLeaves(value: unknown, prefix: string, into: Thresholds): void {
	if (typeof value === "number") {
		into.set(prefix, value);
		return;
	}
	if (isRecord(value)) {
		for (const [key, inner] of Object.entries(value)) {
			jsonLeaves(inner, prefix === "" ? key : `${prefix}.${key}`, into);
		}
	}
}

const PAIR = /(["']?)([\w./*-]+)\1\s*:\s*(\{|-?\d+(?:\.\d+)?)|\}/g;

// Walks the object literal opened right after `key:` and records its
// numeric pairs.
function literalThresholds(text: string, key: string): Thresholds {
	const found: Thresholds = new Map();
	const open = new RegExp(`\\b${key}["']?\\s*:\\s*\\{`).exec(text);
	if (open === null) {
		return found;
	}
	const path: Array<string> = [];
	let depth = 1;
	PAIR.lastIndex = open.index + open[0].length;
	for (let hit = PAIR.exec(text); hit !== null; hit = PAIR.exec(text)) {
		if (hit[0] === "}") {
			depth -= 1;
			if (depth === 0) {
				break;
			}
			path.pop();
		} else if (hit[3] === "{") {
			depth += 1;
			path.push(hit[2] ?? "");
		} else {
			found.set([...path, hit[2] ?? ""].join("."), Number(hit[3]));
		}
	}
	return found;
}

function sectionValue(text: string, section: string, key: string): Thresholds {
	const found: Thresholds = new Map();
	let inside = false;
	for (const line of text.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (trimmed.startsWith("[")) {
			inside = trimmed === `[${section}]`;
			continue;
		}
		const match = new RegExp(`^${key}\\s*[=:]\\s*(-?\\d+(?:\\.\\d+)?)`).exec(
			trimmed,
		);
		if (inside && match !== null) {
			found.set(`${section}.${key}`, Number(match[1]));
		}
	}
	return found;
}

// The threshold reader for a pack-known config file, if any.
function readerFor(file: string): ((text: string) => Thresholds) | undefined {
	const name = baseName(file);
	if (name === "package.json") {
		return (text) => {
			const found: Thresholds = new Map();
			const json = parseJsonText(text);
			const jest = isRecord(json) ? field(json, "jest") : undefined;
			const threshold = isRecord(jest)
				? field(jest, "coverageThreshold")
				: undefined;
			jsonLeaves(threshold, "coverageThreshold", found);
			return found;
		};
	}
	if (/^jest\.config\.[cm]?[jt]s$|^jest\.config\.json$/.test(name)) {
		return (text) => literalThresholds(text, "coverageThreshold");
	}
	if (/^vitest\.config\.[cm]?[jt]s$/.test(name)) {
		return (text) => literalThresholds(text, "thresholds");
	}
	if (name === "pyproject.toml") {
		return (text) => sectionValue(text, "tool.coverage.report", "fail_under");
	}
	if (name === ".coveragerc") {
		return (text) => sectionValue(text, "report", "fail_under");
	}
	return undefined;
}

export async function judgeThresholds(args: RangeArgs): Promise<void> {
	await forEachBaseHead(
		args,
		(file) => notFixture(file) && readerFor(file) !== undefined,
		(file, before, after) => {
			const read = readerFor(file);
			if (read === undefined) {
				return;
			}
			const head = read(after);
			for (const [key, was] of read(before)) {
				const now = head.get(key);
				if (now === undefined || now < was) {
					args.findings.push(
						findingFor(args.binding, {
							path: file,
							message: `coverage threshold ${key} lowered in ${file}`,
							vars: {
								path: file,
								limit: String(was),
								value: `${key} ${String(was)} -> ${now === undefined ? "removed" : String(now)}`,
							},
						}),
					);
				}
			}
		},
	);
}
