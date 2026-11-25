import { strict as assert } from "node:assert";

import test from "node:test";

import type { CheckContext } from "../../../src/features/engine/index.ts";

import { checkSelfProtection } from "../../../src/features/integrity/index.ts";

import { FIXED_INSTANT } from "../../support/fake-clock.ts";

function ctxFor(): CheckContext {
	return {
		trigger: "pre-tool",
		scope: { files: [], sessionId: "session-1" },
		now: FIXED_INSTANT,
		configHash: "config-hash",
	};
}

test("[§4.14.3] agent tool write of the round findings file is not tamper but other guardrail paths are", () => {
	// SPEC §4.14.3 Paths row: the round's findings file is the one
	// `.codictator/**` write the fresh reviewer makes.
	for (const path of [
		".codictator/reviews/T-0116-r1.json",
		".codictator/reviews/T-0116-r12.json",
	]) {
		assert.deepEqual(checkSelfProtection(ctxFor(), ["write", path]), []);
	}
	for (const path of [
		".codictator/tasks/T-0116.json",
		".codictator/reviews/T-0116-r0.json",
		".codictator/reviews/T-0116-r1.txt",
		".codictator/reviews/notes.json",
		".codictator/config.json",
		".githooks/pre-commit",
	]) {
		const findings = checkSelfProtection(ctxFor(), ["write", path]);
		assert.ok(
			findings.some((finding) => finding.ruleId === "core/no-bypass"),
			`${path} should stay protected`,
		);
	}
	// Deleting or moving the findings file stays tamper.
	const removed = checkSelfProtection(ctxFor(), [
		"rm",
		".codictator/reviews/T-0116-r1.json",
	]);
	assert.ok(removed.some((finding) => finding.ruleId === "core/no-bypass"));
});
