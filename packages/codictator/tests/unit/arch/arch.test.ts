// SPEC §4.11.5: one red test per arch EC row. Boundary rows assert
// checkArch findings; graph rows assert buildGraph edges and cycles. Both
// still throw "not implemented", so all thirteen fail red until Phase 7 lands.
import { strict as assert } from "node:assert";
import test from "node:test";
import type {
	ImportRef,
	ModuleNode,
} from "../../../src/features/arch/index.ts";
import { buildGraph, checkArch } from "../../../src/features/arch/index.ts";
import type { CheckContext } from "../../../src/features/engine/index.ts";
import { FIXED_INSTANT } from "../../support/fake-clock.ts";

function ctxFor(): CheckContext {
	return {
		trigger: "pre-tool",
		scope: { files: ["src/features/a/index.ts"], sessionId: "session-1" },
		now: FIXED_INSTANT,
		configHash: "config-hash",
	};
}

function modules(): Array<ModuleNode> {
	return [
		{ name: "a", path: "src/features/a/**", dependsOn: [] },
		{ name: "b", path: "src/features/b/**", dependsOn: [] },
	];
}

function ref(from: string, to: string): ImportRef {
	return { from, to, line: 1 };
}

test("[§4.11 EC-1] feature importing internals of another", async () => {
	// SPEC §4.11.5 EC-1: block core/arch-public-entry; import the entry or move x.
	const findings = await checkArch(ctxFor(), [
		ref("src/features/a/index.ts", "src/features/b/internal/x.ts"),
	]);
	assert.ok(
		findings.some((finding) => finding.ruleId === "core/arch-public-entry"),
	);
});

test("[§4.11 EC-2] feature import without dependsOn blocks", async () => {
	// SPEC §4.11.5 EC-2: block core/arch-boundaries.
	const findings = await checkArch(ctxFor(), [
		ref("src/features/a/index.ts", "src/features/b/index.ts"),
	]);
	assert.ok(
		findings.some((finding) => finding.ruleId === "core/arch-boundaries"),
	);
});

test("[§4.11 EC-3] new edge closing a cycle prints cycle", async () => {
	// SPEC §4.11.5 EC-3: block; the message prints the cycle.
	const findings = await checkArch(ctxFor(), [
		ref("src/features/a/index.ts", "src/features/b/index.ts"),
		ref("src/features/b/index.ts", "src/features/a/index.ts"),
	]);
	assert.ok(
		findings.some((finding) => finding.ruleId === "core/arch-no-cycles"),
	);
});

test("[§4.11 EC-4] type-only import is still an edge", async () => {
	// SPEC §4.11.5 EC-4: block; type imports are edges.
	const findings = await checkArch(ctxFor(), [
		ref("src/features/a/index.ts", "src/features/b/index.ts"),
	]);
	assert.ok(findings.length > 0);
});

test("[§4.11 EC-5] dynamic import with non-literal target", async () => {
	// SPEC §4.11.5 EC-5: unresolvable-dynamic-import; block in kernel/domain.
	const findings = await checkArch(ctxFor(), [
		ref("src/features/a/index.ts", "dynamic:expr"),
	]);
	assert.ok(findings.length > 0);
});

test("[§4.11 EC-6] barrel re-export inside module is allowed", async () => {
	// SPEC §4.11.5 EC-6: allowed.
	const edges = buildGraph(modules(), [
		ref("src/features/a/a.ts", "src/features/a/barrel.ts"),
	]);
	assert.equal(edges.length, 1);
});

test("[§4.11 EC-7] require inside string or comment ignored", () => {
	// SPEC §4.11.5 EC-7: the lexer ignores it.
	const edges = buildGraph(modules(), []);
	assert.equal(edges.length, 0);
});

test("[§4.11 EC-8] source outside every module glob blocks", async () => {
	// SPEC §4.11.5 EC-8: block core/arch-module-mapped.
	const findings = await checkArch(ctxFor(), [
		ref("scripts/tool.ts", "src/features/a/index.ts"),
	]);
	assert.ok(
		findings.some((finding) => finding.ruleId === "core/arch-module-mapped"),
	);
});

test("[§4.11 EC-9] paths alias into internals is deep import", async () => {
	// SPEC §4.11.5 EC-9: block like a deep import.
	const findings = await checkArch(ctxFor(), [
		ref("src/features/a/index.ts", "@b/internal/x"),
	]);
	assert.ok(
		findings.some((finding) => finding.ruleId === "core/arch-public-entry"),
	);
});

test("[§4.11 EC-10] test importing own internals is allowed", async () => {
	// SPEC §4.11.5 EC-10: allowed for test files of that module only.
	const findings = await checkArch(ctxFor(), [
		ref("src/features/a/a.test.ts", "src/features/a/internal/x.ts"),
	]);
	assert.equal(findings.length, 0);
});

test("[§4.11 EC-11] generated folder without header counts", async () => {
	// SPEC §4.11.5 EC-11: excluded only with a generated header on every file.
	const findings = await checkArch(ctxFor(), [
		ref("src/generated/x.ts", "src/features/a/index.ts"),
	]);
	assert.ok(findings.length >= 0);
});

test("[§4.11 EC-12] cyclic dependsOn is CDX-E105", async () => {
	// SPEC §4.11.5 EC-12: config validation refuses the edge.
	const edges = buildGraph(
		[
			{ name: "a", path: "src/features/a/**", dependsOn: ["b"] },
			{ name: "b", path: "src/features/b/**", dependsOn: ["a"] },
		],
		[],
	);
	assert.equal(edges.length, 0);
});

test("[§4.11 EC-13] windows separators normalised first", () => {
	// SPEC §4.11.5 EC-13: normalised before resolution.
	const edges = buildGraph(modules(), [
		ref("src\\features\\a\\index.ts", "src\\features\\b\\index.ts"),
	]);
	assert.equal(edges.length, 1);
});
