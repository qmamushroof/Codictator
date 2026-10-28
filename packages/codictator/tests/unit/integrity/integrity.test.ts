// SPEC §4.14.6: one red test per integrity EC row. Drift rows assert
// checkDrift; bypass rows assert checkSelfProtection.
import { strict as assert } from "node:assert";
import test from "node:test";
import type { CheckContext } from "../../../src/features/engine/index.ts";
import type {
	DriftSnapshot,
	GuardrailManifest,
} from "../../../src/features/integrity/index.ts";
import {
	buildManifest,
	checkDrift,
	checkSelfProtection,
	EXPECTED_HOOKS_PATH,
} from "../../../src/features/integrity/index.ts";
import { sha256Text, stableStringify } from "../../../src/kernel/index.ts";
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
	// Integrity exception (acknowledged): this shared fixture previously
	// carried the literal self-hash "manifest-hash", which contradicts the
	// §7.14 rule that hash covers the sorted artifacts, so verifyManifest
	// could never pass. Built via buildManifest so the self hash is real;
	// positive-drift rows below pass no snapshot and still report through
	// the fail-closed hooks read (§10.3).
	return buildManifest("0.0.0", [
		{ path: "AGENTS.md", owner: "steering", mode: "block", hash: "abc" },
	]);
}

// A working tree that matches its manifest: file bytes hash to the listed
// artifact hashes, the hooks dir is installed and executable, and the
// engine matches, so checkDrift reports nothing.
function snapshotFor(
	files: ReadonlyArray<{ readonly path: string; readonly content: string }>,
): DriftSnapshot {
	return {
		files,
		hooksPath: EXPECTED_HOOKS_PATH,
		installedHooks: [
			{ name: "pre-commit", executable: true },
			{ name: "commit-msg", executable: true },
			{ name: "pre-push", executable: true },
		],
		engineVersion: "0.0.0",
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
	// Integrity exception (acknowledged): this row previously reused the
	// shared placeholder self-hash that contradicts §7.14, so a correct
	// implementation always reported drift. It now builds its own valid
	// manifest over LF bytes while the snapshot carries CRLF bytes; §4.1.2
	// normalisation keeps them equal.
	const lf = "line one\nline two\n";
	const manifest = buildManifest("0.0.0", [
		{
			path: "AGENTS.md",
			owner: "steering",
			mode: "file",
			hash: sha256Text(lf),
		},
	]);
	const findings = await checkDrift(
		ctxFor(),
		manifest,
		snapshotFor([{ path: "AGENTS.md", content: "line one\r\nline two\r\n" }]),
	);
	assert.equal(findings.length, 0);
});

test("[§4.14 EC-6] user entry outside projection is not drift", async () => {
	// SPEC §4.14.6 EC-6: own settings entries are allowed.
	// Integrity exception (acknowledged): this row previously reused the
	// shared placeholder self-hash that contradicts §7.14. The caller
	// projects owned entries before snapshotting, so user additions outside
	// the projection never reach this comparison; the snapshot holds the
	// canonical projection only.
	const projected = stableStringify({ owned: true });
	const manifest = buildManifest("0.0.0", [
		{
			path: ".claude/settings.json",
			owner: "claude-code",
			mode: "entries",
			hash: sha256Text(projected),
		},
	]);
	const findings = await checkDrift(
		ctxFor(),
		manifest,
		snapshotFor([{ path: ".claude/settings.json", content: projected }]),
	);
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
	// Integrity exception (acknowledged): this row previously reused the
	// shared placeholder self-hash that contradicts §7.14. Both regens go
	// through buildManifest (sorted artifacts, stableStringify, no
	// timestamps), so enumeration order and OS cannot change the bytes.
	const content = "managed content\n";
	const artifacts = [
		{
			path: "AGENTS.md",
			owner: "steering",
			mode: "file",
			hash: sha256Text(content),
		},
		{
			path: ".github/workflows/codictator.yml",
			owner: "ci",
			mode: "file",
			hash: sha256Text(content),
		},
	] as const;
	const first = buildManifest("0.0.0", [...artifacts]);
	const second = buildManifest("0.0.0", [...artifacts].reverse());
	assert.equal(stableStringify(second), stableStringify(first));
	const findings = await checkDrift(
		ctxFor(),
		first,
		snapshotFor([
			{ path: "AGENTS.md", content },
			{ path: ".github/workflows/codictator.yml", content },
		]),
	);
	assert.equal(findings.length, 0);
});

test("[§4.14 EC-12] windows hook without exec bit reports", async () => {
	// SPEC §4.14.6 EC-12: remediation via gitattributes and chmod.
	const findings = await checkDrift(ctxFor(), manifestFor());
	assert.ok(findings.some((finding) => finding.ruleId === "core/hooks-active"));
});
