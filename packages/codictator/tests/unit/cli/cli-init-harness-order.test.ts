// SPEC §4.19.2 and PRD §12 #30: init lists every harness alphabetically and
// puts none first.
import { strict as assert } from "node:assert";
import test from "node:test";
import { defaultHarnesses } from "../../../src/cli/init-plan.ts";

test("[§4.19.2] the default harness list is alphabetical", () => {
	const listed = defaultHarnesses({
		harnesses: [],
		profile: "",
		packs: [],
		tools: [],
		repair: false,
	});
	assert.deepEqual(listed, [...listed].sort());
	assert.ok(listed.length > 1);
});
