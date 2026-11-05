import { strict as assert } from "node:assert";

import test from "node:test";

import type {
	ImportRef,
	ModuleNode,
} from "../../../src/features/arch/index.ts";

import { checkArch, deriveModules } from "../../../src/features/arch/index.ts";

import type { CheckContext } from "../../../src/features/engine/index.ts";

import { FIXED_INSTANT } from "../../support/fake-clock.ts";

function ctxFor(files: Array<string> = []): CheckContext {
	return {
		trigger: "pre-tool",
		scope: { files, sessionId: "session-1" },
		now: FIXED_INSTANT,
		configHash: "config-hash",
	};
}

function ref(from: string, to: string, line = 1): ImportRef {
	return { from, to, line };
}

function feature(name: string, dependsOn: Array<string> = []): ModuleNode {
	return { name, path: `src/features/${name}/**`, dependsOn };
}

test("[§4.11] core/arch-boundaries identical edges report once", async () => {
	// SPEC §4.11.4: duplicate refs dedupe to one finding.
	const findings = await checkArch(
		ctxFor(),
		[
			ref("src/features/a/index.ts", "src/features/b/index.ts"),
			ref("src/features/a/index.ts", "src/features/b/index.ts"),
		],
		{ modules: [feature("a"), feature("b")] },
	);
	assert.equal(findings.length, 1);
});

test("[§4.11] core/arch-boundaries derives modules when the map is absent", async () => {
	// SPEC §4.11.4: without a configured map every cross-module edge fails closed.
	assert.ok(deriveModules([]).length === 0);
	const findings = await checkArch(ctxFor(), [
		ref("src/features/a/index.ts", "src/features/b/index.ts"),
	]);
	assert.ok(
		findings.some((finding) => finding.ruleId === "core/arch-boundaries"),
	);
});
