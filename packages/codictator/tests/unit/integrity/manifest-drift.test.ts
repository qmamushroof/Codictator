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
