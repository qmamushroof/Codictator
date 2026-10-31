// SPEC §6.3 driver `pypi`: manifest parsing, exact-pin forms and hash
// discipline. PEP 508 requirement strings, requirements.txt files with
// `--hash` entries and the `.python-version` toolchain file; the
// `[project]` table of pyproject.toml lives in pypi-pyproject.ts, mirroring
// the npm driver split (manifest logic here, lockfile in lockfile.ts).
// Everything here is pure over caller-supplied text; a Driver instance that
// reads the repo waits for gate-closure wiring with ports (SPEC §3.3).
import { err, makeError, ok, type Result } from "../../kernel/index.ts";

export const PYPI_ECOSYSTEM = "pypi";

// SPEC §4.8.1: dependency kinds; toolchains (.python-version) ride the
// same verdict path with kind "toolchain".
export type PyPiDepKind = "prod" | "dev" | "toolchain";

export interface PyPiDependency {
	readonly name: string;
	readonly spec: string;
	readonly kind: PyPiDepKind;
}

// SPEC §6.3: exact pin is `name==x.y.z`; a bare name, comparisons, `~=`,
// `===` and `.*` prefixes are ranges; `@ url` is a direct reference.
export type PyPiPinForm = "exact" | "range" | "url";

// SPEC §6.3: exact pin is `==` plus a full `x.y.z` (optional pre/post
// segment); `==2` and `==2.31` are ranges, not pins.
const PYPI_EXACT_SPEC = /^==\d+\.\d+\.\d+(?:[-+_.][0-9A-Za-z.+-]+)?$/;

export function isExactPyPiPin(spec: string): boolean {
	const trimmed = spec.trim();
	return PYPI_EXACT_SPEC.test(trimmed);
}

export function classifyPyPiSpec(spec: string): PyPiPinForm {
	const trimmed = spec.trim();
	if (trimmed.startsWith("@") || trimmed.includes("://")) {
		return "url";
	}
	return isExactPyPiPin(trimmed) ? "exact" : "range";
}

export interface PyPiRequirement {
	readonly name: string;
	readonly spec: string;
	readonly hashes: ReadonlyArray<string>;
}

// pip joins backslash continuations before parsing, so a `--hash` entry
// may ride the requirement line or the lines after it.
function logicalLines(text: string): Array<string> {
	const out: Array<string> = [];
	let current = "";
	for (const raw of text.split("\n")) {
		const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
		if (line.endsWith("\\")) {
			current += `${line.slice(0, -1)} `;
			continue;
		}
		current += line;
		out.push(current);
		current = "";
	}
	if (current !== "") {
		out.push(current);
	}
	return out;
}

// A `#` starts a comment only at the line start or after whitespace, so
// URL fragments such as `#egg=` survive the strip.
export function stripComment(line: string): string {
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

function takeHashes(line: string): {
	readonly clean: string;
	readonly hashes: ReadonlyArray<string>;
} {
	const hashes: Array<string> = [];
	const clean = line.replace(/\s+--hash=\S+/g, (token) => {
		hashes.push(token.replace(/^\s+--hash=/, ""));
		return "";
	});
	return { clean: clean.trim(), hashes };
}

// A PEP 508 requirement is a name with optional extras, a version spec
// and an optional environment marker; only the name and spec judge pins.
export function splitRequirement(
	line: string,
): { readonly name: string; readonly spec: string } | undefined {
	const trimmed = line.trim();
	const name = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?/.exec(trimmed)?.[0];
	if (name === undefined) {
		return undefined;
	}
	const rest =
		trimmed
			.slice(name.length)
			.replace(/^\[[^\]]*\]/, "")
			.split(";", 1)[0] ?? "";
	return { name, spec: rest.trim() };
}

export function sortByName<T extends { name: string }>(items: Array<T>): void {
	items.sort((left, right) => {
		if (left.name === right.name) {
			return 0;
		}
		return left.name < right.name ? -1 : 1;
	});
}

export function depParseError(message: string, fix: string): Result<never> {
	return err(makeError("CDX-E101", message, fix));
}

interface MutableRequirement {
	name: string;
	spec: string;
	hashes: Array<string>;
}

function pushRequirementLine(
	found: Array<MutableRequirement>,
	uncommented: string,
): Result<void> {
	const taken = takeHashes(uncommented);
	const req = splitRequirement(taken.clean);
	if (req === undefined) {
		return depParseError(
			"requirements.txt line is not a requirement string",
			"Write the line as a PEP 508 requirement string.",
		);
	}
	found.push({
		name: req.name,
		spec: req.spec,
		hashes: [...taken.hashes],
	});
	return ok(undefined);
}

// SPEC §6.3 and §6.4 EC-7: a requirements line is pinned only as `==`;
// ranges such as `requests>=2` block core/dep-exact-pin. A line that is
// neither a directive nor a requirement fails closed instead of silently
// dropping a dependency the verdicts cannot see.
export function parseRequirementsText(
	text: string,
): Result<Array<PyPiRequirement>> {
	const found: Array<MutableRequirement> = [];
	for (const line of logicalLines(text)) {
		const uncommented = stripComment(line).trim();
		if (uncommented === "") {
			continue;
		}
		if (uncommented.startsWith("--hash")) {
			return depParseError(
				"requirements.txt hash entry names no requirement",
				"Join the hash to the requirement line with a trailing backslash.",
			);
		}
		if (uncommented.startsWith("-")) {
			continue;
		}
		const pushed = pushRequirementLine(found, uncommented);
		if (!pushed.ok) {
			return err(pushed.error);
		}
	}
	sortByName(found);
	return ok(found);
}

// SPEC §6.3: a requirements lockfile is fully pinned (`==`) with hashes.
export function requirementsFullyPinned(
	reqs: ReadonlyArray<PyPiRequirement>,
): boolean {
	return (
		reqs.length > 0 &&
		reqs.every((req) => isExactPyPiPin(req.spec) && req.hashes.length > 0)
	);
}

// SPEC §6.3 toolchain: `.python-version` names the exact interpreter.
export function parsePythonVersionFile(text: string): string {
	return text.trim();
}

export function isExactPythonVersion(version: string): boolean {
	return /^\d+\.\d+\.\d+(?:[-+_.][0-9A-Za-z.+-]+)?$/.test(version.trim());
}
