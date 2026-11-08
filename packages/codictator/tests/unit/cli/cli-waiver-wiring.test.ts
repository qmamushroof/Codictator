// SPEC §4.2.1 step 4 + §4.3.3 step 3: waivers wired into evaluation.
// R1 pins the effective-param overlay; R2 pins the file-to-verdict seam
// through evaluateScope. Both fail while waivers.json never reaches an
// engine (BUG-0065).
import { strict as assert } from "node:assert";
import test from "node:test";
import { evaluateScope } from "../../../src/cli/evaluate.ts";
import { portsFor } from "../../../src/cli/shared.ts";
import { applyWaiverParams } from "../../../src/cli/waiver-params.ts";
import type { WaiverStore } from "../../../src/features/engine/index.ts";
import type {
	Instant,
	PackManifest,
	PackRule,
} from "../../../src/kernel/index.ts";
import { FIXED_INSTANT } from "../../support/fake-clock.ts";
import { createTempRepo } from "../../support/temp-repo.ts";

function capRule(tier: string): PackRule {
	return {
		id: "core/review-round-cap",
		family: "F9",
		tier,
		statement: "Reviews close within maxRounds rounds.",
		reason: "Unbounded review never lands.",
		remediation: "Land or escalate.",
		enforcer: "core/review-round-cap",
		triggers: ["review"],
		scope: [],
		params: {
			maxRounds: {
				type: "integer",
				default: 3,
				bound: 5,
				stricter: "lower",
			},
		},
		measureVersion: 1,
		fixtures: { violating: [], passing: [] },
	};
}

function miniManifest(): PackManifest {
	return {
		id: "core",
		version: "0.0.0",
		description: "mini manifest for the waiver overlay",
		rules: [capRule("tunable"), { ...capRule("floor"), id: "core/no-bypass" }],
		enforcers: [],
		drivers: [],
		extractors: [],
		measures: [],
		capabilities: [],
		assets: [],
		maxWaiverDays: 90,
	};
}

function waivedStore(): WaiverStore {
	return {
		waivers: [
			{
				id: "W-0001",
				rule: "core/review-round-cap",
				params: { maxRounds: 4 },
				reason: "fourth review round passed with zero blockers",
				created: "2026-01-01",
				expires: "2026-03-31",
				createdBy: "human",
			},
		],
		tiers: { "core/review-round-cap": "tunable", "core/no-bypass": "floor" },
		maxWaiverDays: 90,
	};
}

test("[§4.2.1] active waiver loosens the evaluated rule param within bound", () => {
	const out = applyWaiverParams(
		miniManifest(),
		waivedStore(),
		FIXED_INSTANT as Instant,
	);
	const cap = out.rules.find((rule) => rule.id === "core/review-round-cap");
	assert.equal(cap?.params["maxRounds"]?.default, 4);
	const floor = out.rules.find((rule) => rule.id === "core/no-bypass");
	assert.equal(floor?.params["maxRounds"]?.default, 3);
});

test("[§4.3.3] file waivers reach the verdict and ride waiversApplied", async () => {
	const big = `${"line\n".repeat(350)}`;
	const waivers = JSON.stringify({
		version: 1,
		maxWaiverDays: 90,
		waivers: [
			{
				id: "W-0001",
				rule: "core/file-size",
				params: { maxLines: 400 },
				reason: "generated file over the default limit for tests",
				created: "2026-01-01",
				expires: "2026-03-31",
				createdBy: "human",
			},
		],
	});
	const repo = createTempRepo({
		"big.ts": big,
		".codictator/waivers.json": waivers,
	});
	try {
		const ports = await portsFor(repo.dir);
		assert.equal(ports.ok, true);
		if (!ports.ok) {
			return;
		}
		const result = await evaluateScope(
			ports.value,
			["core"],
			{ trigger: "pre-tool", files: ["big.ts"], note: "test" },
			FIXED_INSTANT,
			"hash",
		);
		assert.equal(result.ok, true);
		if (!result.ok) {
			return;
		}
		assert.deepEqual(
			result.value.filter((finding) => finding.ruleId === "core/file-size"),
			[],
		);
	} finally {
		repo.cleanup();
	}
});
