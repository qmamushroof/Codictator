// SPEC §4.20.2: the PR4 Active rules polish — pack versions, tier
// grouping, statement/reason/params tooltips and the Explain action.
// Red-first: the views.ts additions do not exist yet.
import { strict as assert } from "node:assert";
import test from "node:test";
import {
	groupRulesByTier,
	listRuleDetails,
	ruleTooltip,
} from "../../src/rule-views.ts";

function fakeRequest(): (
	folderPath: string,
	method: string,
	params: unknown,
) => Promise<unknown> {
	return (_folderPath: string, method: string, _params: unknown) => {
		assert.equal(method, "rules/list");
		return Promise.resolve({
			rules: [
				{
					coverage: "per-harness capability declarations",
					id: "core/arch-module-mapped",
					pack: "core",
					packVersion: "0.2.7",
					params: { maxLines: 300 },
					reason: "Unmapped files escape every boundary.",
					statement: "Every file maps to one architecture module.",
					tier: "floor",
					waivers: [],
				},
				{
					coverage: "all harnesses",
					id: "core/no-guard-removal",
					pack: "core",
					packVersion: "0.2.7",
					params: {},
					reason: "Smaller is never less safe.",
					statement: "Never delete a guard to shrink a change.",
					tier: "floor",
					waivers: [{ expiresAt: "2026-12-01T00:00:00.000Z" }],
				},
				{
					id: "style/max-nesting",
					pack: "style",
					params: {},
					statement: "Keep nesting shallow.",
					tier: "mid",
				},
			],
		});
	};
}

test("[§4.20.2] rules carry pack versions with statement, reason and effective params", async () => {
	// SPEC §4.20.2 PR4: each rule names its pack version, statement, reason
	// and effective params; an unknown version renders "unknown".
	const details = await listRuleDetails(["/repo"], fakeRequest());
	assert.equal(details.length, 3);
	const first = details[0];
	assert.ok(first !== undefined);
	assert.equal(first.version, "0.2.7");
	assert.equal(first.statement, "Every file maps to one architecture module.");
	assert.equal(first.paramsText, "maxLines=300");
	const unversioned = details.find((rule) => rule.id === "style/max-nesting");
	assert.ok(unversioned !== undefined);
	assert.equal(unversioned.version, "unknown");
});

test("[§4.20.2] rules group by tier with packs and an explain tooltip", async () => {
	// SPEC §4.20.2 PR4: tiers group packs; the tooltip carries statement,
	// reason, params and waiver days left, and Explain explains the rule.
	const details = await listRuleDetails(["/repo"], fakeRequest());
	const tiers = groupRulesByTier(details);
	assert.deepEqual(
		tiers.map((tier) => tier.tier),
		["floor", "mid"],
	);
	const floor = tiers[0];
	assert.ok(floor !== undefined);
	assert.equal(floor.packs.length, 1);
	assert.equal(floor.packs[0]?.version, "0.2.7");
	const waived = details.find((rule) => rule.id === "core/no-guard-removal");
	assert.ok(waived !== undefined);
	const tooltip = ruleTooltip(waived, Date.parse("2026-11-07T00:00:00.000Z"));
	assert.match(tooltip, /Smaller is never less safe/);
	assert.match(tooltip, /1 waiver/);
	assert.match(tooltip, /24 days left/);
});
