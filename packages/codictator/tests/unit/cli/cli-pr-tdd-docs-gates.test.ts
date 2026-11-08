// BUG-0064: PRs and local commits no longer block on missing TDD
// red-proof and docs history entry. The PR verify leg no-ops (SPEC §4.15
// EC-12), the L3 commit path only appends a trailer, and the red-proof
// re-run plus history-entry checks have no caller on the gate paths.
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";
import { renderWorkflow } from "../../../src/features/ci/index.ts";

function cliSource(name: string): string {
	return readFileSync(
		new URL(`../../../src/cli/${name}`, import.meta.url),
		"utf8",
	);
}

test("[§4.15 EC-12] PR verify evaluates the gate instead of reporting SUCCESS through the no-op", () => {
	// A PR with no tests and no history entry must not get verify SUCCESS.
	const text = renderWorkflow("/repo", { repoName: "app" }).text ?? "";
	assert.ok(
		!text.includes("PR dedup no-op"),
		"verify still no-ops on pull_request",
	);
});

test("[§4.10.2] ci verify re-runs red proofs over the PR range", () => {
	// L4 owes a re-run of every declared test at its red-proof commit.
	assert.ok(
		cliSource("ci.ts").includes("checkRedProofReRun"),
		"ci verify never re-runs red proofs",
	);
});

test("[§4.9] commit path judges the history entry instead of only appending the trailer", () => {
	// L3 owes a history-entry verdict before the commit lands (judged via
	// the git-history scope helper and the added-entry count checker).
	const hook = cliSource("git-hook.ts");
	assert.ok(
		hook.includes("checkStagedHistory") ||
			hook.includes("checkAddedHistoryEntryCount") ||
			hook.includes("checkHistory"),
		"commit path never judges the history entry",
	);
});
