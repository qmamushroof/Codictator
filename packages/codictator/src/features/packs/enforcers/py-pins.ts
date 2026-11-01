// SPEC §6.3 driver `pypi`: manifest-side supplies for the pack enforcers.
// The requirements*.txt pin mirror and the pyproject dependency scan live
// here (rather than in py-lex.ts) so every supply file stays review-sized;
// like py-lex.ts this mirrors the drivers locally because §3.3 forbids the
// packs module from importing the pack supplies or features/deps.
import { makeError } from "../../../kernel/index.ts";
import type { Finding } from "../../engine/index.ts";
import type { RuleBinding } from "./binding.ts";
import { findingFor, readErrorFinding } from "./binding.ts";

// SPEC §6.3: lock `uv.lock` or fully pinned `requirements*.txt`.
export function isRequirementsFile(path: string): boolean {
	const slash = path.replaceAll("\\", "/").lastIndexOf("/");
	const base = slash < 0 ? path : path.slice(slash + 1);
	return (
		base === "requirements.txt" ||
		(base.startsWith("requirements") && base.endsWith(".txt"))
	);
}

export interface PythonRequirement {
	readonly name: string;
	readonly spec: string;
	readonly line: number;
}

export interface PythonRequirements {
	readonly reqs: Array<PythonRequirement>;
	readonly brokenLine: number | undefined;
}

interface LogicalLine {
	readonly line: string;
	readonly number: number;
}

// Join backslash continuations the way pip does, keeping the start line of
// each logical line. A trailing lone continuation still flushes.
function joinContinuedLines(text: string): Array<LogicalLine> {
	const logical: Array<LogicalLine> = [];
	let current = "";
	let start = 1;
	let line = 1;
	const flush = (): void => {
		logical.push({ line: current, number: start });
		current = "";
	};
	for (const raw of text.split("\n")) {
		const stripped = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
		if (current === "") {
			start = line;
		}
		if (stripped.endsWith("\\")) {
			current += `${stripped.slice(0, -1)} `;
		} else {
			current += stripped;
			flush();
		}
		line += 1;
	}
	if (current !== "") {
		flush();
	}
	return logical;
}

const REQUIREMENT_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?/;

// Parse one logical requirements line: comments and `-` directives stay
// quiet, `--hash` pin rows and non-requirement lines report their line,
// otherwise the PEP 508 name plus the marker-stripped spec lands.
function parseRequirementEntry(
	entry: LogicalLine,
	reqs: Array<PythonRequirement>,
): number | undefined {
	const uncommented = stripPyComment(entry.line).trim();
	if (uncommented === "") {
		return undefined;
	}
	if (uncommented.startsWith("--hash")) {
		return entry.number;
	}
	if (uncommented.startsWith("-")) {
		return undefined;
	}
	const name = REQUIREMENT_NAME.exec(uncommented)?.[0];
	if (name === undefined) {
		return entry.number;
	}
	const rest = uncommented
		.slice(name.length)
		.replace(/^\[[^\]]*\]/, "")
		.split(";", 1)[0]
		?.trim()
		.replace(/\s+--hash=\S+/g, "")
		.trim();
	reqs.push({ name, spec: rest ?? "", line: entry.number });
	return undefined;
}

// Join backslash continuations the way pip does, keeping the start line,
// then parse each logical line as a PEP 508 requirement. Local mirror of
// the features/deps/pypi.ts line handling (§3.3).
export function parsePythonRequirements(text: string): PythonRequirements {
	const reqs: Array<PythonRequirement> = [];
	let brokenLine: number | undefined;
	for (const entry of joinContinuedLines(text)) {
		const broken = parseRequirementEntry(entry, reqs);
		if (broken !== undefined) {
			brokenLine = broken;
		}
	}
	return { reqs, brokenLine };
}

function stripPyComment(line: string): string {
	for (let index = 0; index < line.length; index += 1) {
		if (
			line[index] === "#" &&
			(index === 0 || line[index - 1] === " " || line[index - 1] === "\t")
		) {
			return line.slice(0, index);
		}
	}
	return line;
}

// SPEC §6.3: exact pin is `name==x.y.z`; a bare name, comparisons, `~=`,
// `===` and `.*` prefixes are ranges. Local mirror of isExactPyPiPin (§3.3).
export function isExactPythonPin(spec: string): boolean {
	return /^==\d+\.\d+\.\d+(?:[-+_.][0-9A-Za-z.+-]+)?$/.test(spec.trim());
}

// SPEC §6.3 driver `pypi`: the `[project] dependencies` names plus the
// `[dependency-groups]` (and `[project.optional-dependencies]`) members,
// read as a static approximation over the manifest text: quoted literals
// inside each `name = [` array, skipping `{include-group}` rows, which name
// a group rather than a package.
export function collectPyprojectNames(text: string): Set<string> {
	const names = new Set<string>();
	const lines = text.split("\n");
	let section = "";
	let collecting = false;
	let depth = 0;
	const flushChunk = (chunk: string): void => {
		for (const match of chunk.matchAll(/"([^"]*)"|'([^']*)'/g)) {
			const literal = (match[1] ?? match[2] ?? "").trim();
			if (
				literal === "" ||
				literal.startsWith("{") ||
				literal.includes("include-group")
			) {
				continue;
			}
			const name = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?/.exec(
				literal,
			)?.[0];
			if (name !== undefined) {
				names.add(name);
			}
		}
	};
	for (const line of lines) {
		const header = /^[ \t]*\[([^\][\s]+)\][ \t]*(?:#.*)?$/.exec(line);
		if (header !== null) {
			collecting = false;
			section = (header[1] ?? "").toLowerCase();
			continue;
		}
		if (line.includes("include-group")) {
			continue;
		}
		const opensArray =
			(section === "project" &&
				/^[ \t]*dependencies[ \t]*=[ \t]*\[/.test(line)) ||
			((section === "dependency-groups" ||
				section === "project.optional-dependencies") &&
				/^[ \t]*[A-Za-z0-9_.-]+[ \t]*=[ \t]*\[/.test(line));
		if (!collecting && opensArray) {
			collecting = true;
			depth = 0;
		}
		if (!collecting) {
			continue;
		}
		for (const char of line) {
			if (char === "[") {
				depth += 1;
			} else if (char === "]") {
				depth -= 1;
			}
		}
		flushChunk(line);
		if (depth <= 0) {
			collecting = false;
		}
	}
	return names;
}

// SPEC §6.4 EC-7: a `requirements*.txt` line judges the core/dep-exact-pin
// verdict through the PyPI pin mirror above: only `name==x.y.z` pins, so a
// `requests>=2` line blocks while a fully pinned line stays clean. A line
// that is neither a directive nor a requirement fails closed (CDX-E903)
// instead of silently dropping a dependency the verdicts cannot see.
export function checkPythonPins(
	binding: RuleBinding,
	file: string,
	text: string,
	findings: Array<Finding>,
): void {
	const parsed = parsePythonRequirements(text);
	if (parsed.brokenLine !== undefined) {
		findings.push(
			readErrorFinding(
				binding,
				file,
				makeError(
					"CDX-E903",
					`${file} line ${String(parsed.brokenLine)} is not a requirement string`,
					"Write the line as a PEP 508 requirement string.",
				),
				"read",
			),
		);
		return;
	}
	for (const req of parsed.reqs) {
		if (!isExactPythonPin(req.spec)) {
			findings.push(
				findingFor(binding, {
					path: file,
					message: `${req.name}@${req.spec} in ${file} is not an exact pin`,
					vars: { path: file, value: `${req.name}@${req.spec}` },
				}),
			);
		}
	}
}
