// SPEC §4.9.5: one red test per records EC row. Doc rows assert checkDocs;
// history rows assert checkHistory; registry rows assert checkBugs. All three
// still throw "not implemented", so all twenty-one fail red until Phase 7 lands.
import { strict as assert } from "node:assert";
import test from "node:test";
import type { CheckContext } from "../../../src/features/engine/index.ts";
import {
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

test("[§4.9 EC-1] router holding a paragraph blocks", async () => {
	// SPEC §4.9.5 EC-1: block core/doc-router-leaf.
	const findings = await checkDocs(ctxFor(["docs/SPEC.md"]), ["docs/SPEC.md"]);
	assert.ok(
		findings.some((finding) => finding.ruleId === "core/doc-router-leaf"),
	);
});

test("[§4.9 EC-2] leaf missing from router blocks", async () => {
	// SPEC §4.9.5 EC-2: block; linked twice also blocks.
	const findings = await checkDocs(ctxFor(["docs/SPEC/04-09-RECORDS.md"]), [
		"docs/SPEC/04-09-RECORDS.md",
	]);
	assert.ok(findings.length > 0);
});

test("[§4.9 EC-3] nav line pointing at wrong next leaf", async () => {
	// SPEC §4.9.5 EC-3: block with the expected nav line as remediation.
	const findings = await checkDocs(ctxFor(["docs/SPEC/04-09-RECORDS.md"]), [
		"docs/SPEC/04-09-RECORDS.md",
	]);
	assert.ok(findings.some((finding) => finding.remediation.length > 0));
});

test("[§4.9 EC-4] nested folder under a leaf blocks", async () => {
	// SPEC §4.9.5 EC-4: block core/doc-one-level.
	const findings = await checkDocs(ctxFor(["docs/SPEC/sub/x.md"]), [
		"docs/SPEC/sub/x.md",
	]);
	assert.ok(
		findings.some((finding) => finding.ruleId === "core/doc-one-level"),
	);
});

test("[§4.9 EC-5] link anchor with wrong slug blocks", async () => {
	// SPEC §4.9.5 EC-5: remediation gives the correct slug.
	const findings = await checkDocs(ctxFor(["docs/SPEC/04-09-RECORDS.md"]), [
		"docs/SPEC/04-09-RECORDS.md",
	]);
	assert.ok(
		findings.some((finding) => finding.ruleId === "core/doc-links-valid"),
	);
});

test("[§4.9 EC-6] sentence with e dot g mid-sentence", async () => {
	// SPEC §4.9.5 EC-6: not split at e.g.
	const findings = await checkDocs(ctxFor(["docs/guide.md"]), [
		"docs/guide.md",
	]);
	assert.equal(findings.length, 0);
});

test("[§4.9 EC-7] long sentence inside a table cell ignored", async () => {
	// SPEC §4.9.5 EC-7: table cells are not counted.
	const findings = await checkDocs(ctxFor(["docs/guide.md"]), [
		"docs/guide.md",
	]);
	assert.equal(findings.length, 0);
});

test("[§4.9 EC-8] history entry edited after commit blocks", async () => {
	// SPEC §4.9.5 EC-8: block core/history-append-only.
	const findings = await checkHistory(
		ctxFor(["docs/HISTORY/2026-10.md"]),
		"Subject: x\n",
	);
	assert.ok(
		findings.some((finding) => finding.ruleId === "core/history-append-only"),
	);
});

test("[§4.9 EC-9] commit with no history entry blocks", async () => {
	// SPEC §4.9.5 EC-9: L3 blocks; bypassed L4 blocks the PR.
	const findings = await checkHistory(ctxFor(["src/a.ts"]), "");
	assert.ok(
		findings.some((finding) => finding.ruleId === "core/history-entry"),
	);
});

test("[§4.9 EC-10] two entries in one commit blocks", async () => {
	// SPEC §4.9.5 EC-10: one commit, one entry.
	const findings = await checkHistory(
		ctxFor(["docs/HISTORY/2026-10.md"]),
		"two entries",
	);
	assert.ok(findings.length > 0);
});

test("[§4.9 EC-11] amended subject after entry is caught", async () => {
	// SPEC §4.9.5 EC-11: L3 compares at commit-msg time.
	const findings = await checkHistory(
		ctxFor(["docs/HISTORY/2026-10.md"]),
		"Subject: amended\n",
	);
	assert.ok(findings.length > 0);
});

test("[§4.9 EC-12] fix naming missing bug row blocks", async () => {
	// SPEC §4.9.5 EC-12: block on unknown BUG-0999.
	const findings = await checkBugs(ctxFor(["docs/BUGS/2026.md"]), "BUG-0999");
	assert.ok(findings.some((finding) => finding.ruleId === "core/bug-registry"));
});

test("[§4.9 EC-13] deleted bug row blocks immutable", async () => {
	// SPEC §4.9.5 EC-13: block core/bug-rows-immutable.
	const findings = await checkBugs(
		ctxFor(["docs/BUGS/2026.md"]),
		"deleted row",
	);
	assert.ok(
		findings.some((finding) => finding.ruleId === "core/bug-rows-immutable"),
	);
});

test("[§4.9 EC-14] month rollover opens a new file", async () => {
	// SPEC §4.9.5 EC-14: new month file; old file untouched.
	const findings = await checkHistory(
		ctxFor(["docs/HISTORY/2026-11.md"]),
		"Subject: rollover\n",
	);
	assert.equal(findings.length, 0);
});

test("[§4.9 EC-15] CRLF history passes prefix check", async () => {
	// SPEC §4.9.5 EC-15: normalised text passes when only endings differ.
	const findings = await checkHistory(
		ctxFor(["docs/HISTORY/2026-10.md"]),
		"Subject: crlf\r\n",
	);
	assert.equal(findings.length, 0);
});

test("[§4.9 EC-16] squash landing three entries blocks", async () => {
	// SPEC §4.9.5 EC-16: one commit one entry; branch protection already blocked squash.
	const findings = await checkHistory(
		ctxFor(["docs/HISTORY/2026-10.md"]),
		"three entries",
	);
	assert.ok(findings.length > 0);
});

test("[§4.9 EC-17] license readme history entry is docs kind", async () => {
	// SPEC §4.9.5 EC-17: Kind docs; Docs lists LICENSE and README.md.
	const findings = await checkHistory(
		ctxFor(["LICENSE", "README.md"]),
		"Kind: docs\n",
	);
	assert.equal(findings.length, 0);
});

test("[§4.9 EC-18] gitignore plus source is code kind", async () => {
	// SPEC §4.9.5 EC-18: mixed docs and code gives code.
	const findings = await checkHistory(
		ctxFor([".gitignore", "src/a.ts"]),
		"Kind: code\n",
	);
	assert.equal(findings.length, 0);
});

test("[§4.9 EC-19] lone open bug row is docs kind none", async () => {
	// SPEC §4.9.5 EC-19: Kind docs, Docs none.
	const findings = await checkHistory(
		ctxFor(["docs/BUGS/2026.md"]),
		"Kind: docs\n",
	);
	assert.equal(findings.length, 0);
});

test("[§4.9 EC-20] fixed back to open blocks immutable", async () => {
	// SPEC §4.9.5 EC-20: block core/bug-rows-immutable.
	const findings = await checkBugs(
		ctxFor(["docs/BUGS/2026.md"]),
		"fixed to open",
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
