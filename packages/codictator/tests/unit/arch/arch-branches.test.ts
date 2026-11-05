import { strict as assert } from "node:assert";

import test from "node:test";

import type {
	ImportRef,
	ModuleNode,
} from "../../../src/features/arch/index.ts";

import {
	checkArch,
	checkArchProfile,
	checkModuleSize,
	isPublicEntryTarget,
} from "../../../src/features/arch/index.ts";

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
