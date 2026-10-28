// SPEC §4.18.3 EC-3/EC-6/EC-7 + §4.18.1: summary truncation and corrupt
// line counting. Pure over caller inputs except the readEvents half,
// which runs against a caller-owned temp repo. Fully deterministic.
import { strict as assert } from "node:assert";
import test from "node:test";
import { portsFor } from "../../../src/cli/shared.ts";
import { readEvents, summarize } from "../../../src/features/audit/index.ts";
import { FIXED_INSTANT } from "../../support/fake-clock.ts";
import { createTempRepo } from "../../support/temp-repo.ts";

test("[§4.18.3] summary truncates past 60 KB with counts", async () => {
	// SPEC §4.18.6 EC-6: past 60 KB the slots collapse to counts with
	// the command to see all.
	const summary = await summarize(FIXED_INSTANT, 100000);
	assert.ok(Buffer.byteLength(summary, "utf8") <= 60000);
	assert.ok(summary.includes("[truncated"));
	assert.ok(summary.includes("codictator report for all"));
	assert.ok(summary.includes("token metrics: unavailable"));
});

test("[§4.18.3] summary of zero slots names the gap", async () => {
	// SPEC §4.18.3: with no slots the screen names the gap and the
	// unavailable token metrics.
	const summary = await summarize(FIXED_INSTANT, 0);
	assert.ok(summary.includes("gap in event coverage"));
	assert.ok(summary.includes("token metrics: unavailable"));
});

test("[§4.18.1] readEvents skips a non-record line", async () => {
	// SPEC §4.18.1: a corrupt line that is not a record is counted and
	// skipped while the valid lines still read.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		repo.writeFile(
			".codictator/state/events.jsonl",
			`[1,2]\n${JSON.stringify({
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
			})}\n`,
		);
		const ports = await portsFor(repo.dir);
		assert.equal(ports.ok, true);
		if (ports.ok) {
			const read = await readEvents(ports.value, ".");
			assert.equal(read.ok, true);
			if (read.ok) {
				assert.equal(read.value.corrupt, 1);
				assert.equal(read.value.events.length, 1);
			}
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.18.1] readEvents skips a line missing required fields", async () => {
	// SPEC §4.18.1: an object without the §7.10 fields counts as corrupt.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		repo.writeFile(
			".codictator/state/events.jsonl",
			`${JSON.stringify({ v: 1, id: "evt-9" })}\n`,
		);
		const ports = await portsFor(repo.dir);
		assert.equal(ports.ok, true);
		if (ports.ok) {
			const read = await readEvents(ports.value, ".");
			assert.equal(read.ok, true);
			if (read.ok) {
				assert.equal(read.value.corrupt, 1);
				assert.equal(read.value.events.length, 0);
			}
		}
	} finally {
		repo.cleanup();
	}
});
