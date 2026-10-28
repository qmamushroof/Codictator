// SPEC §4.9.4 + §7.7: bug registry grammar, the fix-names-a-row rule and the
// rows-immutable check. Pure over caller-supplied text; revisions arrive
// from the Git port at the enforcer layer, never from here.
import { strict as assert } from "node:assert";
import test from "node:test";
import type { BugRow } from "../../../src/features/records/index.ts";
import {
	checkBugRegistry,
	checkBugRowsImmutable,
	checkDiagnoseBeforeFix,
	parseBugFile,
} from "../../../src/features/records/index.ts";

const HEAD =
	"# Bugs — 2026\n\n| Id | Status | Title | Found | Fix | Regression test |\n|---|---|---|---|---|---|";
const OPEN = "| BUG-0001 | open | first defect | 2026-10-01, T-0001 |  |  |";
const FIXED =
	"| BUG-0002 | fixed | second defect | 2026-10-02, none | T-0002, fix it | tests/unit/x.test.ts |";
const WONT =
	"| BUG-0003 | wontfix | third defect | 2026-10-03, T-0003 | no longer reproducible after the refactor landed |  |";

function rowFor(over: Partial<BugRow> = {}): BugRow {
	return {
		id: "BUG-0001",
		status: "open",
		title: "first defect",
		found: "2026-10-01, T-0001",
		fix: "",
		regressionTest: "",
		...over,
	};
}

test("[§4.9] bugs file parses rows in id order", () => {
	const parsed = parseBugFile(`${HEAD}\n${OPEN}\n${FIXED}\n${WONT}`);
	assert.deepEqual(parsed.errors, []);
	assert.equal(parsed.file?.year, "2026");
	assert.equal(parsed.file?.rows.length, 3);
	assert.equal(parsed.file?.rows[1]?.status, "fixed");
});

test("[§4.9] bugs file grammar rejects bad titles and rows", () => {
	assert.ok(parseBugFile("no title").errors.length > 0);
	assert.ok(parseBugFile("# Bugs — 2026\ntext\n").errors.length > 0);
	assert.ok(
		parseBugFile("# Bugs — 2026\n\n| Id | wrong |\n|---|---|---|---|---|---|")
			.errors.length > 0,
	);
	assert.ok(
		parseBugFile(`${HEAD}\n| BUG-1 | open | t | 2026-10-01, T-0001 |  |  |`)
			.errors.length > 0,
	);
	assert.ok(
		parseBugFile(
			`${HEAD}\n| BUG-0001 | broken | t | 2026-10-01, T-0001 |  |  |`,
		).errors.length > 0,
	);
	assert.ok(
		parseBugFile(`${HEAD}\n| BUG-0001 | open | t | yesterday |  |  |`).errors
			.length > 0,
	);
	assert.ok(
		parseBugFile(
			`${HEAD}\n| BUG-0001 | open | t | 2026-10-01, T-0001 | x | y |`,
		).errors.length > 0,
	);
	assert.ok(
		parseBugFile(`${HEAD}\n| BUG-0001 | fixed | t | 2026-10-01, T-0001 |  |  |`)
			.errors.length > 0,
	);
	assert.ok(
		parseBugFile(
			`${HEAD}\n| BUG-0001 | fixed | t | 2026-10-01, T-0001 | T-1, s |  |`,
		).errors.length > 0,
	);
	assert.ok(
		parseBugFile(
			`${HEAD}\n| BUG-0001 | wontfix | t | 2026-10-01, T-0001 | short |  |`,
		).errors.length > 0,
	);
	assert.ok(parseBugFile(`${HEAD}\n${OPEN}\nnot a row`).errors.length > 0);
	assert.ok(parseBugFile(`${HEAD}\n${FIXED}\n${OPEN}`).errors.length > 0);
});

test("[§4.9] bugs registry names a fixed row with a test", () => {
	assert.deepEqual(
		checkBugRegistry(
			{ type: "feature", bug: undefined, diagnosis: undefined },
			[],
			() => true,
			"p",
		),
		[],
	);
	const noBug = checkBugRegistry(
		{ type: "fix", bug: undefined, diagnosis: undefined },
		[],
		() => true,
		"p",
	);
	assert.ok(noBug.some((finding) => finding.ruleId === "core/bug-registry"));
	const unknown = checkBugRegistry(
		{ type: "fix", bug: "BUG-0099", diagnosis: "d" },
		[],
		() => true,
		"p",
	);
	assert.ok(
		unknown.some((finding) => finding.message.includes("unknown bug row")),
	);
	const rows = [
		rowFor(),
		rowFor({
			id: "BUG-0002",
			status: "fixed",
			fix: "T-2, s",
			regressionTest: "t",
		}),
	];
	const openRow = checkBugRegistry(
		{ type: "fix", bug: "BUG-0001", diagnosis: "d" },
		rows,
		() => true,
		"p",
	);
	assert.ok(openRow.some((finding) => finding.message.includes("want fixed")));
	const missingTest = checkBugRegistry(
		{ type: "fix", bug: "BUG-0002", diagnosis: "d" },
		rows,
		() => false,
		"p",
	);
	assert.ok(
		missingTest.some((finding) =>
			finding.message.includes("missing regression test"),
		),
	);
	assert.deepEqual(
		checkBugRegistry(
			{ type: "fix", bug: "BUG-0002", diagnosis: "d" },
			rows,
			() => true,
			"p",
		),
		[],
	);
});

test("[§4.9] bugs immutability allows only open to fixed or wontfix", () => {
	const base = [
		rowFor(),
		rowFor({ id: "BUG-0002", fix: "", regressionTest: "", status: "open" }),
	];
	assert.deepEqual(checkBugRowsImmutable(base, base, "p"), []);
	const addedOpen = checkBugRowsImmutable(
		base,
		[...base, rowFor({ id: "BUG-0004" })],
		"p",
	);
	assert.deepEqual(addedOpen, []);
	const addedFixed = checkBugRowsImmutable(
		base,
		[...base, rowFor({ id: "BUG-0004", status: "fixed" })],
		"p",
	);
	assert.ok(
		addedFixed.some((finding) => finding.message.includes("added as fixed")),
	);
	const fixed = checkBugRowsImmutable(
		base,
		[
			rowFor({
				status: "fixed",
				fix: "T-1, did it",
				regressionTest: "t.test.ts",
			}),
			base[1] ?? rowFor(),
		],
		"p",
	);
	assert.deepEqual(fixed, []);
	const silentEdit = checkBugRowsImmutable(
		base,
		[rowFor({ title: "changed" }), base[1] ?? rowFor()],
		"p",
	);
	assert.ok(
		silentEdit.some((finding) => finding.message.includes("immutable cells")),
	);
	const drift = checkBugRowsImmutable(
		base,
		[rowFor({ fix: "x" }), base[1] ?? rowFor()],
		"p",
	);
	assert.ok(
		drift.some((finding) =>
			finding.message.includes("without a status transition"),
		),
	);
	const backwards = checkBugRowsImmutable(
		[rowFor({ status: "fixed", fix: "T-1, s", regressionTest: "t" })],
		[rowFor({ status: "open" })],
		"p",
	);
	assert.ok(
		backwards.some((finding) =>
			finding.message.includes("only open rows transition"),
		),
	);
	const badTarget = checkBugRowsImmutable(
		base,
		[rowFor({ status: "open" }), base[1] ?? rowFor()],
		"p",
	);
	assert.deepEqual(badTarget, []);
	const noFixCell = checkBugRowsImmutable(
		base,
		[rowFor({ status: "fixed", regressionTest: "t" }), base[1] ?? rowFor()],
		"p",
	);
	assert.ok(
		noFixCell.some((finding) =>
			finding.message.includes("without its Fix cell"),
		),
	);
	const noRegression = checkBugRowsImmutable(
		base,
		[rowFor({ status: "fixed", fix: "T-1, s" }), base[1] ?? rowFor()],
		"p",
	);
	assert.ok(
		noRegression.some((finding) =>
			finding.message.includes("without its regression test"),
		),
	);
	const gone = checkBugRowsImmutable(base, [base[0] ?? rowFor()], "p");
	assert.ok(gone.some((finding) => finding.message.includes("disappears")));
});

test("[§4.9] bugs diagnose-before-fix needs a record", () => {
	assert.deepEqual(
		checkDiagnoseBeforeFix(
			{ type: "feature", bug: undefined, diagnosis: undefined },
			"p",
		),
		[],
	);
	assert.deepEqual(
		checkDiagnoseBeforeFix(
			{ type: "fix", bug: "BUG-1", diagnosis: "root cause" },
			"p",
		),
		[],
	);
	const missing = checkDiagnoseBeforeFix(
		{ type: "fix", bug: "BUG-1", diagnosis: "  " },
		"p",
	);
	assert.ok(
		missing.some((finding) => finding.ruleId === "core/diagnose-before-fix"),
	);
});
