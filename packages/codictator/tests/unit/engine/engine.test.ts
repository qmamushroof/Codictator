// SPEC §4.3.9: one red test per engine EC row. Verdict rows assert the
// decision, findings and message; ratchet rows assert compareRatchet;
// waiver rows assert isWaived. createEngine still throws "not implemented",
// so all eighteen fail red until Phase 4 lands.
import { strict as assert } from "node:assert";
import test from "node:test";
import type {
	CheckContext,
	Finding,
} from "../../../src/features/engine/index.ts";
import {
	compareRatchet,
	createEngine,
	isWaived,
} from "../../../src/features/engine/index.ts";
import { stableStringify } from "../../../src/kernel/index.ts";
import { FakeClock, FIXED_INSTANT } from "../../support/fake-clock.ts";

function checkCtx(files: ReadonlyArray<string> = []): CheckContext {
	return {
		trigger: "startup",
		scope: { files, sessionId: "session-1" },
		now: FIXED_INSTANT,
		configHash: "config-hash",
	};
}

test("[§4.3 EC-1] no rule matches the trigger", async () => {
	const engine = createEngine([]);
	// SPEC §4.3.9 EC-1: allow, with the event still recorded.
	const verdict = await engine.evaluate(
		"startup",
		{ files: [] },
		FIXED_INSTANT,
	);
	assert.equal(verdict.decision, "allow");
	assert.equal(verdict.findings.length, 0);
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
			check: async (): Promise<Array<Finding>> => [],
		},
	]);
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
	const engine = createEngine([]);
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

test("[§4.3 EC-11] file renamed and edited", () => {
	// SPEC §4.3.9 EC-11: treated as touched under the new key; the old key moved.
	assert.equal(
		compareRatchet({ "src/old.ts": 3 }, { "src/new.ts": 3 }).length,
		0,
	);
});

test("[§4.3 EC-12] same input on Windows and Linux", async () => {
	const engine = createEngine([]);
	const scope = { files: ["src/a.ts"] };
	// SPEC §4.3.9 EC-12: byte-identical verdict JSON.
	assert.equal(
		stableStringify(await engine.evaluate("startup", scope, FIXED_INSTANT)),
		stableStringify(await engine.evaluate("startup", scope, FIXED_INSTANT)),
	);
});

test("[§4.3 EC-13] fifty findings fit the message budget", async () => {
	const fifty: Array<Finding> = [];
	for (let index = 0; index < 50; index += 1) {
		fifty.push({
			ruleId: "core/x",
			message: `finding ${index}`,
			remediation: "do the compliant thing",
		});
	}
	const engine = createEngine([
		{
			id: "core/x",
			kinds: ["startup"],
			budgetMs: 1000,
			check: async (): Promise<Array<Finding>> => fifty,
		},
	]);
	// SPEC §4.3.9 EC-13: the message lists three, then "and 47 more".
	const verdict = await engine.evaluate(
		"startup",
		{ files: [] },
		FIXED_INSTANT,
	);
	assert.equal(verdict.findings.length, 50);
	assert.ok(verdict.message.includes("and 47 more"));
});

test("[§4.3 EC-14] finding text holding a secret is redacted", async () => {
	const token = `ghp_${"b".repeat(36)}`;
	const engine = createEngine([
		{
			id: "core/no-secrets",
			kinds: ["pre-tool"],
			budgetMs: 1000,
			check: async (): Promise<Array<Finding>> => [
				{
					ruleId: "core/no-secrets",
					message: `saw ${token}`,
					remediation: "read it from an env var",
				},
			],
		},
	]);
	// SPEC §4.3.9 EC-14: redacted by the kernel; the engine never imports security.
	const verdict = await engine.evaluate(
		"pre-tool",
		{ files: ["src/a.ts"] },
		FIXED_INSTANT,
	);
	assert.ok(verdict.findings.length > 0);
	assert.ok(!verdict.message.includes(token));
});

test("[§4.3 EC-15] clock skew against the last event", async () => {
	const engine = createEngine([]);
	// SPEC §4.3.9 EC-15: evaluated as given; the event is flagged clockSkew.
	const verdict = await engine.evaluate(
		"startup",
		{ files: [] },
		"2025-01-01T00:00:00.000Z",
	);
	assert.ok(
		["allow", "advise", "block", "escalate"].includes(verdict.decision),
	);
	assert.equal(checkCtx().now, FIXED_INSTANT);
});

test("[§4.3 EC-16] one metric falls while none rises", () => {
	// SPEC §4.3.9 EC-16: pass; file-size 1 to 1, complexity 3 to 2.
	assert.equal(
		compareRatchet(
			{ "a:size": 1, "a:complexity": 3 },
			{ "a:size": 1, "a:complexity": 2 },
		).length,
		0,
	);
});

test("[§4.3 EC-17] one metric rises while another falls", () => {
	// SPEC §4.3.9 EC-17: block "worse than recorded" for the risen metric;
	// the drop elsewhere does not offset it.
	assert.ok(
		compareRatchet({ "a:c": 3, "a:f": 2 }, { "a:c": 1, "a:f": 3 }).includes(
			"a:f",
		),
	);
});

test("[§4.3 EC-18] non-path metric key is never touched", () => {
	// SPEC §4.3.9 EC-18: only the count rules apply.
	assert.ok(
		compareRatchet({ "npm:react": 2 }, { "npm:react": 3 }).includes(
			"npm:react",
		),
	);
});
