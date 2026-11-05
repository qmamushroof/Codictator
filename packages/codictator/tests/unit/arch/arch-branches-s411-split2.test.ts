import { strict as assert } from "node:assert";

import test from "node:test";

import {
	assignModule,
	isBuiltinSpecifier,
	isRelativeSpecifier,
	moduleBase,
	normalizeImportPath,
	normalizeSeparators,
	parseGraphCache,
	resolveAliasSpecifier,
	resolveImportTarget,
	resolveRelativeSpecifier,
	updateGraphCache,
} from "../../../src/features/arch/graph.ts";

import type {
	ImportRef,
	ModuleNode,
} from "../../../src/features/arch/index.ts";

import { buildGraph, checkArch } from "../../../src/features/arch/index.ts";

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

test("[§4.11] graph path helpers collapse segments and honour first match", () => {
	// SPEC §4.11.3: lexical normalisation never touches the disk.
	assert.equal(normalizeImportPath("/a/./b/../c"), "/a/c");
	assert.equal(normalizeImportPath("a//b"), "a/b");
	assert.equal(
		resolveRelativeSpecifier("src/features/a/x.ts", "./y.ts"),
		"src/features/a/y.ts",
	);
	assert.equal(
		resolveRelativeSpecifier("src/features/a/x.ts", "../b/z.ts"),
		"src/features/b/z.ts",
	);
	assert.equal(
		resolveRelativeSpecifier("src\\features\\a\\x.ts", ".\\y.ts"),
		"src/features/a/y.ts",
	);
	assert.equal(isRelativeSpecifier("./x"), true);
	assert.equal(isRelativeSpecifier("pkg"), false);
	assert.equal(isBuiltinSpecifier("node:fs"), true);
	assert.equal(isBuiltinSpecifier("node"), true);
	assert.equal(isBuiltinSpecifier("fs"), false);
	assert.equal(normalizeSeparators("a\\b/c"), "a/b/c");
	assert.equal(
		moduleBase({ name: "a", path: "src/features/a/**", dependsOn: [] }),
		"src/features/a",
	);
	const first = feature("a");
	assert.equal(
		assignModule([first, feature("b")], "src/features/a/x.ts"),
		first,
	);
	assert.equal(assignModule([first], "src/elsewhere/x.ts"), undefined);
});

test("[§4.11] graph alias specifiers resolve only declared modules", () => {
	// SPEC §4.11.3: an @name/... specifier names a module only when declared.
	const modules = [feature("a"), feature("b")];
	assert.equal(
		resolveAliasSpecifier(modules, "@b/internal/x"),
		"src/features/b/internal/x",
	);
	assert.equal(resolveAliasSpecifier(modules, "@nope/x"), undefined);
	assert.equal(resolveAliasSpecifier(modules, "pkg/x"), undefined);
	assert.equal(resolveAliasSpecifier(modules, "@b"), undefined);
	assert.equal(
		resolveImportTarget(modules, "src/features/a/x.ts", "lodash"),
		"lodash",
	);
	assert.equal(
		resolveImportTarget(modules, "src/features/a/x.ts", "pkg/sub/../x"),
		"pkg/x",
	);
	assert.equal(
		resolveImportTarget(modules, "src/features/a/x.ts", "/abs/../x.ts"),
		"/x.ts",
	);
});

test("[§4.11] graph buildGraph dedupes and sorts resolved edges", () => {
	// SPEC §4.11.3: construction is pure, deterministic and duplicate-free.
	const modules = [feature("a"), feature("b")];
	const edges = buildGraph(modules, [
		ref("src/features/b/index.ts", "src/features/a/index.ts", 2),
		ref("src/features/a/index.ts", "src/features/b/index.ts", 1),
		ref("src/features/a/index.ts", "src/features/b/index.ts", 1),
	]);
	assert.equal(edges.length, 2);
	assert.equal(edges[0]?.from, "src/features/a/index.ts");
});

test("[§4.11] graph buildGraph orders ties by target then line", () => {
	// SPEC §4.11.3: deterministic order keeps L1 findings stable. The
	// duplicate key carries the line, so same-edge lines both stay, sorted.
	const modules = [feature("a"), feature("b"), feature("c")];
	const edges = buildGraph(modules, [
		ref("src/features/a/index.ts", "src/features/c/index.ts", 1),
		ref("src/features/a/index.ts", "src/features/b/index.ts", 5),
		ref("src/features/a/index.ts", "src/features/b/index.ts", 2),
	]);
	assert.deepEqual(
		edges.map((edge) => [edge.to, edge.line]),
		[
			["src/features/b/index.ts", 2],
			["src/features/b/index.ts", 5],
			["src/features/c/index.ts", 1],
		],
	);
});

test("[§4.11] graph parentDir and aliases resolve declared modules", () => {
	// SPEC §4.11.3: relative targets resolve against the importer.
	assert.equal(resolveImportTarget([feature("a")], "a.ts", "./b.ts"), "b.ts");
	assert.equal(resolveRelativeSpecifier("/x.ts", "./y.ts"), "/y.ts");
	assert.equal(
		resolveImportTarget([feature("b")], "src/features/a/x.ts", "@b/internal/x"),
		"src/features/b/internal/x",
	);
});

test("[§4.11] graph updateGraphCache skips repeated paths", () => {
	// SPEC §4.11.3: a repeated path in one scan contributes once.
	const extract = (path: string, _text: string): Array<ImportRef> => [
		{ from: path, to: "b", line: 1 },
	];
	const { refs } = updateGraphCache(
		{ version: 1, entries: {} },
		[
			{ path: "src/a.ts", text: "x" },
			{ path: "src/a.ts", text: "x" },
		],
		extract,
	);
	assert.equal(refs.length, 1);
});

test("[§4.11] graph cache rejects a non-object state", () => {
	// SPEC §4.11.3: a corrupt cache fails closed with CDX-E101.
	assert.equal(parseGraphCache("[1,2]").ok, false);
});

test("[§4.11] core/arch-boundaries builtin and scoped entries pass through", async () => {
	// SPEC §4.11 EC-9: built-ins stay external nodes; a bare scoped
	// specifier is a package entry, not a deep import.
	const modules = [feature("a")];
	const builtin = await checkArch(
		ctxFor(),
		[ref("src/features/a/index.ts", "node:fs")],
		{
			modules,
		},
	);
	assert.equal(builtin.length, 0);
	const scoped = await checkArch(
		ctxFor(),
		[ref("src/features/a/index.ts", "@pkg")],
		{
			modules,
		},
	);
	assert.equal(scoped.length, 0);
});

test("[§4.11] core/arch-module-mapped derives kernel cli packs and fallbacks", async () => {
	// SPEC §4.11.3 Assign for the evaluation path: every src file maps.
	const kernelEdge = await checkArch(ctxFor(), [
		ref("src/kernel/x.ts", "src/features/a/index.ts"),
	]);
	assert.ok(
		kernelEdge.some((finding) => finding.ruleId === "core/arch-boundaries"),
	);
	const cliOut = await checkArch(ctxFor(), [
		ref("src/cli/main.ts", "src/features/a/index.ts"),
	]);
	assert.equal(cliOut.length, 0);
	const lone = await checkArch(ctxFor(), [
		ref("src/features/lone.ts", "src/features/a/index.ts"),
	]);
	assert.ok(
		lone.some((finding) => finding.ruleId === "core/arch-module-mapped"),
	);
	const packEdge = await checkArch(ctxFor(), [
		ref("src/builtin-packs/core/x.ts", "src/kernel/y.ts"),
	]);
	assert.ok(
		packEdge.some((finding) => finding.ruleId === "core/arch-boundaries"),
	);
	const generic = await checkArch(ctxFor(), [
		ref("src/other/x.ts", "src/features/a/index.ts"),
	]);
	assert.ok(
		generic.some((finding) => finding.ruleId === "core/arch-boundaries"),
	);
	const root = await checkArch(ctxFor(), [
		ref("src/", "src/features/a/index.ts"),
	]);
	assert.ok(
		root.some((finding) => finding.ruleId === "core/arch-module-mapped"),
	);
	const packDir = await checkArch(ctxFor(), [
		ref("src/builtin-packs/core", "src/features/a/index.ts"),
	]);
	assert.ok(
		packDir.some((finding) => finding.ruleId === "core/arch-module-mapped"),
	);
});
