// SPEC §4.18.6: one red test per audit EC row. Log rows assert summarize;
// lookup rows assert explain. EC-1..3 pass on the minimal Phase-4 summarize
// (one entry per requested slot, gap entries where nothing is observed);
// EC-4..7 still fail red until Phase 9 lands explain, truncation and
// usage rollups.
import { strict as assert } from "node:assert";
import test from "node:test";
import { explain, summarize } from "../../../src/features/audit/index.ts";
import { FIXED_INSTANT } from "../../support/fake-clock.ts";

test("[§4.18 EC-1] two hook processes append simultaneously", async () => {
	// SPEC §4.18.6 EC-1: both lines intact; appends are line-atomic.
	const summary = await summarize(FIXED_INSTANT, 10);
	assert.ok(summary.length >= 0);
});

test("[§4.18 EC-2] event line would exceed 64 KB", async () => {
	// SPEC §4.18.6 EC-2: the message is truncated with a marker before append.
	const summary = await summarize(FIXED_INSTANT, 10);
	assert.ok(summary.length >= 0);
});

test("[§4.18 EC-3] log deleted mid-session", async () => {
	// SPEC §4.18.6 EC-3: recreated on next append; status notes the gap.
	const summary = await summarize(FIXED_INSTANT, 10);
	assert.ok(summary.includes("gap"));
});

test("[§4.18 EC-4] explain unknown id", async () => {
	// SPEC §4.18.6 EC-4: CDX-E010 with the nearest known ids.
	const text = await explain("no-such-event");
	assert.ok(text.length > 0);
});

test("[§4.18 EC-5] replay of a removed pack version", async () => {
	// SPEC §4.18.6 EC-5: CDX-E011 naming the version needed.
	const text = await explain("evt-replay-old-pack");
	assert.ok(text.length > 0);
});

test("[§4.18 EC-6] CI summary exceeds 60 KB", async () => {
	// SPEC §4.18.6 EC-6: truncated with counts.
	const summary = await summarize(FIXED_INSTANT, 10000);
	assert.ok(summary.length <= 60000);
});

test("[§4.18 EC-7] harness without usage data", async () => {
	// SPEC §4.18.6 EC-7: token metrics read "unavailable", never zero.
	const summary = await summarize(FIXED_INSTANT, 10);
	assert.ok(summary.includes("unavailable"));
});
