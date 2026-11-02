// SPEC §4.3.2 + BUG-0014: gates judge pre-tool plus the diff-sound
// review subset over diff scopes. In-process evaluateGateScope calls over
// temp repos: assertions read the returned Result, never stdout (the
// runner shares process.stdout with TAP).
import { strict as assert } from "node:assert";
import test from "node:test";
import {
	evaluateGateScope,
	GATE_DIFF_UNSOUND_RULES,
	isGateDiffSound,
} from "../../../src/cli/gate-scope.ts";
import { portsFor } from "../../../src/cli/shared.ts";
import { FIXED_INSTANT } from "../../support/fake-clock.ts";
import { createTempRepo } from "../../support/temp-repo.ts";

// Split so no single committed line matches the kernel known-format scan;
// the runtime value is one contiguous `sk-…` key of 34 tail characters.
const VECTOR = ["sk-dogfood-rejected-", "0123456789abcdef"].join("");

test("[§4.3.2] gate diff scope marks spec-trace and dead-code diff-unsound", () => {
	// BUG-0014: spec-trace flags every normally-commented file on an empty
	// scope and dead-code false-positives without tree visibility, so both
	// stay on the human tree review while scoped readers stay on the gate.
	assert.ok(GATE_DIFF_UNSOUND_RULES.has("core/spec-trace"));
	assert.ok(GATE_DIFF_UNSOUND_RULES.has("core/dead-code"));
	assert.equal(isGateDiffSound("core/spec-trace"), false);
	assert.equal(isGateDiffSound("core/dead-code"), false);
	assert.equal(isGateDiffSound("core/no-secrets"), true);
	assert.equal(isGateDiffSound("core/max-file-bytes"), true);
	assert.equal(isGateDiffSound("core/history-entry"), true);
});

test("[§4.3.2] gate scope keeps the diff-sound review subset and drops the unsound rules", async () => {
	// BUG-0014: a normally-commented file with an unused export passes the
	// gate (no spec-trace, no dead-code) while a scope-local review-only
	// finding (max-file-bytes) still blocks.
	const repo = createTempRepo({
		"plain.js":
			"// SPEC §4.7 plain comment, no brackets\nexport const x = 1;\n",
		"big.js": `${"x".repeat(1048576 + 1)}\n`,
	});
	try {
		const ports = await portsFor(repo.dir);
		assert.equal(ports.ok, true);
		if (!ports.ok) {
			return;
		}
		const result = await evaluateGateScope(
			ports.value,
			[],
			{ files: ["plain.js", "big.js"], note: "gate subset" },
			FIXED_INSTANT,
			"hash",
		);
		assert.equal(result.ok, true);
		if (!result.ok) {
			return;
		}
		const ruleIds = result.value.map((finding) => finding.ruleId);
		assert.ok(!ruleIds.includes("core/spec-trace"));
		assert.ok(!ruleIds.includes("core/dead-code"));
		assert.ok(ruleIds.includes("core/max-file-bytes"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.3.2] gate scope dedupes findings shared by both families", async () => {
	// BUG-0014: rules with both triggers (core/no-secrets) run in each leg
	// over the same diff, so the merge keeps exactly one finding.
	const repo = createTempRepo({ "notes.txt": "hello\n" });
	try {
		const ports = await portsFor(repo.dir);
		assert.equal(ports.ok, true);
		if (!ports.ok) {
			return;
		}
		const result = await evaluateGateScope(
			ports.value,
			[],
			{
				files: ["notes.txt"],
				note: "gate dedupe",
				proposedContent: `const key = "${VECTOR}";\n`,
			},
			FIXED_INSTANT,
			"hash",
		);
		assert.equal(result.ok, true);
		if (!result.ok) {
			return;
		}
		const secrets = result.value.filter(
			(finding) => finding.ruleId === "core/no-secrets",
		);
		assert.equal(secrets.length, 1);
	} finally {
		repo.cleanup();
	}
});
