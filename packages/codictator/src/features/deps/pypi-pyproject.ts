// SPEC §6.3 driver `pypi` (pyproject half): the `[project]` table of
// pyproject.toml with its `requires-python` floor. Shares the PEP 508
// split, pin forms and error shape with pypi.ts; everything here is pure
// over caller-supplied text, mirroring the npm driver split across modules.
import { err, ok, type Result } from "../../kernel/index.ts";
import {
	depParseError,
	type PyPiDependency,
	sortByName,
	splitRequirement,
	stripComment,
} from "./pypi.ts";

export interface PyProjectDeps {
	readonly dependencies: ReadonlyArray<PyPiDependency>;
	readonly requiresPython: string | undefined;
}

function sectionHeader(line: string): string | undefined {
	const match = /^\s*\[([^\]]+)\]\s*(?:#.*)?$/.exec(line);
	if (match === null) {
		return undefined;
	}
	return (match[1] ?? "").trim();
}

function quotedStrings(chunk: string): Array<string> {
	const out: Array<string> = [];
	const pattern = /"((?:[^"\\]|\\.)*)"|'([^']*)'/g;
	const matches = chunk.matchAll(pattern);
	for (const match of matches) {
		out.push(match[1] ?? match[2] ?? "");
	}
	return out;
}

function arrayStartKey(line: string): string | undefined {
	const match = /^([A-Za-z0-9_.-]+)\s*=\s*\[/.exec(line);
	return match === null ? undefined : match[1];
}

// Brackets inside quoted requirement strings (extras such as
// `requests[security]`) always balance, so raw depth tracking closes the
// array at the first `]` that returns the depth to zero.
function isCompleteArray(chunk: string): boolean {
	let depth = 0;
	for (const char of chunk) {
		if (char === "[") {
			depth += 1;
		} else if (char === "]" && depth > 0) {
			depth -= 1;
			if (depth === 0) {
				return true;
			}
		}
	}
	return false;
}

function pushChunk(
	deps: Array<PyPiDependency>,
	chunk: string,
	kind: PyPiDependency["kind"],
): Result<void> {
	// PEP 735 `{include-group = "..."}` entries name another group, not a
	// package, so their quoted strings never reach the requirement split.
	const withoutIncludes = chunk.replace(/\{[^}]*\}/g, "");
	for (const entry of quotedStrings(withoutIncludes)) {
		const req = splitRequirement(entry);
		if (req === undefined) {
			return depParseError(
				"pyproject.toml dependency entry is not a requirement string",
				"Write the entry as a PEP 508 requirement string.",
			);
		}
		deps.push({ name: req.name, spec: req.spec, kind });
	}
	return ok(undefined);
}

function stepHeader(chunk: string, header: string): Result<string> {
	if (chunk !== "") {
		return depParseError(
			"pyproject.toml dependencies array never closes",
			"Close the dependencies array with ].",
		);
	}
	return ok(header);
}

function stepChunk(
	deps: Array<PyPiDependency>,
	chunk: string,
	line: string,
	kind: PyPiDependency["kind"],
): Result<string> {
	const next = `${chunk}${line}\n`;
	if (!isCompleteArray(next)) {
		return ok(next);
	}
	const pushed = pushChunk(deps, next, kind);
	if (!pushed.ok) {
		return err(pushed.error);
	}
	return ok("");
}

function readRequiresPython(section: string, line: string): string | undefined {
	if (section !== "project" || !line.startsWith("requires-python")) {
		return undefined;
	}
	return quotedStrings(line)[0];
}

// SPEC §6.3: `[project]` dependencies with the `requires-python` floor,
// plus PEP 735 `[dependency-groups]` (as dev; `[project.optional-...]`
// tables ride a later change). An unclosed array fails closed instead of
// parsing half a manifest. The sentinel header closes the file through the
// section-change error, so a dangling array needs no second trailing check.
export function parsePyprojectDependencies(
	text: string,
): Result<PyProjectDeps> {
	const lines = [...text.split("\n"), "[__end__]"];
	const deps: Array<PyPiDependency> = [];
	let requiresPython: string | undefined;
	let section = "";
	let chunk = "";
	for (const raw of lines) {
		const line = stripComment(raw).trim();
		const header = sectionHeader(line);
		if (header !== undefined) {
			const stepped = stepHeader(chunk, header);
			if (!stepped.ok) {
				return err(stepped.error);
			}
			section = stepped.value;
			continue;
		}
		if (section !== "project" && section !== "dependency-groups") {
			continue;
		}
		if (chunk === "" && arrayStartKey(line) === undefined) {
			requiresPython = readRequiresPython(section, line) ?? requiresPython;
			continue;
		}
		const stepped = stepChunk(
			deps,
			chunk,
			line,
			section === "dependency-groups" ? "dev" : "prod",
		);
		if (!stepped.ok) {
			return err(stepped.error);
		}
		chunk = stepped.value;
	}
	sortByName(deps);
	return ok({ dependencies: deps, requiresPython });
}
