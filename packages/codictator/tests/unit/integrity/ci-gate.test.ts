import { strict as assert } from "node:assert";

import test from "node:test";

import type {
	CiWorkflow,
	ProtectionRead,
} from "../../../src/features/ci/index.ts";

import {
	checkActionsPinned,
	checkCi,
	evaluateProtection,
	FALLBACK_PINS,
	qualifyBotChange,
	resolveBaseRef,
} from "../../../src/features/ci/index.ts";

import type { CheckContext } from "../../../src/features/engine/index.ts";

import { FIXED_INSTANT } from "../../support/fake-clock.ts";

function ctxFor(): CheckContext {
	return {
		trigger: "scheduled",
		scope: { files: [], sessionId: "session-1" },
		now: FIXED_INSTANT,
		configHash: "config-hash",
	};
}

function externalWorkflow(): CiWorkflow {
	return { host: "external", os: ["ubuntu-latest"], steps: ["verify"] };
}

function healthyProtection(): ProtectionRead {
	return {
		readable: true,
		verifyRequired: true,
		allowSquashMerge: false,
		forcePushBlocked: true,
		deletionBlocked: true,
	};
}

const PINNED_SHA = FALLBACK_PINS.checkoutSha;

test("[§4.15.2] healthy gate reports nothing", async () => {
	// SPEC §4.15.2: reachable base, required verify, locked-down settings.
	const findings = await checkCi(ctxFor(), externalWorkflow(), {
		baseReachable: true,
		protection: healthyProtection(),
	});
	assert.equal(findings.length, 0);
});

test("[§4.15.2] unreadable protection advises twice", async () => {
	// SPEC §4.15.2: fork PRs with a read-only token degrade to advise (EC-1).
	const findings = evaluateProtection(undefined);
	assert.equal(findings.length, 2);
	assert.ok(
		findings.some((finding) => finding.ruleId === "core/ci-required-check"),
	);
	assert.ok(
		findings.some((finding) => finding.ruleId === "core/branch-protection"),
	);
});

test("[§4.15.2] verify not required blocks", async () => {
	// SPEC §4.15 EC-7: verify must be a required check on the default branch.
	const findings = evaluateProtection({
		...healthyProtection(),
		verifyRequired: false,
	});
	assert.ok(
		findings.some((finding) => finding.ruleId === "core/ci-required-check"),
	);
});

test("[§4.15.2] allowed squash merging blocks", async () => {
	// SPEC §4.9.3 + EC-11: squash must be off in settings and rulesets.
	const findings = evaluateProtection({
		...healthyProtection(),
		allowSquashMerge: true,
	});
	assert.ok(
		findings.some((finding) => finding.ruleId === "core/branch-protection"),
	);
});

test("[§4.15.2] ruleset without squash excludes it", async () => {
	// SPEC §4.9.3 S33: a ruleset whose merge methods omit squash is enough.
	const findings = evaluateProtection({
		readable: true,
		verifyRequired: true,
		allowSquashMerge: true,
		rulesetMergeMethods: ["merge"],
		forcePushBlocked: true,
		deletionBlocked: true,
	});
	assert.equal(findings.length, 0);
});

test("[§4.15.2] open force-push blocks", async () => {
	// SPEC §4.15.2: force-push and deletion stay blocked on the default branch.
	const findings = evaluateProtection({
		...healthyProtection(),
		forcePushBlocked: false,
	});
	assert.ok(
		findings.some((finding) => finding.ruleId === "core/branch-protection"),
	);
});

test("[§4.15.7] unreachable base fails closed", async () => {
	// SPEC §4.15.7 EC-2: a shallow clone despite config is CDX-E503.
	const result = resolveBaseRef({
		eventName: "push",
		reachable: false,
	});
	assert.equal(result.ok, false);
	assert.equal(
		result.ok === false ? result.error.code : "unexpected",
		"CDX-E503",
	);
});

test("[§4.15.7] pull request reads the event base", async () => {
	// SPEC §4.15.1 + EC-2: PRs use the event's base sha.
	const result = resolveBaseRef({
		eventName: "pull_request",
		pullBaseSha: "abc123",
	});
	assert.equal(result.ok, true);
	assert.equal(result.ok === true ? result.value : "unexpected", "abc123");
});

test("[§4.15.7] push reads before, or the merge-base", async () => {
	// SPEC §4.15.1 EC-3: pushes use before; a new branch uses the merge-base.
	const withBefore = resolveBaseRef({ eventName: "push", before: "def456" });
	assert.equal(withBefore.ok === true ? withBefore.value : "", "def456");
	const newBranch = resolveBaseRef({ eventName: "push" });
	assert.equal(
		newBranch.ok === true ? newBranch.value : "",
		"merge-base(main,HEAD)",
	);
});

test("[§4.15.7] schedule falls back to the merge-base", async () => {
	// SPEC §4.15.1: scheduled runs have no event base.
	const result = resolveBaseRef({ eventName: "schedule" });
	assert.equal(
		result.ok === true ? result.value : "unexpected",
		"merge-base(main,HEAD)",
	);
});

test("[§4.15.2] pinned actions report nothing", async () => {
	// SPEC §4.15.2: every uses: is a full SHA and images are digest-pinned.
	const findings = checkActionsPinned([
		{
			file: "a.yml",
			uses: `actions/checkout@${PINNED_SHA}`,
			image: "node:24@sha256:abc",
		},
	]);
	assert.equal(findings.length, 0);
});

test("[§4.15.2] unpinned uses blocks", async () => {
	// SPEC §4.15 EC-5: version tags without a SHA cannot merge.
	const findings = checkActionsPinned([
		{ file: "a.yml", uses: "actions/checkout@v4" },
	]);
	assert.ok(
		findings.some((finding) => finding.ruleId === "core/ci-actions-pinned"),
	);
});

test("[§4.15.2] uses without a ref blocks", async () => {
	// SPEC §4.15.2: a bare action name pins nothing.
	const findings = checkActionsPinned([
		{ file: "a.yml", uses: "actions/checkout" },
	]);
	assert.ok(
		findings.some((finding) => finding.ruleId === "core/ci-actions-pinned"),
	);
});

test("[§4.15.2] undigested image blocks", async () => {
	// SPEC §4.15 EC-5: container images pin by digest.
	const findings = checkActionsPinned([
		{
			file: "a.yml",
			uses: `actions/checkout@${PINNED_SHA}`,
			image: "node:24",
		},
	]);
	assert.ok(
		findings.some((finding) => finding.ruleId === "core/ci-actions-pinned"),
	);
});

test("[§4.15.3] unknown bot author does not qualify", async () => {
	// SPEC §4.15.3: only recognised bots (or exempt authors) skip the entry.
	const plan = qualifyBotChange({
		author: "human",
		filesChanged: ["package.json"],
		isFork: false,
		trailerExempt: [],
	});
	assert.equal(plan.qualifies, false);
	assert.equal(plan.writeCommit, false);
	assert.equal(plan.findings.length, 0);
});

test("[§4.15.3] bot touching code keeps the history entry", async () => {
	// SPEC §4.15.3: non-manifest files need the entry like any other change.
	const plan = qualifyBotChange({
		author: "renovate[bot]",
		filesChanged: ["package.json", "src/index.ts"],
		isFork: false,
		trailerExempt: [],
	});
	assert.equal(plan.qualifies, false);
	assert.equal(plan.findings.length, 1);
});

test("[§4.15.3] empty bot change keeps the history entry", async () => {
	// SPEC §4.15.3: no manifests touched means no qualification.
	const plan = qualifyBotChange({
		author: "renovate[bot]",
		filesChanged: [],
		isFork: false,
		trailerExempt: [],
	});
	assert.equal(plan.qualifies, false);
	assert.equal(plan.findings.length, 1);
});

test("[§4.15.3] fork bot change is recorded, never written", async () => {
	// SPEC §4.15.3 EC-8: fork PRs are never written to from the gate.
	const plan = qualifyBotChange({
		author: "dependabot[bot]",
		filesChanged: ["package-lock.json"],
		isFork: true,
		trailerExempt: [],
	});
	assert.equal(plan.qualifies, true);
	assert.equal(plan.writeCommit, false);
	assert.equal(plan.findings.length, 1);
});

test("[§4.15.3] manifest-only bot change qualifies", async () => {
	// SPEC §4.15.3: lockfile-only bot PRs get the history entry by commit.
	const plan = qualifyBotChange({
		author: "renovate[bot]",
		filesChanged: ["package.json", "pnpm-lock.yaml"],
		isFork: false,
		trailerExempt: [],
	});
	assert.equal(plan.qualifies, true);
	assert.equal(plan.writeCommit, true);
	assert.equal(plan.findings.length, 0);
});

test("[§4.15.3] exempt author counts as a recognised bot", async () => {
	// SPEC §4.14.2: trailerExempt covers bot accounts in both gates.
	const plan = qualifyBotChange({
		author: "team-bot",
		filesChanged: ["requirements.txt"],
		isFork: false,
		trailerExempt: ["team-bot"],
	});
	assert.equal(plan.qualifies, true);
	assert.equal(plan.writeCommit, true);
});
