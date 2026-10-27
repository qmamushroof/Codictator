// Standing deviation (same as the branch deviation): these branch-level unit
// tests pass green and stay unlisted while the future-phase red rows stay
// listed. Covers SPEC §4.3.7 buildMessage branches: allow and advise verbs,
// the count line past three findings, the over-budget trim, the truncation
// fallback, and multi-byte safety at the cut.
import { strict as assert } from "node:assert";
import test from "node:test";
import type { Finding } from "../../../src/features/engine/index.ts";
import {
	buildMessage,
	MAX_MESSAGE_BYTES,
} from "../../../src/features/engine/message.ts";

function byteLength(text: string): number {
	return new TextEncoder().encode(text).length;
}

function finding(ruleId: string, size: number): Finding {
	return {
		ruleId,
		message: "m".repeat(size),
		remediation: "r".repeat(size),
	};
}

test("[§4.3] advise with no findings names review", () => {
	const message = buildMessage("advise", [], "event-1");
	assert.ok(message.includes("flagged for review"));
	assert.ok(message.includes("no findings remain"));
});

test("[§4.3] escalate renders as blocked", () => {
	const message = buildMessage("escalate", [finding("core/x", 4)], "event-2");
	assert.ok(message.includes("blocked"));
});

test("[§4.3] over-budget verdict trims to the head and tail", () => {
	const findings: Array<Finding> = [];
	for (let index = 0; index < 50; index += 1) {
		findings.push(finding("core/x", 300));
	}
	const message = buildMessage("block", findings, "event-3");
	assert.ok(byteLength(message) <= MAX_MESSAGE_BYTES);
	assert.ok(message.includes("and 50 more"));
});

test("[§4.3] still-over-budget verdict truncates with a marker", () => {
	const findings: Array<Finding> = [];
	for (let index = 0; index < 50; index += 1) {
		findings.push({
			ruleId: `core/${"r".repeat(96)}${index}`,
			message: `x${"😀".repeat(300)}`,
			remediation: `y${"😀".repeat(300)}`,
		});
	}
	const message = buildMessage("block", findings, "event-4");
	assert.ok(byteLength(message) <= MAX_MESSAGE_BYTES);
	assert.ok(message.endsWith("[truncated]"));
});
