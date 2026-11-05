import { strict as assert } from "node:assert";

import test from "node:test";

import type { CheckContext } from "../../../src/features/engine/index.ts";

import {
	checkSelfProtection,
	isProtectedPath,
} from "../../../src/features/integrity/index.ts";

import { FIXED_INSTANT } from "../../support/fake-clock.ts";

function ctxFor(): CheckContext {
	return {
		trigger: "pre-tool",
		scope: { files: [], sessionId: "session-1" },
		now: FIXED_INSTANT,
		configHash: "config-hash",
	};
}

test("[§4.14.3] guardrail paths are protected", async () => {
	// SPEC §4.14.3 target rows: state, hooks and the generated workflow.
	assert.equal(isProtectedPath(".codictator"), true);
	assert.equal(isProtectedPath(".codictator/config.json"), true);
	assert.equal(isProtectedPath(".githooks"), true);
	assert.equal(isProtectedPath(".githooks/pre-commit"), true);
	assert.equal(isProtectedPath(".husky"), true);
	assert.equal(isProtectedPath(".husky/pre-commit"), true);
	assert.equal(isProtectedPath(".github/workflows/codictator.yml"), true);
	assert.equal(
		isProtectedPath(".github/workflows/codictator-nightly.yaml"),
		true,
	);
});

test("[§4.14.3] ordinary paths are not protected", async () => {
	// SPEC §4.14.3: harness config files stay editable (drift, EC-6).
	assert.equal(isProtectedPath("README.md"), false);
	assert.equal(isProtectedPath(".github/workflows/other.yml"), false);
	assert.equal(isProtectedPath(".claude/settings.json"), false);
});

test("[§4.14.3] separators and prefixes normalise before matching", async () => {
	// SPEC §4.14 EC-11: Windows separators cannot dodge the match.
	assert.equal(isProtectedPath(".codictator\\waivers.json"), true);
	assert.equal(isProtectedPath("./.codictator/config.json"), true);
});

test("[§4.14.3] agent delete of a hook blocks", async () => {
	// SPEC §4.14.3: writes, moves and deletes of guardrail paths go through
	// codictator commands, never agent tool calls.
	const findings = await checkSelfProtection(ctxFor(), [
		"delete",
		".githooks/pre-commit",
	]);
	assert.equal(findings.length, 1);
	assert.equal(findings[0]?.ruleId, "core/no-bypass");
});

test("[§4.14.3] agent write outside guardrail paths allows", async () => {
	// SPEC §4.14.3: only the listed targets are protected for agents.
	const findings = await checkSelfProtection(ctxFor(), ["write", "README.md"]);
	assert.equal(findings.length, 0);
});

test("[§4.14.3] agent read of a guardrail path allows", async () => {
	// SPEC §4.14.3: reads are not writes; L0 still needs them for regen.
	const findings = await checkSelfProtection(ctxFor(), [
		"read",
		".codictator/config.json",
	]);
	assert.equal(findings.length, 0);
});

test("[§4.14.3] git -c hooksPath override blocks", async () => {
	// SPEC §4.14.3: -c moves hooks away from the installed dir.
	const findings = await checkSelfProtection(ctxFor(), [
		"git",
		"-c",
		"core.hooksPath=.other",
		"status",
	]);
	assert.ok(findings.some((finding) => finding.ruleId === "core/no-bypass"));
});

test("[§4.14.3] git config hooksPath blocks", async () => {
	// SPEC §4.14.3: persisting the move blocks the same way.
	const findings = await checkSelfProtection(ctxFor(), [
		"git",
		"config",
		"core.hooksPath",
		".other",
	]);
	assert.ok(findings.some((finding) => finding.ruleId === "core/no-bypass"));
});

test("[§4.14.3] git push --no-verify blocks", async () => {
	// SPEC §4.14.3: skipping the pre-push gate is a bypass.
	const findings = await checkSelfProtection(ctxFor(), [
		"git",
		"push",
		"--no-verify",
	]);
	assert.ok(findings.some((finding) => finding.ruleId === "core/no-bypass"));
});

test("[§4.14.3] git rm of a guardrail path blocks", async () => {
	// SPEC §4.14.3: staged removal is still removal.
	const findings = await checkSelfProtection(ctxFor(), [
		"git",
		"rm",
		".githooks/pre-commit",
	]);
	assert.ok(findings.some((finding) => finding.ruleId === "core/no-bypass"));
});

test("[§4.14.3] chmod -x on hooks blocks", async () => {
	// SPEC §4.14.3: disarming the hook bit disables the gates.
	const findings = await checkSelfProtection(ctxFor(), [
		"chmod",
		"-x",
		".githooks/pre-commit",
	]);
	assert.ok(findings.some((finding) => finding.ruleId === "core/no-bypass"));
});

test("[§4.14.3] wrapped rm of a guardrail path blocks", async () => {
	// SPEC §4.14.3: the shell analyser sees through sh -c wrappers.
	const findings = await checkSelfProtection(ctxFor(), [
		"sh",
		"-c",
		"rm .codictator/config.json",
	]);
	assert.ok(findings.some((finding) => finding.ruleId === "core/no-bypass"));
});

test("[§4.14.3] gh workflow disable blocks", async () => {
	// SPEC §4.14.3: turning off the merge gate is a bypass.
	const findings = await checkSelfProtection(ctxFor(), [
		"gh",
		"workflow",
		"disable",
	]);
	assert.ok(findings.some((finding) => finding.ruleId === "core/no-bypass"));
});

test("[§4.14.3] gh api write to rulesets blocks", async () => {
	// SPEC §4.14.3: writes to branch protection or rulesets cannot skip L4.
	const findings = await checkSelfProtection(ctxFor(), [
		"gh",
		"api",
		"repos/acme/app/rulesets",
		"-X",
		"POST",
	]);
	assert.ok(findings.some((finding) => finding.ruleId === "core/no-bypass"));
});

test("[§4.14.3] gh api read of rulesets allows", async () => {
	// SPEC §4.14.3: GET reads do not change the gate.
	const findings = await checkSelfProtection(ctxFor(), [
		"gh",
		"api",
		"repos/acme/app/rulesets",
		"-X",
		"GET",
	]);
	assert.equal(findings.length, 0);
});

test("[§4.14.3] npm uninstall codictator blocks", async () => {
	// SPEC §4.14.3: removing the engine the gates run on is a bypass.
	const findings = await checkSelfProtection(ctxFor(), [
		"npm",
		"uninstall",
		"codictator",
	]);
	assert.ok(findings.some((finding) => finding.ruleId === "core/no-bypass"));
});
