// SPEC §4.4.3–§4.4.4: manifest narrowing, pack checks, enforcer resolution
// and the self-test. Tunable params carry defaults within bound along a
// stricter direction; violating fixtures must yield the rule id.
import { strict as assert } from "node:assert";
import test from "node:test";
import type { Enforcer, Finding } from "../../../src/features/engine/index.ts";
import type { Pack, PackRule } from "../../../src/features/packs/index.ts";
import {
	resolvePackEnforcers,
	selfTest,
} from "../../../src/features/packs/index.ts";
import type { EnforcerDecl } from "../../../src/features/packs/manifest.ts";
import {
	checkPack,
	isBuiltinPackId,
	narrowEnforcerDecl,
	narrowManifest,
} from "../../../src/features/packs/manifest.ts";
import { checkParam } from "../../../src/features/packs/params.ts";
import { createFakePorts } from "../../support/fake-ports.ts";

function ruleFor(id: string, over: Partial<PackRule> = {}): PackRule {
	return {
		id,
		family: "F2",
		tier: "tunable",
		statement: "statement",
		reason: "reason",
		remediation: "do the compliant thing",
		enforcer: "check",
		triggers: ["startup"],
		scope: ["src/**/*.ts"],
		params: {},
		measureVersion: 1,
		fixtures: { violating: ["bad"], passing: ["good"] },
		...over,
	};
}

function packFor(
	rules: ReadonlyArray<PackRule>,
	enforcers: ReadonlyArray<Enforcer>,
): Pack {
	return {
		manifest: {
			id: "custom",
			version: "0.0.0",
			description: "test pack",
			rules: [...rules],
			enforcers: [],
			drivers: [],
			extractors: [],
			measures: [],
			capabilities: [],
			assets: [],
			maxWaiverDays: 90,
		},
		enforcers: [...enforcers],
		drivers: [],
		assets: [],
	};
}

function stubEnforcer(id: string, findings: ReadonlyArray<Finding>): Enforcer {
	return {
		id,
		kinds: ["startup"],
		budgetMs: 1000,
		check: async () => [...findings],
	};
}

function ruleFinding(ruleId: string): Finding {
	return { ruleId, message: "blocked", remediation: "fix it" };
}

test("[§4.4] packs params judge numeric defaults within bound", () => {
	assert.ok(
		checkParam("r", "n", {
			type: "integer",
			default: 3,
			bound: 5,
			stricter: "lower",
		}).ok,
	);
	assert.ok(
		checkParam("r", "n", {
			type: "number",
			default: 5,
			bound: 3,
			stricter: "higher",
		}).ok,
	);
	assert.ok(!checkParam("r", "n", "nope").ok);
	assert.ok(
		!checkParam("r", "n", {
			type: "weird",
			default: 1,
			bound: 2,
			stricter: "lower",
		}).ok,
	);
	assert.ok(
		!checkParam("r", "n", {
			type: "integer",
			default: 1,
			bound: 2,
			stricter: "sideways",
		}).ok,
	);
	assert.ok(
		!checkParam("r", "n", {
			type: "integer",
			default: 1.5,
			bound: "x",
			stricter: "lower",
		}).ok,
	);
	assert.ok(
		!checkParam("r", "n", {
			type: "integer",
			default: 1,
			bound: 2,
			min: "x",
			stricter: "lower",
		}).ok,
	);
	assert.ok(
		!checkParam("r", "n", {
			type: "integer",
			default: 1,
			bound: 9,
			min: 2,
			stricter: "lower",
		}).ok,
	);
	assert.ok(
		!checkParam("r", "n", {
			type: "integer",
			default: 9,
			bound: 9,
			max: 2,
			stricter: "lower",
		}).ok,
	);
	assert.ok(
		!checkParam("r", "n", {
			type: "integer",
			default: 9,
			bound: 5,
			stricter: "lower",
		}).ok,
	);
	assert.ok(
		!checkParam("r", "n", {
			type: "integer",
			default: 1,
			bound: 5,
			stricter: "higher",
		}).ok,
	);
});

test("[§4.4] packs params judge string lists by subset direction", () => {
	assert.ok(
		checkParam("r", "s", {
			type: "string[]",
			default: ["a"],
			bound: ["a", "b"],
			stricter: "subset",
		}).ok,
	);
	assert.ok(
		!checkParam("r", "s", {
			type: "string[]",
			default: "a",
			bound: [],
			stricter: "subset",
		}).ok,
	);
	assert.ok(
		!checkParam("r", "s", {
			type: "string[]",
			default: ["a"],
			bound: "b",
			stricter: "subset",
		}).ok,
	);
	assert.ok(
		!checkParam("r", "s", {
			type: "string[]",
			default: ["zzz"],
			bound: ["a"],
			stricter: "subset",
		}).ok,
	);
	assert.ok(
		!checkParam("r", "s", {
			type: "string[]",
			default: ["a"],
			bound: ["a", "b"],
			stricter: "superset",
		}).ok,
	);
	assert.ok(
		checkParam("r", "s", {
			type: "string[]",
			default: ["a", "b"],
			bound: ["a"],
			stricter: "superset",
		}).ok,
	);
});

test("[§4.4] packs manifests narrow decls and reject bad shapes", () => {
	assert.equal(isBuiltinPackId("core"), true);
	assert.equal(isBuiltinPackId("custom"), false);
	assert.ok(narrowEnforcerDecl({ id: "e", kind: "code" }).ok);
	assert.ok(
		narrowEnforcerDecl({
			id: "e",
			kind: "external",
			tool: "t",
			ruleMap: { a: "b" },
		}).ok,
	);
	assert.ok(!narrowEnforcerDecl("nope").ok);
	assert.ok(!narrowEnforcerDecl({ kind: "code" }).ok);
	assert.ok(!narrowEnforcerDecl({ id: "e", kind: "mystery" }).ok);
	assert.ok(!narrowEnforcerDecl({ id: "e", kind: "code", module: 1 }).ok);
	assert.ok(!narrowEnforcerDecl({ id: "e", kind: "code", budgetMs: -1 }).ok);
	assert.ok(!narrowEnforcerDecl({ id: "e", kind: "external", tool: "t" }).ok);
	assert.ok(
		!narrowEnforcerDecl({
			id: "e",
			kind: "external",
			tool: "t",
			ruleMap: { a: 1 },
		}).ok,
	);
	assert.ok(!narrowManifest("nope").ok);
	assert.ok(!narrowManifest({ id: "p" }).ok);
	assert.ok(!narrowManifest({ id: "p", rules: [{ id: 1 }] }).ok);
	assert.ok(!narrowManifest({ id: "p", rules: [], enforcers: {} }).ok);
});

test("[§4.4] packs checkPack guards ids rules and rule maps", () => {
	const good = narrowManifest({
		id: "custom",
		rules: [{ id: "custom/r", enforcer: "e" }],
		enforcers: [{ id: "e", kind: "code" }],
	});
	assert.ok(good.ok);
	if (good.ok) {
		assert.ok(checkPack(good.value, true).ok);
	}
	const dup = narrowManifest({
		id: "custom",
		rules: [
			{ id: "custom/r", enforcer: "e" },
			{ id: "custom/r", enforcer: "e" },
		],
		enforcers: [{ id: "e", kind: "code" }],
	});
	if (dup.ok) {
		assert.ok(!checkPack(dup.value, false).ok);
	}
	const builtinCollision = narrowManifest({
		id: "core",
		rules: [],
		enforcers: [],
	});
	if (builtinCollision.ok) {
		assert.ok(!checkPack(builtinCollision.value, false).ok);
	}
	const prefix = narrowManifest({
		id: "custom",
		rules: [{ id: "other/r", enforcer: "e" }],
		enforcers: [{ id: "e", kind: "code" }],
	});
	if (prefix.ok) {
		assert.ok(!checkPack(prefix.value, false).ok);
	}
	const orphan = narrowManifest({
		id: "custom",
		rules: [{ id: "custom/r", enforcer: "missing" }],
		enforcers: [{ id: "e", kind: "code" }],
	});
	if (orphan.ok) {
		const checked = checkPack(orphan.value, false);
		assert.ok(!checked.ok);
	}
	const outside = narrowManifest({
		id: "custom",
		rules: [{ id: "custom/r", enforcer: "e" }],
		enforcers: [
			{ id: "e", kind: "external", tool: "t", ruleMap: { a: "custom/other" } },
		],
	});
	if (outside.ok) {
		assert.ok(!checkPack(outside.value, false).ok);
	}
});

test("[§4.4] packs registry defers unwired kinds and orphans", async () => {
	const { ports } = createFakePorts();
	const manifest = narrowManifest({
		id: "custom",
		rules: [
			{
				id: "custom/a",
				enforcer: "late",
				triggers: ["startup"],
				scope: ["**"],
				params: {},
			},
			{
				id: "custom/b",
				enforcer: "late",
				triggers: ["startup"],
				scope: ["**"],
				params: {},
			},
			{
				id: "custom/c",
				enforcer: "orphan",
				triggers: ["startup"],
				scope: ["**"],
				params: {},
			},
			{
				id: "custom/d",
				enforcer: "tool-bound",
				triggers: ["startup"],
				scope: ["**"],
				params: {},
			},
		],
		enforcers: [
			{ id: "late", kind: "file-size" },
			{ id: "tool-bound", kind: "external", tool: "missing", ruleMap: {} },
		],
	});
	assert.ok(manifest.ok);
	if (!manifest.ok) {
		return;
	}
	const decls: Array<EnforcerDecl> = [
		{ id: "late", kind: "file-size", budgetMs: 1000 },
		{
			id: "tool-bound",
			kind: "external",
			budgetMs: 1000,
			tool: "missing",
			ruleMap: {},
		},
		{ id: "orphan", kind: "code", budgetMs: 1000 },
	];
	const resolved = resolvePackEnforcers(manifest.value, decls, ports, []);
	assert.ok(resolved.ok);
	if (resolved.ok) {
		assert.equal(resolved.value.length, 4);
		for (const enforcer of resolved.value) {
			assert.throws(() => {
				void enforcer.check(
					{
						trigger: "startup",
						scope: { files: [] },
						now: "t",
						configHash: "h",
					},
					{},
				);
			});
		}
	}
});

test("[§4.4] packs self-test proves violating and passing fixtures", async () => {
	const noisy = await selfTest(
		packFor(
			[ruleFor("custom/r")],
			[stubEnforcer("check", [ruleFinding("custom/r")])],
		),
	);
	assert.ok(!noisy.ok);
	const unknownTrigger = await selfTest(
		packFor(
			[ruleFor("custom/r", { enforcer: "check", triggers: ["bogus"] })],
			[stubEnforcer("check", [ruleFinding("custom/r")])],
		),
	);
	assert.ok(!unknownTrigger.ok);
	const clean = await selfTest(
		packFor(
			[ruleFor("custom/r", { fixtures: { violating: ["bad"], passing: [] } })],
			[
				{
					id: "check",
					kinds: ["startup"],
					budgetMs: 1000,
					check: async () => [ruleFinding("custom/r")],
				},
			],
		),
	);
	assert.ok(clean.ok);
	const noViolating = await selfTest(
		packFor(
			[ruleFor("custom/r", { fixtures: { violating: [], passing: [] } })],
			[],
		),
	);
	assert.ok(!noViolating.ok);
	const badRemediation = await selfTest(
		packFor([ruleFor("custom/r", { remediation: "reason" })], []),
	);
	assert.ok(!badRemediation.ok);
	const badParam = await selfTest(
		packFor(
			[
				ruleFor("custom/r", {
					params: {
						n: { type: "integer", default: "bad", bound: 1, stricter: "lower" },
					},
				}),
			],
			[],
		),
	);
	assert.ok(!badParam.ok);
	const noEnforcer = await selfTest(
		packFor(
			[ruleFor("custom/r", { enforcer: "ghost" })],
			[stubEnforcer("check", [])],
		),
	);
	assert.ok(!noEnforcer.ok);
	const weak = await selfTest(
		packFor([ruleFor("custom/r")], [stubEnforcer("check", [])]),
	);
	assert.ok(!weak.ok);
});
