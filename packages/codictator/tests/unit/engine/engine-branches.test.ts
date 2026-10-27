// Standing deviation (same as the branch deviation): these branch-level unit
// tests pass green and stay unlisted while the future-phase red rows stay
// listed. Covers SPEC §4.3.3 evaluate branches (CDX-E903 throw paths, waiver
// suppression and error findings, prompt advisory, clock-skew flag) through
// the engine index wrappers, with a capturing append sink and fixed instants.
import { strict as assert } from "node:assert";
import test from "node:test";
import type { NewEvent } from "../../../src/features/audit/index.ts";
import {
	buildMessage,
	createEngine,
	isWaived,
	matchWaivers,
} from "../../../src/features/engine/index.ts";
import { ok } from "../../../src/kernel/index.ts";
import { FIXED_INSTANT } from "../../support/fake-clock.ts";

function finding(
	ruleId: string,
	path: string,
): { ruleId: string; path: string; message: string; remediation: string } {
	return {
		ruleId,
		path,
		message: "too big",
		remediation: "shrink it",
	};
}

test("[§4.3] sync throw carrying CDX-E903 maps to CDX-E903", async () => {
	const engine = createEngine([
		{
			id: "core/x",
			kinds: ["startup"],
			budgetMs: 1000,
			check: (): Promise<Array<never>> => {
				throw { code: "CDX-E903" };
			},
		},
	]);
	const verdict = await engine.evaluate(
		"startup",
		{ files: [] },
		FIXED_INSTANT,
	);
	assert.equal(verdict.decision, "block");
	assert.ok(
		verdict.findings.some((entry) => entry.code === "CDX-E903"),
		"expected a CDX-E903 finding",
	);
});

test("[§4.3] async rejection carrying CDX-E903 maps to CDX-E903", async () => {
	const engine = createEngine([
		{
			id: "core/x",
			kinds: ["startup"],
			budgetMs: 1000,
			check: () => Promise.reject({ code: "CDX-E903" }),
		},
	]);
	const verdict = await engine.evaluate(
		"startup",
		{ files: [] },
		FIXED_INSTANT,
	);
	assert.equal(verdict.decision, "block");
	assert.ok(
		verdict.findings.some((entry) => entry.code === "CDX-E903"),
		"expected a CDX-E903 finding",
	);
});

test("[§4.3] waiver suppresses a tunable finding and rides the event", async () => {
	const seen: Array<NewEvent> = [];
	const engine = createEngine(
		[
			{
				id: "core/file-size",
				kinds: ["startup"],
				budgetMs: 1000,
				check: async () => [finding("core/file-size", "src/a.ts")],
			},
		],
		{
			append: (event) => {
				seen.push(event);
				return Promise.resolve(ok(undefined));
			},
		},
	);
	const verdict = await engine.evaluate(
		"startup",
		{ files: [] },
		FIXED_INSTANT,
	);
	assert.equal(verdict.decision, "allow");
	assert.deepEqual(verdict.waiversApplied, ["W-0001"]);
	assert.deepEqual(seen[0]?.waivers, ["W-0001"]);
});

test("[§4.3] floor-rule waiver blocks loudly with CDX-E103", async () => {
	const engine = createEngine([
		{
			id: "core/no-bypass",
			kinds: ["startup"],
			budgetMs: 1000,
			check: async () => [finding("core/no-bypass", "src/x.ts")],
		},
	]);
	const verdict = await engine.evaluate(
		"startup",
		{ files: [] },
		FIXED_INSTANT,
	);
	assert.equal(verdict.decision, "block");
	assert.ok(
		verdict.findings.some((entry) => entry.code === "CDX-E103"),
		"expected a CDX-E103 error finding",
	);
});

test("[§4.3] prompt findings advise instead of block", async () => {
	const engine = createEngine([
		{
			id: "core/no-secrets",
			kinds: ["prompt"],
			budgetMs: 1000,
			check: async () => [finding("core/no-secrets", "src/a.ts")],
		},
	]);
	const verdict = await engine.evaluate("prompt", { files: [] }, FIXED_INSTANT);
	assert.equal(verdict.decision, "advise");
	assert.ok(verdict.message.includes("flagged for review"));
});

test("[§4.3] earlier second evaluation flags clock skew on the event", async () => {
	const seen: Array<NewEvent> = [];
	const engine = createEngine([], {
		append: (event) => {
			seen.push(event);
			return Promise.resolve(ok(undefined));
		},
	});
	await engine.evaluate("startup", { files: [] }, "2026-02-01T00:00:00.000Z");
	await engine.evaluate("startup", { files: [] }, "2026-01-15T00:00:00.000Z");
	assert.equal(seen.length, 2);
	assert.equal(seen[1]?.clockSkew, true);
});

test("[§4.3] index wrappers delegate to the verdict path", async () => {
	const message = buildMessage("allow", [], "event-1");
	assert.ok(message.includes("allowed"));
	const waived = await isWaived("core/file-size", "src/a.ts", FIXED_INSTANT);
	assert.equal(waived.ok, true);
	const matched = matchWaivers(
		{
			waivers: [],
			tiers: {},
			maxWaiverDays: 90,
		},
		"core/file-size",
		"src/a.ts",
		FIXED_INSTANT,
	);
	assert.equal(matched.ok, true);
	if (matched.ok) {
		assert.equal(matched.value.length, 0);
	}
});
