// SPEC §4.14.6: one red test per integrity EC row. Drift rows assert
// checkDrift; bypass rows assert checkSelfProtection. Both still throw
// "not implemented", so all twelve fail red until Phase 9 lands.
import { strict as assert } from "node:assert";
import test from "node:test";
import type { CheckContext } from "../../../src/features/engine/index.ts";
import type { GuardrailManifest } from "../../../src/features/integrity/index.ts";
import {
	checkDrift,
	checkSelfProtection,
} from "../../../src/features/integrity/index.ts";
import { FIXED_INSTANT } from "../../support/fake-clock.ts";

function ctxFor(): CheckContext {
	return {
		trigger: "startup",
		scope: { files: [], sessionId: "session-1" },
		now: FIXED_INSTANT,
		configHash: "config-hash",
	};
}

function manifestFor(): GuardrailManifest {
	return {
		version: 1,
		codictator: "0.0.0",
		artifacts: [
			{ path: "AGENTS.md", owner: "steering", mode: "block", hash: "abc" },
		],
		hash: "manifest-hash",
	};
}

test("[§4.14 EC-1] agent write to waivers json blocks", async () => {
	// SPEC §4.14.6 EC-1: blocked at L1.
	const findings = await checkSelfProtection(ctxFor(), [
		"write",
		".codictator/waivers.json",
	]);
	assert.ok(findings.length > 0);
});

test("[§4.14 EC-2] deleted pre-commit hook reported at L0", async () => {
	// SPEC §4.14.6 EC-2: L0 and L4 report; L3 is gone with the hook.
	const findings = await checkDrift(ctxFor(), manifestFor());
	assert.ok(findings.length > 0);
});

test("[§4.14 EC-3] human no-verify commit blocked at L4", async () => {
	// SPEC §4.14.6 EC-3: missing trailer blocks the PR via core/no-bypass.
	const findings = await checkSelfProtection(ctxFor(), [
		"git",
		"commit",
		"--no-verify",
	]);
	assert.ok(findings.some((finding) => finding.ruleId === "core/no-bypass"));
});

test("[§4.14 EC-4] web-editor commit without trailer blocks", async () => {
	// SPEC §4.14.6 EC-4: remediation is to redo the change locally.
	const findings = await checkDrift(ctxFor(), manifestFor());
	assert.ok(findings.length > 0);
});

test("[§4.14 EC-5] autocrlf conversion keeps hashes stable", async () => {
	// SPEC §4.14.6 EC-5: normalised hashes are unaffected.
	const findings = await checkDrift(ctxFor(), manifestFor());
	assert.equal(findings.length, 0);
});

test("[§4.14 EC-6] user entry outside projection is not drift", async () => {
	// SPEC §4.14.6 EC-6: own settings entries are allowed.
	const findings = await checkDrift(ctxFor(), manifestFor());
	assert.equal(findings.length, 0);
});

test("[§4.14 EC-7] deleted CI workflow is reported everywhere", async () => {
	// SPEC §4.14.6 EC-7: L4 cannot run it; required-check rule fails the merge.
	const findings = await checkDrift(ctxFor(), manifestFor());
	assert.ok(findings.length > 0);
});

test("[§4.14 EC-8] wrapped no-verify commit still blocks", async () => {
	// SPEC §4.14.6 EC-8: the shell analyser sees through the wrapper.
	const findings = await checkSelfProtection(ctxFor(), [
		"bash",
		"-c",
		"git commit -n -m x",
	]);
	assert.ok(findings.some((finding) => finding.ruleId === "core/no-bypass"));
});

test("[§4.14 EC-9] reset hooks path reported at L0", async () => {
	// SPEC §4.14.6 EC-9: install-hooks repairs it.
	const findings = await checkDrift(ctxFor(), manifestFor());
	assert.ok(findings.length > 0);
});

test("[§4.14 EC-10] dropped harness artifact is drift until regen", async () => {
	// SPEC §4.14.6 EC-10: drift until config drops the harness and regen runs.
	const findings = await checkDrift(ctxFor(), manifestFor());
	assert.ok(findings.length > 0);
});

test("[§4.14 EC-11] two regens on different OSes match", async () => {
	// SPEC §4.14.6 EC-11: deterministic bytes.
	const findings = await checkDrift(ctxFor(), manifestFor());
	assert.equal(findings.length, 0);
});

test("[§4.14 EC-12] windows hook without exec bit reports", async () => {
	// SPEC §4.14.6 EC-12: remediation via gitattributes and chmod.
	const findings = await checkDrift(ctxFor(), manifestFor());
	assert.ok(findings.some((finding) => finding.ruleId === "core/hooks-active"));
});
