// Slice 0: unit pins for the consumer-harness result parsers. denyReason
// distinguishes the allow shape from harness denies; findingIds extracts
// rule ids from --json CLI replies. Both stay total on malformed input.
import { strict as assert } from "node:assert";
import test from "node:test";
import { denyReason } from "../support/consumer-harness.ts";
import { findingIds } from "../support/consumer-matrix.ts";

test("[consumer] denyReason passes the allow shape through", () => {
	assert.equal(denyReason("{}"), undefined);
	assert.equal(denyReason(""), undefined);
});

test("[consumer] denyReason surfaces the harness deny reason", () => {
	const reason = denyReason(
		JSON.stringify({
			hookSpecificOutput: {
				permissionDecision: "deny",
				permissionDecisionReason: "CDX-E604 blocked by core/x",
			},
		}),
	);
	assert.match(reason ?? "", /core\/x/);
});

test("[consumer] denyReason stays total on non-JSON output", () => {
	assert.equal(denyReason("boom"), "boom");
});

test("[consumer] findingIds extracts rule ids from a json reply", () => {
	const ids = findingIds(
		'noise\n{"findings": [{"ruleId": "core/a"}, {"ruleId": "core/b"}]}',
	);
	assert.deepEqual(ids, ["core/a", "core/b"]);
});

test("[consumer] findingIds stays empty without findings", () => {
	assert.deepEqual(findingIds("no json here"), []);
	assert.deepEqual(findingIds('{"ok": true}'), []);
});
