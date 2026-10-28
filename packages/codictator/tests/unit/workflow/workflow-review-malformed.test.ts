// SPEC §4.12.4 EC-14: a malformed review findings file answers CDX-E607 and
// the round is not recorded. The gate never throws, even on non-array findings.
import { strict as assert } from "node:assert";
import test from "node:test";
import type { CheckContext } from "../../../src/features/engine/index.ts";
import { checkReview } from "../../../src/features/workflow/index.ts";
import { FIXED_INSTANT } from "../../support/fake-clock.ts";

function ctxFor(): CheckContext {
	return {
		trigger: "pre-tool",
		scope: { files: ["src/a.ts"], sessionId: "session-1" },
		now: FIXED_INSTANT,
		configHash: "config-hash",
	};
}

test("[§4.12.4] review gate never throws on non-array findings", async () => {
	const ctx = ctxFor();
	for (const findings of ["nope", undefined, null, 42]) {
		const result = await checkReview(ctx, {
			version: 1,
			findings: findings as never,
		});
		assert.ok(
			result.some((finding) => finding.code === "CDX-E607"),
			`non-array findings (${String(findings)}) still report CDX-E607`,
		);
	}
});

test("[§4.12.4] review gate still reports open blockers for array findings", async () => {
	const result = await checkReview(ctxFor(), {
		version: 1,
		tree: "t",
		reviewerSession: "fresh",
		findings: [{ id: "F-1", severity: "blocker", path: "a", message: "m" }],
	});
	assert.ok(
		result.some((finding) => finding.message.includes("blocker/major")),
	);
});
