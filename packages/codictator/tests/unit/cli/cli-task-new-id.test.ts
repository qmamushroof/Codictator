// SPEC §4.12.1: task ids derive from the max live suffix plus one, so gaps
// from deleted stale records never collide with a live record.
import { strict as assert } from "node:assert";
import test from "node:test";
import { nextTaskId } from "../../../src/cli/tasks.ts";

test("[§4.12.1] task new issues max-plus-one ids without overwriting", () => {
	assert.equal(nextTaskId(["T-0001", "T-0003", "T-0004"]), "T-0005");
	assert.equal(nextTaskId([]), "T-0001");
	assert.equal(nextTaskId(["T-0002", "stale.json", "T-0010"]), "T-0011");
});
