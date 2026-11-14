// SPEC §4.7.3 + BUG-0100 regression: the => bearing escape was dropped by the
// path-likeness filter before the escape check.
import { strict as assert } from "node:assert";
import test from "node:test";
import { judge } from "../../support/write-confine-judge.ts";

test("[§4.7.3] regression: write-confinement blocks the ../../etc/x=>y escape (BUG-0100)", async () => {
	const found = await judge("write: ../../etc/x=>y\n", "plan.yml");
	assert.equal(found.length, 1);
	assert.match(found[0]?.message ?? "", /escapes the repo root/);
});
