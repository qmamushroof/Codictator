// SPEC §4.14.3: self-protection (L1, core/no-bypass). Commands are matched
// by the shell analyser, so wrappers do not hide them, and the package
// manifest and trailer checks close the remaining bypass shapes.
import { strict as assert } from "node:assert";
import test from "node:test";
import type { CheckContext } from "../../../src/features/engine/index.ts";
import {
	checkCommitTrailers,
	checkPackageManifestEdit,
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

test("[§4.14.3] human-only waive by an agent blocks", async () => {
	// SPEC §4.19.2: human-only commands are blocked for agents.
	const findings = await checkSelfProtection(ctxFor(), [
		"codictator",
		"waive",
		"W-0001",
	]);
	assert.ok(findings.some((finding) => finding.ruleId === "core/no-bypass"));
});

test("[§4.14.3] bare human-only init by an agent blocks", async () => {
	// SPEC §4.19.2: single-word human-only commands block too.
	const findings = await checkSelfProtection(ctxFor(), ["codictator", "init"]);
	assert.ok(findings.some((finding) => finding.ruleId === "core/no-bypass"));
});

test("[§4.14.3] agent status command allows", async () => {
	// SPEC §4.19.2: status is not human-only; L0 leaves it available.
	const findings = await checkSelfProtection(ctxFor(), [
		"codictator",
		"status",
	]);
	assert.equal(findings.length, 0);
});

test("[§4.14.3] shell wrapper without -c is still analysed", async () => {
	// SPEC §4.14.3: bare `bash <command>` does not hide the bypass.
	const findings = await checkSelfProtection(ctxFor(), [
		"bash",
		"git",
		"commit",
		"-n",
		"-m",
		"x",
	]);
	assert.ok(findings.some((finding) => finding.ruleId === "core/no-bypass"));
});

test("[§4.14.3] raw --no-verify flag backstops the parse", async () => {
	// SPEC §4.7.2: the raw token scan catches shapes the parse missed.
	const findings = await checkSelfProtection(ctxFor(), ["echo", "--no-verify"]);
	assert.ok(findings.some((finding) => finding.ruleId === "core/no-bypass"));
});

test("[§4.14.3] raw commit -n shape backstops the parse", async () => {
	// SPEC §4.7.2: short-flag bypasses are caught as raw text too, even
	// embedded in a longer wrapped command the parse does not flag.
	const findings = await checkSelfProtection(ctxFor(), [
		"echo",
		"wrap",
		"git",
		"fetch",
		"commit",
		"amend",
		"-n",
		"now",
	]);
	assert.ok(findings.some((finding) => finding.ruleId === "core/no-bypass"));
});

test("[§4.14.3] raw hooksPath text backstops the parse", async () => {
	// SPEC §4.7.2: moving hooks away is caught even as plain text.
	const findings = await checkSelfProtection(ctxFor(), [
		"echo",
		"core.hooksPath",
	]);
	assert.ok(findings.some((finding) => finding.ruleId === "core/no-bypass"));
});

test("[§4.14.3] raw HUSKY=0 assignment backstops the parse", async () => {
	// SPEC §4.14.3: env assignments cannot switch the gates off.
	const findings = await checkSelfProtection(ctxFor(), ["echo", "HUSKY=0"]);
	assert.ok(findings.some((finding) => finding.ruleId === "core/no-bypass"));
});

test("[§4.14.3] raw workflow disable text backstops the parse", async () => {
	// SPEC §4.7.2: the merge gate cannot be talked away.
	const findings = await checkSelfProtection(ctxFor(), [
		"echo",
		"workflow",
		"disable",
	]);
	assert.ok(findings.some((finding) => finding.ruleId === "core/no-bypass"));
});

test("[§4.14.3] unparseable shell blocks fail-closed", async () => {
	// SPEC §4.7.2: parse failure alone never becomes an allow.
	const findings = await checkSelfProtection(ctxFor(), [
		"bash",
		"-c",
		"echo 'unclosed",
	]);
	assert.ok(
		findings.some((finding) => finding.ruleId === "core/dangerous-shell"),
	);
});

test("[§4.14.3] removing the codictator dev dependency blocks", async () => {
	// SPEC §4.14.3 manifests row: the pin is self-protection, not drift.
	const before = '{"devDependencies": {"codictator": "1.0.0"}}';
	const after = '{"devDependencies": {}}';
	const findings = checkPackageManifestEdit(before, after);
	assert.equal(findings.length, 1);
	assert.equal(findings[0]?.ruleId, "core/no-bypass");
});

test("[§4.14.3] changing the codictator dev dependency blocks", async () => {
	// SPEC §4.14.3: a version change outside the upgrade bot is a bypass.
	const before = '{"devDependencies": {"codictator": "1.0.0"}}';
	const after = '{"devDependencies": {"codictator": "2.0.0"}}';
	const findings = checkPackageManifestEdit(before, after);
	assert.equal(findings.length, 1);
});

test("[§4.14.3] untouched package manifest allows", async () => {
	// SPEC §4.14.3: identical pins are not self-protection drift.
	const text = '{"devDependencies": {"codictator": "1.0.0"}}';
	assert.equal(checkPackageManifestEdit(text, text).length, 0);
	assert.equal(checkPackageManifestEdit("not json", text).length, 0);
	assert.equal(checkPackageManifestEdit("123", text).length, 0);
	assert.equal(checkPackageManifestEdit("{}", text).length, 0);
	assert.equal(
		checkPackageManifestEdit('{"devDependencies": {}}', text).length,
		0,
	);
});

test("[§4.14.3] commit without the trailer blocks", async () => {
	// SPEC §4.14.2 core/no-bypass at L4: every non-merge commit in range
	// carries the Codictator-L3 trailer that commit-msg adds.
	const findings = checkCommitTrailers(
		[{ sha: "abc", message: "fix: a bug", author: "human", isMerge: false }],
		[],
	);
	assert.equal(findings.length, 1);
	assert.equal(findings[0]?.ruleId, "core/no-bypass");
});

test("[§4.14.3] commit with the trailer allows", async () => {
	// SPEC §4.14.2: the trailer proves the commit-msg gate ran.
	const findings = checkCommitTrailers(
		[
			{
				sha: "abc",
				message: "fix: a bug\n\nCodictator-L3: deadbeef",
				author: "human",
				isMerge: false,
			},
		],
		[],
	);
	assert.equal(findings.length, 0);
});

test("[§4.14.3] merge and exempt commits skip the trailer", async () => {
	// SPEC §4.14.2: merges need no trailer; trailerExempt covers bot authors.
	const findings = checkCommitTrailers(
		[
			{ sha: "m", message: "merge", author: "human", isMerge: true },
			{ sha: "b", message: "chore: bump", author: "bot", isMerge: false },
		],
		["bot"],
	);
	assert.equal(findings.length, 0);
});
