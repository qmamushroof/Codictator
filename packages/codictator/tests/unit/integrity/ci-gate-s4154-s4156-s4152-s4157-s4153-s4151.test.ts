import { strict as assert } from "node:assert";

import test from "node:test";

import type {
	CiWorkflow,
	ProtectionRead,
} from "../../../src/features/ci/index.ts";

import {
	checkCi,
	externalCiStatus,
	FALLBACK_PINS,
	planSweep,
	renderWorkflow,
	scheduleCronFor,
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
	// SPEC §4.15.7 EC-1: verify no-ops on pull_request; the required-check
	// rule only advises (message carries the advise signal for exit 0).
	const findings = await checkCi(ctxFor(), externalWorkflow(), {
		baseReachable: true,
		forkPr: true,
	});
	const fork = findings.find(
		(finding) =>
			finding.ruleId === "core/ci-required-check" &&
			finding.message.includes("fork"),
	);
	assert.ok(fork !== undefined);
	assert.ok(fork.message.includes("no-ops on pull_request"));
	assert.ok(fork.message.includes("advise"));
	assert.ok(fork.remediation.includes("by hand"));
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
	// binary on PATH pre-publish), invoking the built entry. Four jobs
	// (verify, record-bot-change, sweep, live) share the pins.
	const workflow = renderWorkflow("/repo", { repoName: "app" });
	const text = workflow.text ?? "";
	assert.ok(text.includes(`actions/checkout@${PINNED_SHA}`));
	assert.equal(text.split(`actions/checkout@${PINNED_SHA}`).length - 1, 4);
	assert.equal(
		text.split(`actions/setup-node@${FALLBACK_PINS.setupNodeSha}`).length - 1,
		4,
	);
	assert.ok(text.includes(`# ${FALLBACK_PINS.checkoutVersion}`));
	assert.ok(text.includes(`# ${FALLBACK_PINS.setupNodeVersion}`));
	assert.ok(
		text.includes("node packages/codictator/dist/cli/main.js ci verify"),
	);
	const invoke = text
		.split("\n")
		.filter((line) => line.includes("ci record-bot-change"));
	assert.equal(invoke.length, 1);
	assert.ok(invoke[0]?.includes(`\${record_args[@]}`));
	assert.ok(
		text.includes(`--author "\${{ github.event.pull_request.user.login }}"`),
	);
	assert.ok(text.includes("--files="));
	assert.ok(text.includes("--fork"));
	assert.ok(text.includes("git diff --name-only"));
	assert.ok(!text.includes("ci record-bot-change\n"));
	assert.ok(
		text.includes("node packages/codictator/dist/cli/main.js ci sweep"),
	);
	assert.ok(text.includes("  live:"));
	assert.ok(
		text.includes(
			"if: github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'",
		),
	);
	assert.ok(text.includes("issues: write"));
	assert.ok(text.includes("npm run build"));
	assert.ok(text.includes("fetch-depth: 0"));
	assert.ok(!text.includes("- run: codictator ci "));
	assert.ok(workflow.scheduleCron?.match(/^\d+ \d+ \* \* \*$/));
});

test("[§4.15 EC-12] verify reports SUCCESS on pull_request via a PR no-op; full verify stays on push, schedule, and dispatch", () => {
	// SPEC §4.15.1 + EC-12: no job-level skip — a skipped matrix job reports
	// `verify` (SKIPPED), never the required `verify (<os>)` matrix-leg name.
	// The expensive steps are gated off per step while a PR-only no-op step
	// reports SUCCESS, so the matrix leg resolves and the PR signal rides on
	// the test workflow's required-checks. Full verify stays on push,
	// schedule, and manual dispatch.
	const workflow = renderWorkflow("/repo", { repoName: "app" });
	const text = workflow.text ?? "";
	assert.ok(text.includes("  pull_request:"));
	const verifyAt = text.indexOf("  verify:");
	const recordAt = text.indexOf("  record-bot-change:");
	assert.ok(verifyAt >= 0 && verifyAt < recordAt);
	const verifyBlock = text.slice(verifyAt, recordAt);
	const stepsAt = verifyBlock.indexOf("    steps:");
	assert.ok(stepsAt >= 0);
	assert.ok(!verifyBlock.slice(0, stepsAt).includes("if: github.event_name"));
	assert.ok(verifyBlock.includes("ci verify"));
	assert.ok(verifyBlock.includes("if: github.event_name != 'pull_request'"));
	const noopAt = verifyBlock.indexOf("if: github.event_name == 'pull_request'");
	assert.ok(noopAt > stepsAt);
	const stepStart = verifyBlock.lastIndexOf("\n      - ", noopAt);
	assert.ok(stepStart >= 0);
	const noopStep = verifyBlock.slice(stepStart);
	assert.ok(!noopStep.includes("npm "));
	assert.ok(!noopStep.includes("checkout"));
	assert.ok(!noopStep.includes("ci verify"));
	assert.ok(
		text.includes(
			"if: github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'",
		),
	);
});

test("[§4.15.2] rendered github workflow passes the pin check", async () => {
	// SPEC §4.15.2: without caller uses evidence the gate reads the
	// rendered workflow's own pins, so the pinned template reports nothing.
	const workflow = renderWorkflow("/repo", { repoName: "app" });
	const findings = await checkCi(ctxFor(), workflow, {
		baseReachable: true,
		protection: healthyProtection(),
	});
	assert.ok(
		!findings.some((finding) => finding.ruleId === "core/ci-actions-pinned"),
	);
});

test("[§4.15.2] tag ref in the rendered text blocks the gate", async () => {
	// SPEC §4.15 EC-5: the default read judges the actual text, so a
	// version tag where a SHA belongs fails the merge.
	const workflow = renderWorkflow("/repo", { repoName: "app" });
	const tampered: CiWorkflow = {
		...workflow,
		text: (workflow.text ?? "").replaceAll(PINNED_SHA, "v4"),
	};
	const findings = await checkCi(ctxFor(), tampered, {
		baseReachable: true,
		protection: healthyProtection(),
	});
	assert.ok(
		findings.some((finding) => finding.ruleId === "core/ci-actions-pinned"),
	);
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
