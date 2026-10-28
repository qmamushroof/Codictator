// SPEC §4.11.4: green branch tests for the arch guard beyond the EC rows.
// The EC tests pin each blocked edge; these pin the adjudication branches
// the self-run needs: deny rules, profile kinds, layers, cycles, the module
// map validator and the graph cache. All behaviour here is implemented, so
// every test below passes green.
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
	serializeGraphCache,
	updateGraphCache,
} from "../../../src/features/arch/graph.ts";
import type {
	ImportRef,
	ModuleNode,
} from "../../../src/features/arch/index.ts";
import {
	buildGraph,
	checkArch,
	checkArchProfile,
	checkModuleSize,
	deriveModules,
	isPublicEntryTarget,
} from "../../../src/features/arch/index.ts";
import {
	CODICTATOR_MODULES,
	isArchProfile,
	layerMayImport,
	resolveLayer,
	validateModuleMap,
} from "../../../src/features/arch/profiles.ts";
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

test("[§4.11] core/arch-public-entry targets the entry, its extensionless form and the module dir", () => {
	// SPEC §4.11.4: a cross-module import is judged against the public entry.
	const mod = feature("b");
	assert.equal(isPublicEntryTarget(mod, "src/features/b/index.ts"), true);
	assert.equal(isPublicEntryTarget(mod, "src/features/b/index"), true);
	assert.equal(isPublicEntryTarget(mod, "src/features/b"), true);
	assert.equal(isPublicEntryTarget(mod, "src/features/b/internal/x.ts"), false);
});

test("[§4.11] core/arch-public-entry honours an explicit entry file", () => {
	// SPEC §4.11.4: modules may declare their entry instead of index.ts. The
	// module-dir and index.ts fallbacks still apply beside the entry.
	const mod: ModuleNode = {
		name: "b",
		path: "src/features/b/**",
		entry: "src/features/b/main.ts",
		dependsOn: [],
	};
	assert.equal(isPublicEntryTarget(mod, "src/features/b/main.ts"), true);
	assert.equal(isPublicEntryTarget(mod, "src/features/b/index.ts"), true);
	assert.equal(isPublicEntryTarget(mod, "src/features/b/internal/x.ts"), false);
});

test("[§4.11] core/arch-boundaries deny rules refuse an allowed edge", async () => {
	// SPEC §4.11.2: deny[] removes an edge without touching dependsOn.
	const modules = [feature("a", ["b"]), feature("b")];
	const allowed = await checkArch(
		ctxFor(),
		[ref("src/features/a/index.ts", "src/features/b/index.ts")],
		{
			modules,
		},
	);
	assert.equal(allowed.length, 0);
	const denied = await checkArch(
		ctxFor(),
		[ref("src/features/a/index.ts", "src/features/b/index.ts")],
		{
			modules,
			deny: [{ from: "a", to: "b" }],
		},
	);
	assert.ok(
		denied.some((finding) => finding.ruleId === "core/arch-boundaries"),
	);
});

test("[§4.11] core/arch-boundaries nothing imports the composition root", async () => {
	// SPEC §4.11.1: the composition root may import anything; nothing imports it.
	const cli: ModuleNode = {
		name: "cli",
		path: "src/cli/**",
		kind: "composition",
		dependsOn: ["*"],
	};
	const modules = [feature("a"), cli];
	const outward = await checkArch(
		ctxFor(),
		[ref("src/cli/index.ts", "src/features/a/index.ts")],
		{ modules },
	);
	assert.equal(outward.length, 0);
	const inward = await checkArch(
		ctxFor(),
		[ref("src/features/a/index.ts", "src/cli/index.ts")],
		{ modules },
	);
	assert.ok(
		inward.some((finding) => finding.ruleId === "core/arch-boundaries"),
	);
});

test("[§4.11] core/arch-boundaries kernel imports nothing", async () => {
	// SPEC §4.11.1: kernel imports only kernel.
	const kernel: ModuleNode = {
		name: "kernel",
		path: "src/kernel/**",
		kind: "kernel",
		dependsOn: [],
	};
	const findings = await checkArch(
		ctxFor(),
		[ref("src/kernel/x.ts", "src/features/a/index.ts")],
		{ modules: [kernel, feature("a")] },
	);
	assert.ok(
		findings.some((finding) => finding.ruleId === "core/arch-boundaries"),
	);
});

test("[§4.11] core/arch-boundaries shared never imports a feature", async () => {
	// SPEC §4.11.1: the app profile overlay beyond dependsOn.
	const shared: ModuleNode = {
		name: "s",
		path: "src/shared/s/**",
		kind: "shared",
		dependsOn: ["a"],
	};
	const target: ModuleNode = {
		name: "a",
		path: "src/features/a/**",
		kind: "feature",
		dependsOn: [],
	};
	const findings = await checkArch(
		ctxFor(),
		[ref("src/shared/s/index.ts", "src/features/a/index.ts")],
		{ modules: [shared, target], profile: "app" },
	);
	assert.ok(
		findings.some((finding) => finding.ruleId === "core/arch-boundaries"),
	);
});

test("[§4.11] core/arch-profile-declared rejects unknown profiles and kinds", () => {
	// SPEC §4.11.4: the profile is set and every module kind is valid for it.
	assert.equal(checkArchProfile("app", [feature("a")]).length, 0);
	const unknown = checkArchProfile("bogus", [feature("a")]);
	assert.ok(
		unknown.some((finding) => finding.ruleId === "core/arch-profile-declared"),
	);
	const badKind: ModuleNode = {
		name: "x",
		path: "src/x/**",
		kind: "command",
		dependsOn: [],
	};
	const mismatch = checkArchProfile("app", [badKind]);
	assert.ok(
		mismatch.some((finding) => finding.ruleId === "core/arch-profile-declared"),
	);
});

test("[§4.11] core/arch-module-size blocks over the file and line limits", () => {
	// SPEC §4.11.4: the fitness function over per-module file and line counts.
	assert.equal(
		checkModuleSize([{ module: "a", files: 3, lines: 40 }]).length,
		0,
	);
	const files = checkModuleSize([{ module: "a", files: 11, lines: 40 }], {
		maxFiles: 10,
	});
	assert.equal(files.length, 1);
	const lines = checkModuleSize([{ module: "a", files: 3, lines: 600 }], {
		maxLines: 500,
	});
	assert.equal(lines.length, 1);
});

// NOTE (G5b): SPEC §4.11.5 EC-5 wants an `unresolvable-dynamic-import`
// finding that blocks in kernel and advises elsewhere, but resolveEdge
// hardcodes fromMod: undefined for dynamic targets, so checkResolvedEdge
// returns before dynamicFinding and the kernel/advise distinction never
// fires (a dynamic edge reports core/arch-module-mapped instead). Left
// for the arch owner: fixing it is a checks.ts logic change beyond this
// task's globs. The existing EC-5 test pins only findings.length > 0.

test("[§4.11] core/arch-boundaries layer direction holds inside a module", async () => {
	// SPEC §4.11.1: domain imports only domain; application adds domain.
	const modules = [feature("a")];
	const up = await checkArch(
		ctxFor(),
		[ref("src/features/a/domain/x.ts", "src/features/a/application/y.ts")],
		{ modules, layerDirs: ["domain", "application"] },
	);
	assert.ok(up.some((finding) => finding.ruleId === "core/arch-boundaries"));
	const down = await checkArch(
		ctxFor(),
		[ref("src/features/a/application/y.ts", "src/features/a/domain/x.ts")],
		{ modules, layerDirs: ["domain", "application"] },
	);
	assert.equal(down.length, 0);
});

test("[§4.11] core/arch-no-cycles prints the cycle through an allowed loop", async () => {
	// SPEC §4.11.5 EC-3: L1 judges only cycles through new edges.
	const modules = [feature("a", ["b"]), feature("b", ["a"])];
	const findings = await checkArch(
		ctxFor(),
		[
			ref("src/features/a/index.ts", "src/features/b/index.ts"),
			ref("src/features/b/index.ts", "src/features/a/index.ts"),
		],
		{ modules },
	);
	const cycles = findings.filter(
		(finding) => finding.ruleId === "core/arch-no-cycles",
	);
	assert.equal(cycles.length, 1);
	assert.ok(cycles[0]?.message.includes("a -> b -> a"));
});

test("[§4.11] core/arch-public-entry judges a deep external import", async () => {
	// SPEC §4.11 EC-9: a bare specifier with a subpath is a deep import.
	const modules = [feature("a")];
	const deep = await checkArch(
		ctxFor(),
		[ref("src/features/a/index.ts", "pkg/deep/path")],
		{
			modules,
		},
	);
	assert.ok(
		deep.some((finding) => finding.ruleId === "core/arch-public-entry"),
	);
	const entry = await checkArch(
		ctxFor(),
		[ref("src/features/a/index.ts", "pkg")],
		{
			modules,
		},
	);
	assert.equal(entry.length, 0);
});

test("[§4.11] core/arch-module-mapped flags a non-repo import target", async () => {
	// SPEC §4.11.5 EC-8: a target outside every module glob blocks.
	const findings = await checkArch(
		ctxFor(),
		[ref("src/features/a/index.ts", "/abs/x.ts")],
		{
			modules: [feature("a")],
		},
	);
	assert.ok(
		findings.some((finding) => finding.ruleId === "core/arch-module-mapped"),
	);
});

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

test("[§4.11] core/arch-boundaries profile overlays for cli and service", async () => {
	// SPEC §4.11.1: commands never leak into features; features never
	// touch transports. dependsOn allows the edge; the profile refuses it.
	const command: ModuleNode = {
		name: "c",
		path: "src/commands/c/**",
		kind: "command",
		dependsOn: [],
	};
	const caller: ModuleNode = {
		name: "f",
		path: "src/features/f/**",
		kind: "feature",
		dependsOn: ["c"],
	};
	const cliRefused = await checkArch(
		ctxFor(),
		[ref("src/features/f/index.ts", "src/commands/c/index.ts")],
		{
			modules: [caller, command],
			profile: "cli",
		},
	);
	assert.ok(
		cliRefused.some((finding) => finding.ruleId === "core/arch-boundaries"),
	);
	const transport: ModuleNode = {
		name: "t",
		path: "src/transports/t/**",
		kind: "transport",
		dependsOn: [],
	};
	const serviceCaller: ModuleNode = {
		name: "g",
		path: "src/features/g/**",
		kind: "feature",
		dependsOn: ["t"],
	};
	const serviceRefused = await checkArch(
		ctxFor(),
		[ref("src/features/g/index.ts", "src/transports/t/index.ts")],
		{ modules: [serviceCaller, transport], profile: "service" },
	);
	assert.ok(
		serviceRefused.some((finding) => finding.ruleId === "core/arch-boundaries"),
	);
	const kernelCaller: ModuleNode = {
		name: "kernel",
		path: "src/kernel/**",
		kind: "kernel",
		dependsOn: ["h"],
	};
	const kernelTarget: ModuleNode = {
		name: "h",
		path: "src/features/h/**",
		kind: "feature",
		dependsOn: [],
	};
	const kernelRefused = await checkArch(
		ctxFor(),
		[ref("src/kernel/x.ts", "src/features/h/index.ts")],
		{
			modules: [kernelCaller, kernelTarget],
		},
	);
	assert.ok(
		kernelRefused.some(
			(finding) =>
				finding.ruleId === "core/arch-boundaries" &&
				finding.message.includes("module kernel must not import module h"),
		),
	);
});

test("[§4.11] core/arch-boundaries unlayered files in a layered module pass", async () => {
	// SPEC §4.11.1: a file outside every layer dir is unlayered, not a
	// layer violation.
	const findings = await checkArch(
		ctxFor(),
		[ref("src/features/a/x.ts", "src/features/a/y.ts")],
		{ modules: [feature("a")], layerDirs: ["domain"] },
	);
	assert.equal(findings.length, 0);
});

test("[§4.11] core/arch-no-cycles shares dependencies without a cycle", async () => {
	// SPEC §4.11.4: a diamond resolves with no finding.
	const modules = [
		feature("a", ["b", "c"]),
		feature("b", ["d"]),
		feature("c", ["d"]),
		feature("d"),
	];
	const findings = await checkArch(
		ctxFor(),
		[
			ref("src/features/a/index.ts", "src/features/b/index.ts"),
			ref("src/features/a/index.ts", "src/features/c/index.ts"),
			ref("src/features/b/index.ts", "src/features/d/index.ts"),
			ref("src/features/c/index.ts", "src/features/d/index.ts"),
		],
		{ modules },
	);
	assert.equal(
		findings.filter((finding) => finding.ruleId === "core/arch-no-cycles")
			.length,
		0,
	);
});

test("[§4.11] graph cache round-trips and re-lexes only changed files", () => {
	// SPEC §4.11.3: the cache is keyed by file content hash.
	const bad = parseGraphCache("{oops");
	assert.equal(bad.ok, false);
	const versioned = parseGraphCache('{"version":2,"entries":{}}');
	assert.equal(versioned.ok, false);
	const text = serializeGraphCache({ version: 1, entries: {} });
	const round = parseGraphCache(text);
	assert.equal(round.ok, true);
	let calls = 0;
	const extract = (path: string, _text: string): Array<ImportRef> => {
		calls += 1;
		return [{ from: path, to: "b", line: 1 }];
	};
	const first = updateGraphCache(
		{ version: 1, entries: {} },
		[{ path: "src/a.ts", text: "import 'b';" }],
		extract,
	);
	assert.equal(first.refs.length, 1);
	const second = updateGraphCache(
		first.cache,
		[{ path: "src/a.ts", text: "import 'b';" }],
		extract,
	);
	assert.equal(calls, 1);
	assert.equal(second.refs.length, 1);
	const dropped = updateGraphCache(first.cache, [], extract);
	assert.equal(dropped.refs.length, 0);
});

test("[§4.11] profiles judge layers, resolve them and validate the map", () => {
	// SPEC §4.11.1: folder names are configurable, the direction is not.
	assert.equal(isArchProfile("app"), true);
	assert.equal(isArchProfile("bogus"), false);
	assert.equal(layerMayImport("domain", "application", "app"), false);
	assert.equal(layerMayImport("application", "domain", "app"), true);
	assert.equal(layerMayImport("domain", "kernel", "app"), true);
	assert.equal(layerMayImport("domain", "application", "library"), true);
	assert.equal(layerMayImport("mystery", "application", "app"), true);
	assert.equal(
		resolveLayer("src/features/a/domain/x.ts", "src/features/a", ["domain"]),
		"domain",
	);
	assert.equal(
		resolveLayer("src/features/a/x.ts", "src/features/a", ["domain"]),
		undefined,
	);
	assert.equal(
		resolveLayer("src/features/b/domain/x.ts", "src/features/a", ["domain"]),
		undefined,
	);
	assert.equal(
		resolveLayer("src/features/a/other/x.ts", "src/features/a", ["domain"]),
		undefined,
	);
	assert.equal(validateModuleMap(CODICTATOR_MODULES).ok, true);
	const duplicate = validateModuleMap([feature("a"), feature("a")]);
	assert.equal(duplicate.ok, false);
	const unknownDep = validateModuleMap([feature("a", ["nope"])]);
	assert.equal(unknownDep.ok, false);
	const cyclic = validateModuleMap([feature("a", ["b"]), feature("b", ["a"])]);
	assert.equal(cyclic.ok, false);
});
