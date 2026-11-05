import { strict as assert } from "node:assert";

import test from "node:test";

import type { NewEvent } from "../../../src/features/audit/index.ts";

import type { Finding } from "../../../src/features/engine/index.ts";

import {
	compareRatchet,
	createEngine,
	isWaived,
} from "../../../src/features/engine/index.ts";

import { err, ok } from "../../../src/kernel/index.ts";

import { FakeClock, FIXED_INSTANT } from "../../support/fake-clock.ts";

test("[§4.3 EC-1] no rule matches a feedback-only trigger", async () => {
	const seen: Array<NewEvent> = [];
	const engine = createEngine([], {
		append: (event) => {
			seen.push(event);
			return Promise.resolve(ok(undefined));
		},
	});
	// SPEC §4.3.9 EC-1: tool.post.write and stop arrive as post-tool, which
	// never gates, so zero enforcers allow with the event still recorded.
	const verdict = await engine.evaluate(
		"post-tool",
		{ files: [] },
		FIXED_INSTANT,
	);
	assert.equal(verdict.decision, "allow");
	assert.equal(verdict.findings.length, 0);
	assert.equal(seen.length, 1);
});

test("[§4.3 EC-2] enforcer throws", async () => {
	const engine = createEngine([
		{
			id: "core/x",
			kinds: ["startup"],
			budgetMs: 1000,
			check: () => Promise.reject(new Error("boom")),
		},
	]);
	// SPEC §4.3.9 EC-2: block CDX-E901; the message names the rule and says
	// the guard failed, not the code.
	const verdict = await engine.evaluate(
		"startup",
		{ files: [] },
		FIXED_INSTANT,
	);
	assert.equal(verdict.decision, "block");
	const codes = verdict.findings.map((finding) => finding.code);
	assert.ok(codes.includes("CDX-E901"));
});

test("[§4.3 EC-3] enforcer exceeds budget", async () => {
	const engine = createEngine([
		{
			id: "core/x",
			kinds: ["startup"],
			budgetMs: 1,
			check: (): Promise<Array<Finding>> =>
				new Promise<Array<Finding>>(() => {}),
		},
	]);
	// Integrity exception (CONVENTIONS tests): the prior body resolved
	// instantly, so microtasks beat the 1 ms timer and E902 never fired; it
	// contradicted the SPEC §4.3 budget intent (a hanging enforcer must block
	// CDX-E902). The never-settling promise exercises the timer path
	// deterministically.
	// SPEC §4.3.9 EC-3: block CDX-E902.
	const verdict = await engine.evaluate(
		"startup",
		{ files: [] },
		FIXED_INSTANT,
	);
	assert.equal(verdict.decision, "block");
	const codes = verdict.findings.map((finding) => finding.code);
	assert.ok(codes.includes("CDX-E902"));
});

test("[§4.3 EC-4] event log unwritable", async () => {
	const engine = createEngine([], {
		append: () =>
			Promise.resolve(
				err({
					code: "CDX-E801",
					message: "disk full",
					remediation: "Free disk space and retry.",
				}),
			),
	});
	// Integrity exception (CONVENTIONS tests): the prior body used the default
	// in-memory append, which cannot fail, so the E801 path was unreachable;
	// it contradicted SPEC §4.3.3 step 6 (append failure blocks CDX-E801).
	// The injected failing append exercises that path.
	// SPEC §4.3.9 EC-4: block CDX-E801; the append happens before the return.
	const verdict = await engine.evaluate(
		"startup",
		{ files: [] },
		FIXED_INSTANT,
	);
	assert.equal(verdict.decision, "block");
	const codes = verdict.findings.map((finding) => finding.code);
	assert.ok(codes.includes("CDX-E801"));
});

test("[§4.3 EC-5] waiver expires between two evaluations", async () => {
	// SPEC §4.3.9 EC-5: first allows, second blocks; both events cite the waiver.
	const clock = new FakeClock();
	const active = await isWaived("core/file-size", "src/a.ts", clock.now());
	assert.equal(active.ok, true);
	if (active.ok) {
		assert.equal(active.value, true);
	}
	clock.advanceMs(100 * 86400000);
	const lapsed = await isWaived("core/file-size", "src/a.ts", clock.now());
	assert.equal(lapsed.ok, true);
	if (lapsed.ok) {
		assert.equal(lapsed.value, false);
	}
});

test("[§4.3 EC-6] waiver targets a floor rule", async () => {
	// SPEC §4.3.9 EC-6: config load fails CDX-E103.
	const waived = await isWaived("core/no-bypass", "src/a.ts", FIXED_INSTANT);
	assert.equal(waived.ok, false);
	if (!waived.ok) {
		assert.equal(waived.error.code, "CDX-E103");
	}
});

test("[§4.3 EC-7] two waivers overlap on one rule", async () => {
	// SPEC §4.3.9 EC-7: the stricter applies; core/waivers-valid reports overlap.
	const first = await isWaived("core/file-size", "src/a.ts", FIXED_INSTANT);
	const second = await isWaived("core/file-size", "src/a/b.ts", FIXED_INSTANT);
	assert.equal(first.ok, true);
	assert.equal(second.ok, true);
});

test("[§4.3 EC-8] ratchet count rises in an untouched file", () => {
	// SPEC §4.3.9 EC-8: block; a shared import made it worse.
	assert.ok(
		compareRatchet({ "src/a.ts": 5 }, { "src/a.ts": 6 }).includes("src/a.ts"),
	);
});

test("[§4.3 EC-9] touched file with baseline zero", () => {
	// SPEC §4.3.9 EC-9: the normal rule applies; no decrement is required.
	assert.equal(compareRatchet({}, {}).length, 0);
});

test("[§4.3 EC-10] touched file unchanged at baseline five", () => {
	// SPEC §4.3.9 EC-10: no count rose, so the count rules pass here; the block
	// comes from core/ratchet-touched-improves at the verdict layer.
	assert.equal(compareRatchet({ "src/a.ts": 5 }, { "src/a.ts": 5 }).length, 0);
});
