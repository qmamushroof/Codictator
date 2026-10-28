// SPEC §4.9.3 + §7.7: history entries, completeness per kind, append-only
// and kind derivation; plus the records doc-guard branches (placement with
// allowed globs, one-level, size, breadth, density, links, changelog,
// corpus counts, single owner, and the evaluation-path entries).
import { strict as assert } from "node:assert";
import test from "node:test";
import { checkDocs } from "../../../src/features/records/docs.ts";
import {
	checkDocBreadth,
	checkDocDensity,
	checkDocLinksValid,
	checkDocNoCorpusCounts,
	checkDocNoInlineChangelog,
	checkDocOneLevel,
	checkDocPlacement,
	checkDocSingleOwner,
	checkDocSize,
	checkHistoryAppendOnly,
	checkHistoryEntryComplete,
	checkHistoryEntryCount,
	checkHistoryFiles,
	deriveHistoryKind,
	parseHistoryEntries,
} from "../../../src/features/records/index.ts";
import { FIXED_INSTANT } from "../../support/fake-clock.ts";

const ENTRY =
	"## 2026-10-05 · feature: do a thing\n\n- **Kind:** code\n- **Task:** T-0001\n- **Why:** reason\n- **What went wrong:** none\n- **Trade-offs:** none\n- **Lessons:** learned\n";
const TITLE = "# History — 2026-10\n\n";

test("[§4.9] history parses entries and flags grammar breaks", () => {
	const parsed = parseHistoryEntries(`${TITLE}${ENTRY}`);
	assert.equal(parsed.entries.length, 1);
	assert.deepEqual(parsed.errors, []);
	assert.equal(parsed.entries[0]?.kind, "code");
	assert.ok(
		parseHistoryEntries("junk\n## 2026-10-05 · s\n- **Kind:** code\n").errors
			.length > 0,
	);
	assert.ok(
		parseHistoryEntries(`${TITLE}${ENTRY}## 2026-10-06 · other\n`).entries
			.length === 2,
	);
	assert.ok(
		parseHistoryEntries(
			`${TITLE}## 2026-10-05 · s\n- **Deps:** x\n- **Deps:** y\n- **Kind:** docs\n`,
		).entries.length === 1,
	);
});

test("[§4.9] history entry count wants exactly one with the subject", () => {
	assert.ok(checkHistoryEntryCount(`${TITLE}${ENTRY}${ENTRY}`, "p").length > 0);
	assert.ok(
		checkHistoryEntryCount(`${TITLE}${ENTRY}`, "p", "other subject").length > 0,
	);
	assert.deepEqual(
		checkHistoryEntryCount(`${TITLE}${ENTRY}`, "p", "feature: do a thing"),
		[],
	);
});

test("[§4.9] history completeness follows the entry kind", () => {
	const parsed = parseHistoryEntries(`${TITLE}${ENTRY}`);
	const entry = parsed.entries[0];
	assert.ok(entry !== undefined);
	if (entry !== undefined) {
		assert.deepEqual(checkHistoryEntryComplete(entry, "p"), []);
		assert.ok(
			checkHistoryEntryComplete({ ...entry, fields: new Map() }, "p").length >
				0,
		);
		assert.ok(
			checkHistoryEntryComplete(
				{ ...entry, kind: "deps", depsLines: [] },
				"p",
			).some((finding) => finding.message.includes("no Deps line")),
		);
		assert.deepEqual(
			checkHistoryEntryComplete(
				{ ...entry, kind: "deps", depsLines: ["x"] },
				"p",
			),
			[],
		);
	}
});

test("[§4.9] history append-only keeps base as prefix", () => {
	assert.deepEqual(checkHistoryAppendOnly("ab", "abc", "p"), []);
	const edited = checkHistoryAppendOnly("ab", "ax", "p");
	assert.ok(
		edited.some((finding) => finding.ruleId === "core/history-append-only"),
	);
});

test("[§4.9] history kind derives from the changed paths", () => {
	assert.equal(deriveHistoryKind([]), "docs");
	assert.equal(deriveHistoryKind(["docs/HISTORY/2026-10.md"]), "docs");
	assert.equal(
		deriveHistoryKind(["package.json", "package-lock.json"]),
		"deps",
	);
	assert.equal(deriveHistoryKind(["docs/a.md"]), "docs");
	assert.equal(deriveHistoryKind(["src/a.ts"]), "code");
	assert.equal(deriveHistoryKind(["docs/a.md", "src/a.ts"]), "code");
	assert.equal(
		deriveHistoryKind(["src/a.ts"], new Set(["src/a.ts"])),
		"guardrail",
	);
	assert.equal(deriveHistoryKind(["LICENSE"]), "docs");
	const files = checkHistoryFiles([], `${TITLE}${ENTRY}`);
	assert.ok(
		files.some((finding) => finding.message.includes("no history entry")),
	);
	const bad = checkHistoryFiles(
		["docs/HISTORY/2026-10.md"],
		"nothing",
		"base",
		"s",
	);
	assert.ok(bad.length > 0);
	const appended = checkHistoryFiles(
		["docs/HISTORY/2026-10.md"],
		`${TITLE}${ENTRY}`,
		`${TITLE}`,
		"feature: do a thing",
	);
	assert.deepEqual(appended, []);
});

test("[§4.9] docs placement honours globs roots and harness dirs", () => {
	assert.deepEqual(
		checkDocPlacement(
			["packages/codictator/fixtures/x/README.md"],
			["**/fixtures/**"],
		),
		[],
	);
	const flagged = checkDocPlacement([
		"packages/codictator/fixtures/x/README.md",
	]);
	assert.ok(flagged.some((finding) => finding.ruleId === "core/doc-placement"));
	assert.deepEqual(
		checkDocPlacement(["README.md", "docs/a.md", "packages/x/README.md"]),
		[],
	);
	assert.deepEqual(
		checkDocPlacement([".agents/notes.md", ".codictator/x.md"]),
		[],
	);
	assert.ok(
		checkDocPlacement(["docs/HISTORY.md"]).some(
			(finding) => finding.path === "docs/HISTORY.md",
		),
	);
	assert.ok(checkDocPlacement(["stray.md"]).length > 0);
	assert.ok(
		checkDocOneLevel(["docs/a/b/c.md"]).some(
			(finding) => finding.ruleId === "core/doc-one-level",
		),
	);
	assert.deepEqual(
		checkDocOneLevel(["docs/HISTORY/2026.md", "docs/a/b.md"]),
		[],
	);
});

test("[§4.9] docs size breadth and density flag over-limit files", () => {
	const big = checkDocSize([
		{ path: "docs/a.md", text: `${"x".repeat(40001)}` },
	]);
	assert.ok(big.some((finding) => finding.message.includes("byte limit")));
	const long = checkDocSize([
		{ path: "docs/a.md", text: `${"l\n".repeat(501)}` },
	]);
	assert.ok(long.some((finding) => finding.message.includes("line limit")));
	assert.deepEqual(checkDocSize([{ path: "docs/a.md", text: "short" }]), []);
	const wide = checkDocBreadth([
		{ path: "docs/a.md", text: `${"## h\n".repeat(16)}` },
	]);
	assert.ok(wide.some((finding) => finding.message.includes("heading limit")));
	const crowded = checkDocBreadth([], { docs: 41 });
	assert.ok(crowded.some((finding) => finding.message.includes("file limit")));
	assert.deepEqual(checkDocBreadth([{ path: "docs/a.md", text: "# t\n" }]), []);
	const dense = checkDocDensity([
		{ path: "docs/a.md", text: "One. Two. Three. Four. Five. Six. Seven." },
	]);
	assert.ok(
		dense.some((finding) => finding.message.includes("sentence limit")),
	);
	const wordy = checkDocDensity([
		{ path: "docs/a.md", text: `${"word ".repeat(41)}done.` },
	]);
	assert.ok(wordy.some((finding) => finding.message.includes("word limit")));
});

test("[§4.9] docs links changelog corpus and owner checks hold", async () => {
	const known = new Map([
		["docs/a.md", "# Title\n"],
		["LICENSE", "text"],
	]);
	assert.deepEqual(
		checkDocLinksValid(
			[{ path: "docs/a.md", text: "# Title\n\nsee [t](#title)" }],
			known,
		),
		[],
	);
	assert.ok(
		checkDocLinksValid(
			[{ path: "docs/a.md", text: "see [x](./missing.md)" }],
			known,
		).length > 0,
	);
	assert.ok(
		checkDocLinksValid([{ path: "docs/a.md", text: "see [x](#nope)" }], known)
			.length > 0,
	);
	assert.ok(
		checkDocNoInlineChangelog([
			{ path: "docs/a.md", text: "# Changelog\n" },
		]).some((finding) => finding.ruleId === "core/doc-no-inline-changelog"),
	);
	assert.ok(
		checkDocNoInlineChangelog([
			{ path: "docs/a.md", text: "- updated 2026-10-01\n" },
		]).length > 0,
	);
	assert.ok(
		checkDocNoCorpusCounts([
			{
				path: "docs/a.md",
				text: "The repository has 42 rules in place today.",
			},
		]).length > 0,
	);
	const dup =
		"This sentence about one fact with its owner is long enough here.";
	const owned = checkDocSingleOwner([
		{ path: "docs/a.md", text: `${dup} More text follows along.` },
		{ path: "docs/b.md", text: `Other intro words. ${dup} Trailing words.` },
	]);
	assert.ok(
		owned.some((finding) => finding.ruleId === "core/doc-single-owner"),
	);
	assert.deepEqual(
		await checkDocs(
			{
				trigger: "pre-tool",
				scope: { files: [] },
				now: FIXED_INSTANT,
				configHash: "test",
			},
			[],
		),
		[],
	);
});
