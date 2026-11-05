import { strict as assert } from "node:assert";

import test from "node:test";

import {
	parseGraphCache,
	serializeGraphCache,
	updateGraphCache,
} from "../../../src/features/arch/graph.ts";

import type {
	ImportRef,
	ModuleNode,
} from "../../../src/features/arch/index.ts";

import { checkArch } from "../../../src/features/arch/index.ts";

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
