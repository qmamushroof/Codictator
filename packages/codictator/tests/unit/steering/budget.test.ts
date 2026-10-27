// SPEC §4.6.2 and §4.6.3: agent-facing steering text stays inside its byte
// budgets. Both renderers still throw "not implemented", so both fail red
// until Phase 9 lands.
import { strict as assert } from "node:assert";
import test from "node:test";
import {
	renderContextFile,
	renderScopedInjection,
} from "../../../src/features/steering/index.ts";

test("[§4.6.2] AGENTS.md block fits in 6,000 bytes", async () => {
	// SPEC §4.6.2: the managed block is at most 6,000 bytes.
	const block = await renderContextFile("session-1", 6000);
	assert.ok(Buffer.byteLength(block, "utf8") <= 6000);
});

test("[§4.6.3] scoped injection fits in 2,000 bytes", async () => {
	// SPEC §4.6.3: the per-scope injection is at most 2,000 bytes.
	const injection = await renderScopedInjection(
		"session-1",
		["src/a.ts"],
		2000,
	);
	assert.ok(injection.bytes <= 2000);
	assert.ok(Buffer.byteLength(injection.content, "utf8") <= 2000);
});
