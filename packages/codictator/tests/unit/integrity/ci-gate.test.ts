// SPEC §4.15: the CI merge gate over caller-supplied host data (reads are
// pure; the CLI fetches them through kernel ports). Plus SPEC §4.14.4 hook
// installation rendering, which is pure content generation.
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
	externalCiStatus,
	FALLBACK_PINS,
	planSweep,
	qualifyBotChange,
	renderWorkflow,
	resolveBaseRef,
	scheduleCronFor,
} from "../../../src/features/ci/index.ts";
import type { CheckContext } from "../../../src/features/engine/index.ts";
import {
	EXPECTED_HOOKS_PATH,
	hookInstallPlan,
	renderHookScript,
	renderHuskyBlock,
} from "../../../src/features/integrity/index.ts";
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

test("[§4.15.4] sweep updates one PR in place", async () => {
	// SPEC §4.15.4 EC-9: changes go to codictator/sweep, never the default.
	const open = planSweep({ sweepPrOpen: true, floorFindings: [] });
	assert.equal(open.pr, "codictator/sweep");
	assert.equal(open.action, "update-in-place");
	const fresh = planSweep({ sweepPrOpen: false, floorFindings: [] });
	assert.equal(fresh.action, "create");
});

test("[§4.15.4] sweep with fresh floor findings fails", async () => {
	// SPEC §4.15.4 EC-10: a new floor finding on the default branch fails.
	const finding = {
		ruleId: "core/guardrail-manifest",
		message: "drift",
		remediation: "regen",
	};
	const plan = planSweep({ sweepPrOpen: true, floorFindings: [finding] });
	assert.equal(plan.findings.length, 1);
});

test("[§4.15.6] external host without confirmation is unverified", async () => {
	// SPEC §4.15.6: without the human confirmation record the gate stays open.
	assert.equal(
		externalCiStatus({ host: "github", confirmed: false }).length,
		0,
	);
	assert.equal(
		externalCiStatus({ host: "external", confirmed: true }).length,
		0,
	);
	const findings = externalCiStatus({ host: "external", confirmed: false });
	assert.equal(findings.length, 1);
	assert.equal(findings[0]?.ruleId, "core/ci-present");
});

test("[§4.15.2] unpinned workflow steps block the gate", async () => {
	// SPEC §4.15 EC-5 through checkCi: unpinned uses: fail the merge.
	const findings = await checkCi(ctxFor(), externalWorkflow(), {
		baseReachable: true,
		protection: healthyProtection(),
		unpinnedUses: [{ file: "b.yml", uses: "actions/setup-node@v4" }],
	});
	assert.ok(
		findings.some((finding) => finding.ruleId === "core/ci-actions-pinned"),
	);
});

test("[§4.15.7] drifted workflow blocks the gate", async () => {
	// SPEC §4.15 EC-4: a hand-edited workflow differs from its manifest entry.
	const findings = await checkCi(ctxFor(), externalWorkflow(), {
		baseReachable: true,
		protection: healthyProtection(),
		workflowDrifted: true,
	});
	assert.ok(
		findings.some((finding) => finding.ruleId === "core/guardrail-manifest"),
	);
});

test("[§4.15.3] bot evidence flows through the gate", async () => {
	// SPEC §4.15.3: a bot PR touching code keeps the history-entry finding.
	const findings = await checkCi(ctxFor(), externalWorkflow(), {
		baseReachable: true,
		protection: healthyProtection(),
		botChange: {
			author: "renovate[bot]",
			filesChanged: ["src/index.ts"],
			isFork: false,
			trailerExempt: [],
		},
	});
	assert.ok(
		findings.some((finding) => finding.ruleId === "core/history-entry"),
	);
});

test("[§4.15.7] fork PR with a read-only token advises", async () => {
	// SPEC §4.15.7 EC-1: verify runs; the required-check rule only advises.
	const findings = await checkCi(ctxFor(), externalWorkflow(), {
		baseReachable: true,
		forkPr: true,
	});
	assert.ok(
		findings.some((finding) => finding.ruleId === "core/ci-required-check"),
	);
});

test("[§4.15.4] sweep evidence flows through the gate", async () => {
	// SPEC §4.15.4: fresh floor findings on the default branch fail visibly.
	const findings = await checkCi(ctxFor(), externalWorkflow(), {
		baseReachable: true,
		protection: healthyProtection(),
		sweep: {
			sweepPrOpen: false,
			floorFindings: [
				{
					ruleId: "core/guardrail-manifest",
					message: "drift",
					remediation: "regen",
				},
			],
		},
	});
	assert.ok(
		findings.some((finding) => finding.ruleId === "core/guardrail-manifest"),
	);
});

test("[§4.15.6] external evidence flows through the gate", async () => {
	// SPEC §4.15.6: an unconfirmed external host leaves the gate unverified.
	const findings = await checkCi(ctxFor(), externalWorkflow(), {
		baseReachable: true,
		protection: healthyProtection(),
		external: { host: "external", confirmed: false },
	});
	assert.ok(findings.some((finding) => finding.ruleId === "core/ci-present"));
});

test("[§4.15.1] rendered workflow pins and verifies", async () => {
	// SPEC §4.15.1 + §4.15.5: generated workflow pins actions by SHA and
	// every job bootstraps the CLI from the local checkout (no published
	// binary on PATH pre-publish), invoking the built entry.
	const workflow = renderWorkflow("/repo", { repoName: "app" });
	assert.ok(workflow.text?.includes(`actions/checkout@${PINNED_SHA}`));
	assert.ok(
		workflow.text?.includes(
			"node packages/codictator/dist/cli/main.js ci verify",
		),
	);
	assert.ok(
		workflow.text?.includes(
			"node packages/codictator/dist/cli/main.js ci record-bot-change",
		),
	);
	assert.ok(
		workflow.text?.includes(
			"node packages/codictator/dist/cli/main.js ci sweep",
		),
	);
	assert.ok(workflow.text?.includes("npm run build"));
	assert.ok(workflow.text?.includes("fetch-depth: 0"));
	assert.ok(!workflow.text?.includes("- run: codictator ci "));
	assert.ok(workflow.scheduleCron?.match(/^\d+ \d+ \* \* \*$/));
});

test("[§4.15.1] schedule cron is deterministic per repo", async () => {
	// SPEC §4.14 EC-11: regen is byte-identical, so the cron derives stably.
	assert.equal(scheduleCronFor("app"), scheduleCronFor("app"));
});

test("[§4.15.1] bot-less sweep keeps write permissions", async () => {
	// SPEC §4.15.1: with no bot owning upgrades the sweep stays writable.
	const withoutBot = renderWorkflow("/repo", { bot: "none" });
	assert.ok(withoutBot.text?.includes("pull-requests: write"));
	const withBot = renderWorkflow("/repo", { bot: "renovate" });
	assert.ok(!withBot.text?.includes("pull-requests: write"));
});

test("[§4.14.4] rendered hook guards node and execs the launcher", async () => {
	// SPEC §4.14.4: each hook verifies node, then execs run.mjs for its hook.
	const script = renderHookScript("pre-commit");
	assert.ok(script.startsWith("#!/bin/sh"));
	assert.ok(script.includes("CDX-E001"));
	assert.ok(script.includes("CDX-E002"));
	assert.ok(script.includes("git pre-commit"));
	assert.ok(script.endsWith("\n"));
	const older = renderHookScript("pre-push", 22);
	assert.ok(older.includes("v22"));
});

test("[§4.14.4] husky block names the hook", async () => {
	// SPEC §4.14.4: with .husky/ present Codictator inserts a managed block.
	const block = renderHuskyBlock("commit-msg");
	assert.ok(block.includes("codictator:begin"));
	assert.ok(block.includes("git commit-msg"));
	assert.ok(block.includes("codictator:end"));
});

test("[§4.14.4] install plan writes hooks with the exec bit", async () => {
	// SPEC §4.14.4 + EC-9/EC-12: mode 755, hooksPath, prepare script.
	const plan = hookInstallPlan();
	assert.equal(plan.hooksPath, EXPECTED_HOOKS_PATH);
	assert.equal(plan.mode, 0o755);
	assert.equal(plan.files.length, 3);
	assert.ok(plan.prepareScript.includes("install-hooks"));
	assert.ok(plan.gitattributes.includes("eol=lf"));
});

test("[§4.14.4] install plan defers to an existing husky setup", async () => {
	// SPEC §4.14.4: .husky/ present means blocks, not a hooks takeover.
	const plan = hookInstallPlan({
		huskyPresent: true,
		existingHooksPath: ".custom-hooks",
	});
	assert.equal(plan.files.length, 0);
	assert.equal(plan.hooksPath, ".custom-hooks");
	assert.equal(plan.huskyBlocks.length, 3);
});
