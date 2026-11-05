import { strict as assert } from "node:assert";

import test from "node:test";

import type { CheckContext } from "../../../src/features/engine/index.ts";

import {
	checkBugRegistry,
	checkBugs,
	checkDocs,
	checkHistory,
} from "../../../src/features/records/index.ts";

import { FIXED_INSTANT } from "../../support/fake-clock.ts";

function ctxFor(files: ReadonlyArray<string>): CheckContext {
	return {
		trigger: "post-tool",
		scope: { files, sessionId: "session-1" },
		now: FIXED_INSTANT,
		configHash: "config-hash",
	};
}

const BUG_BASE = `# Bugs — 2026

| Id | Status | Title | Found | Fix | Regression test |
|---|---|---|---|---|---|
| BUG-0001 | open | first defect | 2026-10-01, none |  |  |
| BUG-0002 | open | second defect | 2026-10-02, none |  |  |
`;

const ROLLOVER_ENTRY = `## 2026-11-02 · rollover entry
- **Kind:** docs
- **Task:** T-0002
- **Why:** new month file
- **Docs:** none
`;

const BUG_FIXED_BASE = `# Bugs — 2026

| Id | Status | Title | Found | Fix | Regression test |
|---|---|---|---|---|---|
| BUG-0001 | fixed | first defect | 2026-10-01, none | T-0001, fix it | tests/unit/fix.test.ts |
`;

const BUG_FIXED_HEAD = `# Bugs — 2026

| Id | Status | Title | Found | Fix | Regression test |
|---|---|---|---|---|---|
| BUG-0001 | open | first defect | 2026-10-01, none |  |  |
`;

test("[§4.9 EC-11] amended subject after entry is caught", async () => {
	// SPEC §4.9.5 EC-11: L3 compares at commit-msg time.
	const findings = await checkHistory(
		ctxFor(["docs/HISTORY/2026-10-05.md"]),
		"Subject: amended\n",
	);
	assert.ok(findings.length > 0);
});

test("[§4.9 EC-12] fix naming missing bug row blocks", async () => {
	// SPEC §4.9.5 EC-12: block on unknown BUG-0999.
	const findings = checkBugRegistry(
		{ type: "fix", bug: "BUG-0999", diagnosis: "reproduced locally" },
		[],
		() => true,
		"docs/BUGS/2026.md",
	);
	assert.ok(findings.some((finding) => finding.ruleId === "core/bug-registry"));
});

test("[§4.9 EC-13] deleted bug row blocks immutable", async () => {
	// SPEC §4.9.5 EC-13: block core/bug-rows-immutable.
	const head = `# Bugs — 2026

| Id | Status | Title | Found | Fix | Regression test |
|---|---|---|---|---|---|
| BUG-0001 | open | first defect | 2026-10-01, none |  |  |
`;
	const findings = await checkBugs(
		ctxFor(["docs/BUGS/2026.md"]),
		head,
		BUG_BASE,
	);
	assert.ok(
		findings.some((finding) => finding.ruleId === "core/bug-rows-immutable"),
	);
});

test("[§4.9 EC-14] day rollover opens a new file", async () => {
	// SPEC §4.9.5 EC-14: new day file; old file untouched.
	const findings = await checkHistory(
		ctxFor(["docs/HISTORY/2026-11-02.md"]),
		ROLLOVER_ENTRY,
	);
	assert.equal(findings.length, 0);
});

test("[§4.9 EC-15] CRLF history passes suffix/prepend check", async () => {
	// SPEC §4.9.5 EC-15: normalised text passes when only endings differ.
	const findings = await checkHistory(
		ctxFor(["docs/HISTORY/2026-11-02.md"]),
		ROLLOVER_ENTRY.replace(/\n/g, "\r\n"),
	);
	assert.equal(findings.length, 0);
});

test("[§4.9 EC-16] squash landing three entries blocks", async () => {
	// SPEC §4.9.5 EC-16: one commit one entry; branch protection already blocked squash.
	const findings = await checkHistory(
		ctxFor(["docs/HISTORY/2026-10-05.md"]),
		"three entries",
	);
	assert.ok(findings.length > 0);
});

test("[§4.9 EC-17] license readme history entry is docs kind", async () => {
	// SPEC §4.9.5 EC-17: Kind docs; Docs lists LICENSE and README.md.
	const findings = await checkHistory(
		ctxFor(["LICENSE", "README.md", "docs/HISTORY/2026-10-06.md"]),
		`## 2026-10-06 · license entry
- **Kind:** docs
- **Task:** T-0003
- **Why:** license text
- **Docs:** LICENSE, README.md
`,
	);
	assert.equal(findings.length, 0);
});

test("[§4.9 EC-18] gitignore plus source is code kind", async () => {
	// SPEC §4.9.5 EC-18: mixed docs and code gives code.
	const findings = await checkHistory(
		ctxFor([".gitignore", "src/a.ts", "docs/HISTORY/2026-10-07.md"]),
		`## 2026-10-07 · ignore entry
- **Kind:** code
- **Task:** T-0004
- **Why:** ignore noise
- **What went wrong:** none
- **Trade-offs:** none kept
- **Lessons:** none yet
`,
	);
	assert.equal(findings.length, 0);
});

test("[§4.9 EC-19] lone open bug row is docs kind none", async () => {
	// SPEC §4.9.5 EC-19: Kind docs, Docs none.
	const findings = await checkHistory(
		ctxFor(["docs/BUGS/2026.md", "docs/HISTORY/2026-10-08.md"]),
		`## 2026-10-08 · registry entry
- **Kind:** docs
- **Task:** T-0005
- **Why:** registry row
- **Docs:** none
`,
	);
	assert.equal(findings.length, 0);
});

test("[§4.9 EC-20] fixed back to open blocks immutable", async () => {
	// SPEC §4.9.5 EC-20: block core/bug-rows-immutable.
	const findings = await checkBugs(
		ctxFor(["docs/BUGS/2026.md"]),
		BUG_FIXED_HEAD,
		BUG_FIXED_BASE,
	);
	assert.ok(
		findings.some((finding) => finding.ruleId === "core/bug-rows-immutable"),
	);
});

test("[§4.9 EC-21] top-level history file placement blocks", async () => {
	// SPEC §4.9.5 EC-21: block core/doc-placement.
	const findings = await checkDocs(ctxFor(["docs/HISTORY.md"]), [
		"docs/HISTORY.md",
	]);
	assert.ok(
		findings.some((finding) => finding.ruleId === "core/doc-placement"),
	);
});
