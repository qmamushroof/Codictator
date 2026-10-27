// Standing deviation (same as the branch deviation): these branch-level unit
// tests pass green and stay unlisted while the future-phase red rows stay
// listed. Covers the SPEC §4.1.1 SystemClock and NodeEnv ports: no I/O, no
// wall-clock waits, no environment mutation.
import { strict as assert } from "node:assert";
import test from "node:test";
import { NodeEnv, SystemClock } from "../../../src/kernel/index.ts";

test("[§4.1] system clock returns an ISO instant", () => {
	const clock = new SystemClock();
	assert.match(clock.now(), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});

test("[§4.1] node env answers undefined for a missing name", () => {
	const env = new NodeEnv();
	assert.equal(env.get("CODICTATOR_TEST_MISSING_12345"), undefined);
});

test("[§4.1] node env reads the ambient environment", () => {
	const env = new NodeEnv();
	const name = "PATH";
	assert.equal(env.get(name), process.env[name]);
});
