// SPEC §4.10.4 test integrity at L4: each judge compares the base and head
// of the range's changed files with the pack patterns of §6.1 (TypeScript)
// and §6.3 (Python). Fixture trees hold test vectors, so only the
// fixture-shrink judge reads them.
import { blankCode, blankComments } from "./health-lex.ts";
import { isTsFile, measureFunctionSpans } from "./health-measures.ts";
import { blankPythonCode, isPythonFile } from "./py-lex.ts";
import {
	countMatches,
	flagRange,
	forEachBaseHead,
	lineChurn,
	notFixture,
	type RangeArgs,
} from "./range-base.ts";

// SPEC §6.1 file naming `*.test.<ext>`; §6.3 `test_*.py`.
export function isPackTestFile(file: string): boolean {
	return (
		(isTsFile(file) && /\.test\.[^./]+$/.test(file)) ||
		(isPythonFile(file) && /(^|\/)test_[^/]*$/.test(file))
	);
}

const TS_ASSERTIONS = /\bassert[.(]|\bexpect\(|\.should\b/g;
const PY_ASSERTIONS = /\bassert\s|\bself\.assert|\bpytest\.raises\b/g;

function assertionCount(file: string, text: string): number {
	return isPythonFile(file)
		? countMatches(blankPythonCode(text), PY_ASSERTIONS)
		: countMatches(blankCode(text), TS_ASSERTIONS);
}

// SPEC §4.10.4 core/no-assertion-loss: the pack assertion-token count of a
// test file falls between base and head (EC-5: a move to another file
// counts as a fall).
export async function judgeAssertionLoss(args: RangeArgs): Promise<void> {
	await forEachBaseHead(
		args,
		(file) => notFixture(file) && isPackTestFile(file),
		(file, before, after) => {
			const was = assertionCount(file, before);
			const now = assertionCount(file, after);
			if (now < was) {
				flagRange(
					args,
					file,
					`assertion count falls in ${file}`,
					`${String(was)} -> ${String(now)}`,
				);
			}
		},
	);
}

const TS_SUPPRESSIONS =
	/eslint-disable|biome-ignore|oxlint-disable|@ts-ignore|@ts-expect-error|@ts-nocheck|istanbul ignore|c8 ignore|v8 ignore/g;
const PY_SUPPRESSIONS =
	/\bnoqa\b|type:\s*ignore|pyright:\s*ignore|pragma:\s*no cover|\bnosec\b/g;

// Comment text only: a char the comment blanking changed is comment text,
// so pattern sources and string vectors never read as suppressions.
function tsCommentText(text: string): string {
	const kept = blankComments(text);
	let out = "";
	for (let index = 0; index < text.length; index += 1) {
		const char = text.charAt(index);
		out += kept.charAt(index) === char && char !== "\n" ? " " : char;
	}
	return out;
}

// A Python comment starts at a `#` the lexer blanked while the char before
// it survived (a string blank run starts at its quote instead).
function pyCommentText(text: string): string {
	const blanked = blankPythonCode(text);
	let out = "";
	let comment = false;
	for (let index = 0; index < text.length; index += 1) {
		const char = text.charAt(index);
		if (char === "\n") {
			comment = false;
		} else if (
			!comment &&
			char === "#" &&
			blanked.charAt(index) === " " &&
			(index === 0 || blanked.charAt(index - 1) === text.charAt(index - 1))
		) {
			comment = true;
		}
		out += comment || char === "\n" ? char : " ";
	}
	return out;
}

export function commentText(file: string, text: string): string {
	return isPythonFile(file) ? pyCommentText(text) : tsCommentText(text);
}

function suppressionCount(file: string, text: string): number {
	return countMatches(
		commentText(file, text),
		isPythonFile(file) ? PY_SUPPRESSIONS : TS_SUPPRESSIONS,
	);
}

// SPEC §4.10.4 core/no-new-suppressions: a changed source file carries more
// pack suppression comments at head than at base.
export async function judgeNewSuppressions(args: RangeArgs): Promise<void> {
	await forEachBaseHead(
		args,
		(file) => notFixture(file) && (isTsFile(file) || isPythonFile(file)),
		(file, before, after) => {
			const was = suppressionCount(file, before);
			const now = suppressionCount(file, after);
			if (now > was) {
				flagRange(args, file, `new suppression in ${file}`);
			}
		},
	);
}

function isFixtureOrSnapshot(file: string): boolean {
	return (
		!notFixture(file) ||
		/(^|\/)__snapshots__\//.test(file) ||
		file.endsWith(".snap")
	);
}

// SPEC §4.10.4 core/no-fixture-shrink: a fixture or snapshot file loses
// more lines than it gains (EC-9).
export async function judgeFixtureShrink(args: RangeArgs): Promise<void> {
	await forEachBaseHead(args, isFixtureOrSnapshot, (file, before, after) => {
		const churn = lineChurn(before, after);
		if (before !== "" && churn.removed > churn.added) {
			flagRange(
				args,
				file,
				`fixture shrinks in ${file}`,
				`-${String(churn.removed)} +${String(churn.added)}`,
			);
		}
	});
}

// SPEC §6.1 measures: guard lines contain `throw `, `assert`, or `.parse(`.
const TS_GUARD = /\bthrow\s|\bassert|\.parse\(/;

// Base guard lines missing at head inside a function whose declaration
// line survives at head.
// One surviving function span: its guard lines no head line still matches,
// each matched head line consumed once.
function spanGuardsGone(
	rows: ReadonlyArray<number>,
	lines: ReadonlyArray<string>,
	blanked: ReadonlyArray<string>,
	pool: Map<string, number>,
): Array<string> {
	const gone: Array<string> = [];
	for (const row of rows.filter((at) => TS_GUARD.test(blanked[at] ?? ""))) {
		const text = (lines[row] ?? "").trim();
		const left = pool.get(text) ?? 0;
		if (left > 0) {
			pool.set(text, left - 1);
		} else {
			gone.push(text);
		}
	}
	return gone;
}

function removedGuards(before: string, after: string): Array<string> {
	const lines = before.split("\n");
	const blanked = blankCode(before).split("\n");
	const pool = new Map<string, number>();
	for (const line of after.split("\n")) {
		pool.set(line.trim(), (pool.get(line.trim()) ?? 0) + 1);
	}
	const seen = new Set<number>();
	const removed: Array<string> = [];
	for (const span of measureFunctionSpans(before)) {
		if (!pool.has((lines[span.line - 1] ?? "").trim())) {
			continue;
		}
		const rows = Array.from(
			{ length: Math.max(0, span.lines - 1) },
			(_, at) => span.line + at,
		).filter((row) => !seen.has(row));
		for (const row of rows) {
			seen.add(row);
		}
		removed.push(...spanGuardsGone(rows, lines, blanked, pool));
	}
	return removed;
}

// SPEC §5 core/no-guard-removal: a deleted throw, validation or assert line
// in a function that remains.
export async function judgeGuardRemoval(args: RangeArgs): Promise<void> {
	await forEachBaseHead(
		args,
		(file) => notFixture(file) && isTsFile(file),
		(file, before, after) => {
			const gone = removedGuards(before, after);
			if (gone.length > 0) {
				flagRange(
					args,
					file,
					`guard removed in ${file}: ${gone[0] ?? ""}`,
					gone[0],
				);
			}
		},
	);
}
