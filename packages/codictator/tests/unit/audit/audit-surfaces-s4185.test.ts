import { strict as assert } from "node:assert";

import test from "node:test";

import type { EventLogLine } from "../../../src/features/audit/index.ts";

import { buildReportText } from "../../../src/features/audit/index.ts";

import { FIXED_INSTANT } from "../../support/fake-clock.ts";

function eventLine(overrides: Partial<EventLogLine> = {}): EventLogLine {
	return {
		v: 1,
		id: "evt-1",
		ts: FIXED_INSTANT,
		now: FIXED_INSTANT,
		kind: "verdict",
		layer: "L1",
		trigger: "pre-tool",
		ruleIds: [],
		durationMs: 5,
		configHash: "abc",
		packs: {},
		...overrides,
	};
}

test("[§4.18.5] report metrics read from local events only", () => {
	// SPEC §4.18.5: block/allow pairs set the self-correction rate,
	// escalations count, p95 renders in ms, and token metrics stay
	// "unavailable" without harness usage data.
	const text = buildReportText({
		events: [
			eventLine({ id: "e1", decision: "block", durationMs: 10 }),
			eventLine({ id: "e2", decision: "allow", durationMs: 30 }),
			eventLine({ id: "e3", kind: "escalation", durationMs: 20 }),
		],
		corrupt: 2,
		now: FIXED_INSTANT,
	});
	assert.ok(text.includes("self-correction rate: 1/1"));
	assert.ok(text.includes("loop-breaker escalations: 1"));
	assert.ok(text.includes("unavailable (no harness usage data)"));
	assert.ok(text.includes("p95 event latency: 30ms"));
	assert.ok(text.includes("corrupt lines skipped: 2"));
});

test("[§4.18.5] report with no events names the gaps", () => {
	// SPEC §4.18.5: with no events the rate and p95 name the gap instead
	// of rendering zeros.
	const text = buildReportText({ events: [], corrupt: 0, now: FIXED_INSTANT });
	assert.ok(text.includes("no blocks observed"));
	assert.ok(text.includes("p95 event latency: no events observed"));
});
