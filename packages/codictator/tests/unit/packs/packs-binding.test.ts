// SPEC §4.4.3 step 4 + §4.3.3 step 1: the binding keeps the rule's own
// triggers, scope and tunable defaults. A rule with absent triggers, scope
// or params binds to an inert empty binding instead of throwing.
import { strict as assert } from "node:assert";
import test from "node:test";
import { bindRule } from "../../../src/features/packs/enforcers/binding.ts";
import type { PackRule } from "../../../src/kernel/index.ts";

function ruleFor(over: Partial<PackRule> = {}): PackRule {
	return {
		id: "test/rule",
		family: "test",
		tier: "standard",
		statement: "a rule",
		reason: "testing",
		remediation: "fix it",
		enforcer: "pattern-forbid",
		triggers: ["pre-tool"],
		scope: ["src/**"],
		params: {},
		measureVersion: 1,
		fixtures: { violating: [], passing: [] },
		...over,
	};
}

test("[§4.4.3] rule binding keeps triggers scope and tunable defaults", () => {
	const binding = bindRule(
		ruleFor({
			params: {
				maxLines: { type: "integer", default: 10, bound: 5, stricter: "lower" },
			},
		}),
	);
	assert.deepEqual([...binding.triggers], ["pre-tool"]);
	assert.deepEqual([...binding.scopeGlobs], ["src/**"]);
	const { maxLines } = binding.tunables;
	assert.equal(maxLines, 10);
});

test("[§4.4.3] rule binding treats absent triggers scope and params as empty", () => {
	const binding = bindRule({
		id: "test/broken",
		remediation: "fix it",
	} as unknown as PackRule);
	assert.deepEqual([...binding.triggers], []);
	assert.deepEqual([...binding.scopeGlobs], []);
	assert.deepEqual({ ...binding.tunables }, {});
});
