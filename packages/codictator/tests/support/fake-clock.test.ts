// SPEC §10.2: self-test for the fixed Clock support.
import { strict as assert } from "node:assert";
import test from "node:test";
import { FakeClock, FIXED_INSTANT } from "./fake-clock.ts";

test("[§10.2] fake clock returns the fixed instant by default", () => {
	const clock = new FakeClock();
	assert.equal(clock.now(), FIXED_INSTANT);
	assert.equal(clock.now(), clock.now());
});

test("[§10.2] fake clock advances and resets deterministically", () => {
	const clock = new FakeClock("2026-01-01T00:00:00.000Z");
	clock.advanceMs(1000);
	assert.equal(clock.now(), "2026-01-01T00:00:01.000Z");
	clock.set("2026-06-01T12:00:00.000Z");
	assert.equal(clock.now(), "2026-06-01T12:00:00.000Z");
});
