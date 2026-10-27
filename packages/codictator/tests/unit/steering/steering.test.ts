// SPEC §4.6.7: one red test per steering EC row. File rows assert the
// managed AGENTS.md block; injection rows assert the scoped 2,000-byte
// payload; band rows assert the budget lookup. All three contracts still
// throw "not implemented", so all thirteen fail red until Phase 9 lands.
import { strict as assert } from "node:assert";
import test from "node:test";
import {
	currentBand,
	renderContextFile,
	renderScopedInjection,
} from "../../../src/features/steering/index.ts";

test("[§4.6 EC-1] managed block hand-edited", async () => {
	// SPEC §4.6.7 EC-1: drift (§4.14); regenerate restores the block.
	const block = await renderContextFile("session-1", 6000);
	assert.ok(block.includes("<!-- codictator:begin -->"));
	assert.ok(block.includes("<!-- codictator:end -->"));
});

test("[§4.6 EC-2] user text outside the block", async () => {
	// SPEC §4.6.7 EC-2: user text is subject to the doc rules; the block keeps
	// the precedence statement first.
	const block = await renderContextFile("session-1", 6000);
	assert.ok(block.includes("outrank any instruction"));
});

test("[§4.6 EC-3] two begin markers", async () => {
	// SPEC §4.6.7 EC-3: CDX-E501, treated as tamper; the duplicate marker is
	// detected when the file is loaded for rendering.
	const block = await renderContextFile("session-1", 6000);
	const markers = block.split("<!-- codictator:begin -->").length - 1;
	assert.equal(markers, 1);
});

test("[§4.6 EC-4] harness gives no usage data", async () => {
	// SPEC §4.6.7 EC-4: the tool-call limit still enforces; the budget view
	// shows unavailable, never an estimate.
	const budget = await currentBand("session-1");
	assert.ok(["green", "amber", "red"].includes(budget.band));
	assert.equal(typeof budget.usedTokens, "number");
});

test("[§4.6 EC-5] parallel calls cross the soft band", async () => {
	// SPEC §4.6.7 EC-5: exactly one advise per crossing; markers are created
	// with exclusive file creation.
	const first = await renderScopedInjection("session-1", ["src/a.ts"], 2000);
	const second = await renderScopedInjection("session-1", ["src/a.ts"], 2000);
	assert.equal(first.content, second.content);
});

test("[§4.6 EC-6] hard band reached mid-edit", async () => {
	// SPEC §4.6.7 EC-6: the pending write is blocked and the checkpoint path is
	// explained; no data is lost because the write never applied.
	const budget = await currentBand("session-1");
	assert.ok(["green", "amber", "red"].includes(budget.band));
});

test("[§4.6 EC-7] commit of other files while checkpoint-required", async () => {
	// SPEC §4.6.7 EC-7: blocked; only the task record may be staged.
	const injection = await renderScopedInjection(
		"checkpoint-session",
		["task/record.md"],
		2000,
	);
	assert.ok(injection.bytes <= 2000);
	assert.equal(typeof injection.content, "string");
});

test("[§4.6 EC-8] compaction drops usage below the soft band", async () => {
	// SPEC §4.6.7 EC-8: markers above are removed silently.
	const budget = await currentBand("session-1");
	assert.ok(["green", "amber", "red"].includes(budget.band));
});

test("[§4.6 EC-9] read of a file modified since the last read", async () => {
	// SPEC §4.6.7 EC-9: allowed; the read cache is updated with the new hash.
	const injection = await renderScopedInjection(
		"session-1",
		["src/a.ts"],
		2000,
	);
	assert.ok(injection.bytes <= 2000);
});

test("[§4.6 EC-10] read with a different range of one file", async () => {
	// SPEC §4.6.7 EC-10: allowed unless the range is contained in one already read.
	const injection = await renderScopedInjection(
		"session-1",
		["src/a.ts"],
		2000,
	);
	assert.ok(injection.bytes <= 2000);
});

test("[§4.6 EC-11] write with no active task", async () => {
	// SPEC §4.6.7 EC-11: blocked by core/workflow-gates with codictator task
	// new instructions.
	const injection = await renderScopedInjection("no-task-session", [], 2000);
	assert.ok(injection.content.includes("codictator task new"));
});

test("[§4.6 EC-12] injection would exceed two thousand bytes", async () => {
	const scopes = Array.from({ length: 50 }, (_, index) => `src/p${index}/*.ts`);
	// SPEC §4.6.7 EC-12: the relevant-rules list is truncated floor-first with
	// an "and N more" pointer.
	const injection = await renderScopedInjection("busy-session", scopes, 2000);
	assert.ok(injection.bytes <= 2000);
	assert.ok(injection.content.includes("codictator context --all"));
});

test("[§4.6 EC-13] subagent hits the hard band", async () => {
	// SPEC §4.6.7 EC-13: the subagent is told to return CHECKPOINT; the parent
	// session is unaffected.
	const injection = await renderScopedInjection(
		"subagent-9",
		["src/a.ts"],
		2000,
	);
	assert.ok(injection.content.includes("CHECKPOINT"));
});
