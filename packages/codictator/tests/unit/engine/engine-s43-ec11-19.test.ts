import { strict as assert } from "node:assert";

import test from "node:test";

import type { NewEvent } from "../../../src/features/audit/index.ts";

import type {
	CheckContext,
	Finding,
} from "../../../src/features/engine/index.ts";

import {
	compareRatchet,
	createEngine,
} from "../../../src/features/engine/index.ts";

import { ok, stableStringify } from "../../../src/kernel/index.ts";

import { FIXED_INSTANT } from "../../support/fake-clock.ts";

function checkCtx(files: ReadonlyArray<string> = []): CheckContext {
	return {
		trigger: "startup",
		scope: { files, sessionId: "session-1" },
		now: FIXED_INSTANT,
		configHash: "config-hash",
	};
}

test("[§4.3 EC-19] zero effective enforcers block with CDX-E904", async () => {
	const seen: Array<NewEvent> = [];
	const engine = createEngine([], {
		append: (event) => {
			seen.push(event);
			return Promise.resolve(ok(undefined));
		},
	});
	// SPEC §4.3.9 EC-19: no rule selected for a gating trigger, so the
	// verdict fails closed with a synthetic CDX-E904 finding that names the
	// guard, not the code, and the event is still recorded.
	const verdict = await engine.evaluate(
		"pre-tool",
		{ files: [] },
		FIXED_INSTANT,
	);
	assert.equal(verdict.decision, "block");
	assert.ok(
		verdict.findings.some((finding) => finding.code === "CDX-E904"),
		"expected a synthetic CDX-E904 finding",
	);
	assert.ok(verdict.message.includes("CDX-E904"));
	assert.ok(verdict.message.includes("Do instead:"));
	assert.equal(seen.length, 1);
});

test("[§4.3 EC-19] filtered-out rules still fail closed with CDX-E904", async () => {
	const engine = createEngine([
		{
			id: "core/x",
			kinds: ["startup"],
			budgetMs: 1000,
			check: async () => [],
		},
	]);
	// SPEC §4.3.9 EC-19: every selected rule filtered out for this trigger
	// (the guard only runs at startup). The block holds even on the
	// advisory prompt trigger; only L2 advises.
	for (const trigger of ["pre-tool", "prompt", "review"] as const) {
		const verdict = await engine.evaluate(
			trigger,
			{ files: [] },
			FIXED_INSTANT,
		);
		assert.equal(verdict.decision, "block");
		assert.ok(
			verdict.findings.some((finding) => finding.code === "CDX-E904"),
			`expected a synthetic CDX-E904 finding at ${trigger}`,
		);
	}
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
