// SPEC §4.3.3: session.start is advisory, so a rule finding from the
// startup trigger advises; an engine-synthesised fail-closed finding
// (CDX-E9xx) still blocks (BUG-0106).
import { strict as assert } from "node:assert";
import test from "node:test";
import { createEngine } from "../../../src/features/engine/index.ts";
import { FIXED_INSTANT } from "../../support/fake-clock.ts";

function engineFinding(code?: string) {
	return createEngine([
		{
			id: "core/hooks-active",
			kinds: ["startup"],
			budgetMs: 1000,
			check: async () => [
				{
					ruleId: "core/hooks-active",
					...(code === undefined ? {} : { code }),
					message: "hooks reset",
					remediation: "reinstall",
				},
			],
		},
	]);
}

test("[§4.3.3] a session.start rule finding advises and never blocks", async () => {
	const verdict = await engineFinding().evaluate(
		"startup",
		{ files: [] },
		FIXED_INSTANT,
	);
	assert.equal(verdict.decision, "advise");
	assert.ok(verdict.message.includes("core/hooks-active"));
});

test("[§4.3.3] a session.start finding that is an enforcer failure still blocks", async () => {
	const verdict = await engineFinding("CDX-E901").evaluate(
		"startup",
		{ files: [] },
		FIXED_INSTANT,
	);
	assert.equal(verdict.decision, "block");
});
