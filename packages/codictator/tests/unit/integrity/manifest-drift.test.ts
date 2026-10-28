// SPEC §4.14.1–§4.14.2: drift and tamper checks over caller-supplied
// snapshots. Each test builds a valid manifest via buildManifest and a
// working tree that matches it except for the one defect under test.
import { strict as assert } from "node:assert";
import test from "node:test";
import type { CheckContext } from "../../../src/features/engine/index.ts";
import type { DriftSnapshot } from "../../../src/features/integrity/index.ts";
import {
	buildManifest,
	checkDrift,
	EXPECTED_HOOKS_PATH,
} from "../../../src/features/integrity/index.ts";
import { sha256Text } from "../../../src/kernel/index.ts";
import { FIXED_INSTANT } from "../../support/fake-clock.ts";

function ctxFor(): CheckContext {
	return {
		trigger: "startup",
		scope: { files: [], sessionId: "session-1" },
		now: FIXED_INSTANT,
		configHash: "config-hash",
	};
}

function snapshotFor(
	files: ReadonlyArray<{ readonly path: string; readonly content: string }>,
	extra?: Partial<DriftSnapshot>,
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
		...extra,
	};
}

test("[§4.14.2] missing artifact is drift until regen", async () => {
	// SPEC §4.14.2: a manifest-listed file absent from the tree is floor.
	const content = "managed content\n";
	const manifest = buildManifest("0.0.0", [
		{
			path: "AGENTS.md",
			owner: "steering",
			mode: "file",
			hash: sha256Text(content),
		},
	]);
	const findings = await checkDrift(ctxFor(), manifest, snapshotFor([]));
	assert.equal(findings.length, 1);
	assert.equal(findings[0]?.ruleId, "core/guardrail-manifest");
	assert.equal(findings[0]?.path, "AGENTS.md");
});

test("[§4.14.2] changed artifact bytes are drift", async () => {
	// SPEC §4.14.2: a hash mismatch means a hand edit outside regen.
	const manifest = buildManifest("0.0.0", [
		{
			path: "AGENTS.md",
			owner: "steering",
			mode: "file",
			hash: sha256Text("before\n"),
		},
	]);
	const findings = await checkDrift(
		ctxFor(),
		manifest,
		snapshotFor([{ path: "AGENTS.md", content: "after\n" }]),
	);
	assert.equal(findings.length, 1);
	assert.equal(findings[0]?.ruleId, "core/guardrail-manifest");
});

test("[§4.14.2] managed block without markers is drift", async () => {
	// SPEC §4.14.2: a block artifact whose markers are gone cannot hash.
	const manifest = buildManifest("0.0.0", [
		{
			path: "AGENTS.md",
			owner: "steering",
			mode: "block",
			hash: sha256Text("x"),
		},
	]);
	const findings = await checkDrift(
		ctxFor(),
		manifest,
		snapshotFor([{ path: "AGENTS.md", content: "no markers here\n" }]),
	);
	assert.equal(findings.length, 1);
	assert.equal(findings[0]?.ruleId, "core/guardrail-manifest");
});

test("[§4.14.1] managed block bytes hash stably", async () => {
	// SPEC §4.14.1: block mode hashes the fenced block, not the whole file.
	const content =
		"# head\n<!-- codictator:begin -->\nowned\n<!-- codictator:end -->\nfoot\n";
	const begin = content.indexOf("<!-- codictator:begin -->");
	const end =
		content.indexOf("<!-- codictator:end -->") +
		"<!-- codictator:end -->".length;
	const manifest = buildManifest("0.0.0", [
		{
			path: "AGENTS.md",
			owner: "steering",
			mode: "block",
			hash: sha256Text(content.slice(begin, end)),
		},
	]);
	const findings = await checkDrift(
		ctxFor(),
		manifest,
		snapshotFor([{ path: "AGENTS.md", content }]),
	);
	assert.equal(findings.length, 0);
});

test("[§4.14.2] backslash snapshot paths match forward-slash artifacts", async () => {
	// SPEC §4.14 EC-11: enumeration order and OS separators cannot fake drift.
	const content = "managed content\n";
	const manifest = buildManifest("0.0.0", [
		{
			path: "a/b.md",
			owner: "steering",
			mode: "file",
			hash: sha256Text(content),
		},
	]);
	const findings = await checkDrift(
		ctxFor(),
		manifest,
		snapshotFor([{ path: "a\\b.md", content }]),
	);
	assert.equal(findings.length, 0);
});

test("[§4.14.2] edited manifest self hash is drift", async () => {
	// SPEC §4.14.2 + §7.14: the self hash covers the sorted artifacts array,
	// so editing the manifest outside regen is detectable.
	const content = "managed content\n";
	const manifest = buildManifest("0.0.0", [
		{
			path: "AGENTS.md",
			owner: "steering",
			mode: "file",
			hash: sha256Text(content),
		},
	]);
	const tampered = { ...manifest, hash: "tampered" };
	const findings = await checkDrift(
		ctxFor(),
		tampered,
		snapshotFor([{ path: "AGENTS.md", content }]),
	);
	assert.equal(findings.length, 1);
	assert.equal(findings[0]?.ruleId, "core/guardrail-manifest");
});

test("[§4.14.2] deleted installed hook is reported", async () => {
	// SPEC §4.14.6 EC-2: L0 and L4 report the deleted hook; L3 is gone.
	const content = "managed content\n";
	const manifest = buildManifest("0.0.0", [
		{
			path: "AGENTS.md",
			owner: "steering",
			mode: "file",
			hash: sha256Text(content),
		},
	]);
	const findings = await checkDrift(
		ctxFor(),
		manifest,
		snapshotFor([{ path: "AGENTS.md", content }], {
			installedHooks: [
				{ name: "pre-commit", executable: true },
				{ name: "commit-msg", executable: true },
			],
		}),
	);
	assert.equal(findings.length, 1);
	assert.equal(findings[0]?.ruleId, "core/hooks-active");
});

test("[§4.14.2] hook without the exec bit is reported", async () => {
	// SPEC §4.14.6 EC-12: a Windows commit can strip the bit.
	const content = "managed content\n";
	const manifest = buildManifest("0.0.0", [
		{
			path: "AGENTS.md",
			owner: "steering",
			mode: "file",
			hash: sha256Text(content),
		},
	]);
	const findings = await checkDrift(
		ctxFor(),
		manifest,
		snapshotFor([{ path: "AGENTS.md", content }], {
			installedHooks: [
				{ name: "pre-commit", executable: false },
				{ name: "commit-msg", executable: true },
				{ name: "pre-push", executable: true },
			],
		}),
	);
	assert.equal(findings.length, 1);
	assert.equal(findings[0]?.ruleId, "core/hooks-active");
});

test("[§4.14.2] reset hooks path is reported", async () => {
	// SPEC §4.14.6 EC-9: the hooks dir moved away from the installed one.
	const content = "managed content\n";
	const manifest = buildManifest("0.0.0", [
		{
			path: "AGENTS.md",
			owner: "steering",
			mode: "file",
			hash: sha256Text(content),
		},
	]);
	const findings = await checkDrift(
		ctxFor(),
		manifest,
		snapshotFor([{ path: "AGENTS.md", content }], {
			hooksPath: ".other-hooks",
		}),
	);
	assert.equal(findings.length, 1);
	assert.equal(findings[0]?.ruleId, "core/hooks-active");
});

test("[§4.14.2] hook without exec bit via the legacy flag is reported", async () => {
	// SPEC §4.14.6 EC-12 through the pre-list snapshot shape.
	const content = "managed content\n";
	const manifest = buildManifest("0.0.0", [
		{
			path: "AGENTS.md",
			owner: "steering",
			mode: "file",
			hash: sha256Text(content),
		},
	]);
	const snapshot: DriftSnapshot = {
		files: [{ path: "AGENTS.md", content }],
		hooksPath: EXPECTED_HOOKS_PATH,
		hooksExecutable: false,
		engineVersion: "0.0.0",
	};
	const findings = await checkDrift(ctxFor(), manifest, snapshot);
	assert.equal(findings.length, 1);
	assert.equal(findings[0]?.ruleId, "core/hooks-active");
});

test("[§4.14.2] engine version mismatch is drift", async () => {
	// SPEC §4.14.2 core/engine-version-match: installed ≠ config.
	const content = "managed content\n";
	const manifest = buildManifest("0.0.0", [
		{
			path: "AGENTS.md",
			owner: "steering",
			mode: "file",
			hash: sha256Text(content),
		},
	]);
	const findings = await checkDrift(
		ctxFor(),
		manifest,
		snapshotFor([{ path: "AGENTS.md", content }], {
			engineVersion: "9.9.9",
		}),
	);
	assert.equal(findings.length, 1);
	assert.equal(findings[0]?.ruleId, "core/engine-version-match");
});

test("[§4.14.2] missing launcher is drift", async () => {
	// SPEC §4.14.2: no installed engine found, so the check fails closed.
	const content = "managed content\n";
	const manifest = buildManifest("0.0.0", [
		{
			path: "AGENTS.md",
			owner: "steering",
			mode: "file",
			hash: sha256Text(content),
		},
	]);
	const snapshot: DriftSnapshot = {
		files: [{ path: "AGENTS.md", content }],
		hooksPath: EXPECTED_HOOKS_PATH,
		installedHooks: [
			{ name: "pre-commit", executable: true },
			{ name: "commit-msg", executable: true },
			{ name: "pre-push", executable: true },
		],
	};
	const findings = await checkDrift(ctxFor(), manifest, snapshot);
	assert.equal(findings.length, 1);
	assert.equal(findings[0]?.ruleId, "core/engine-version-match");
});
