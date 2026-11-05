import { strict as assert } from "node:assert";

import test from "node:test";

import type { CheckContext } from "../../../src/features/engine/index.ts";

import { resolveParametric } from "../../../src/features/packs/enforcers/parametric.ts";

import type { PackRule } from "../../../src/features/packs/index.ts";

import type { EnforcerDecl } from "../../../src/features/packs/manifest.ts";

import { FIXED_INSTANT } from "../../support/fake-clock.ts";

import { createFakePorts } from "../../support/fake-ports.ts";

function makeRule(
	id: string,
	params: PackRule["params"] = {},
	triggers: Array<string> = ["pre-tool"],
	scope: Array<string> = [],
): PackRule {
	return {
		id,
		family: "F6",
		tier: "floor",
		statement: "statement",
		reason: "reason",
		remediation: "fix {path}",
		enforcer: "test/check",
		triggers,
		scope,
		params,
		measureVersion: 1,
		fixtures: { violating: ["basic"], passing: ["basic"] },
	};
}

function makeDecl(kind: string, args: unknown): EnforcerDecl {
	return { id: "test/check", kind, budgetMs: 1000, args };
}

function context(files: ReadonlyArray<string>): CheckContext {
	return {
		trigger: "pre-tool",
		scope: { files: [...files] },
		now: FIXED_INSTANT,
		configHash: "test",
	};
}

test("[§4.4.6] pattern-forbid flags a matching line with the rule id", async () => {
	const fakes = createFakePorts();
	fakes.fs.seedText("src/a.ts", "ok\nTODO fix this\nok\n");
	const made = resolveParametric(
		makeDecl("pattern-forbid", { pattern: "TODO" }),
		makeRule("test/rule"),
		fakes.ports,
	);
	assert.equal(made.ok, true);
	if (!made.ok || made.value === undefined) {
		assert.fail("expected a bound enforcer");
	}
	const findings = await made.value.check(context(["src/a.ts"]), {});
	assert.equal(findings.length, 1);
	assert.equal(findings[0]?.ruleId, "test/rule");
	assert.equal(findings[0]?.path, "src/a.ts");
	assert.equal(findings[0]?.line, 2);
});

test("[§4.4.6] pattern-forbid stays silent on clean content", async () => {
	const fakes = createFakePorts();
	fakes.fs.seedText("src/a.ts", "all clean\n");
	const made = resolveParametric(
		makeDecl("pattern-forbid", { pattern: "TODO" }),
		makeRule("test/rule"),
		fakes.ports,
	);
	assert.equal(made.ok, true);
	if (!made.ok || made.value === undefined) {
		assert.fail("expected a bound enforcer");
	}
	const findings = await made.value.check(context(["src/a.ts"]), {});
	assert.deepEqual(findings, []);
});

test("[§4.4.6] pattern-forbid scans only its paths globs", async () => {
	const fakes = createFakePorts();
	fakes.fs.seedText("src/a.ts", "TODO here\n");
	fakes.fs.seedText("docs/a.md", "TODO here\n");
	const made = resolveParametric(
		makeDecl("pattern-forbid", { pattern: "TODO", paths: ["src/**"] }),
		makeRule("test/rule"),
		fakes.ports,
	);
	assert.equal(made.ok, true);
	if (!made.ok || made.value === undefined) {
		assert.fail("expected a bound enforcer");
	}
	const findings = await made.value.check(
		context(["src/a.ts", "docs/a.md"]),
		{},
	);
	assert.equal(findings.length, 1);
	assert.equal(findings[0]?.path, "src/a.ts");
});

test("[§4.4.6] pattern-forbid rejects an unsafe pattern at load", () => {
	const fakes = createFakePorts();
	const made = resolveParametric(
		makeDecl("pattern-forbid", { pattern: "(a+)+" }),
		makeRule("test/rule"),
		fakes.ports,
	);
	assert.equal(made.ok, false);
	if (!made.ok) {
		assert.equal(made.error.code, "CDX-E902");
	}
});

test("[§4.4.6] pattern-require flags a file missing the pattern", async () => {
	const fakes = createFakePorts();
	fakes.fs.seedText("src/a.ts", "no marker here\n");
	const made = resolveParametric(
		makeDecl("pattern-require", { pattern: "SPDX" }),
		makeRule("test/rule"),
		fakes.ports,
	);
	assert.equal(made.ok, true);
	if (!made.ok || made.value === undefined) {
		assert.fail("expected a bound enforcer");
	}
	const findings = await made.value.check(context(["src/a.ts"]), {});
	assert.equal(findings.length, 1);
	assert.equal(findings[0]?.ruleId, "test/rule");
	assert.equal(findings[0]?.path, "src/a.ts");
});

test("[§4.4.6] pattern-require stays silent when the pattern is present", async () => {
	const fakes = createFakePorts();
	fakes.fs.seedText("src/a.ts", "SPDX-License-Identifier: MIT\n");
	const made = resolveParametric(
		makeDecl("pattern-require", { pattern: "SPDX" }),
		makeRule("test/rule"),
		fakes.ports,
	);
	assert.equal(made.ok, true);
	if (!made.ok || made.value === undefined) {
		assert.fail("expected a bound enforcer");
	}
	assert.deepEqual(await made.value.check(context(["src/a.ts"]), {}), []);
});

test("[§4.4.6] path-placement flags denied and unlisted locations", async () => {
	const fakes = createFakePorts();
	const made = resolveParametric(
		makeDecl("path-placement", {
			allowedGlobs: ["docs/**"],
			deniedGlobs: ["docs/private/**"],
		}),
		makeRule("test/rule"),
		fakes.ports,
	);
	assert.equal(made.ok, true);
	if (!made.ok || made.value === undefined) {
		assert.fail("expected a bound enforcer");
	}
	const findings = await made.value.check(
		context(["docs/guide.md", "docs/private/plan.md", "NOTES.md"]),
		{},
	);
	assert.deepEqual(
		findings.map((finding) => finding.path),
		["NOTES.md", "docs/private/plan.md"],
	);
});

test("[§4.4.6] file-size flags over-limit lines from the rule tunable", async () => {
	const fakes = createFakePorts();
	fakes.fs.seedText("src/a.ts", "one\ntwo\nthree\nfour\n");
	const rule = makeRule("test/rule", {
		maxLines: { type: "integer", default: 3, bound: 5, stricter: "lower" },
	});
	const made = resolveParametric(makeDecl("file-size", {}), rule, fakes.ports);
	assert.equal(made.ok, true);
	if (!made.ok || made.value === undefined) {
		assert.fail("expected a bound enforcer");
	}
	const findings = await made.value.check(context(["src/a.ts"]), {});
	assert.equal(findings.length, 1);
	assert.equal(findings[0]?.ruleId, "test/rule");
	assert.equal(findings[0]?.path, "src/a.ts");
});

test("[§4.4.6] file-size flags an over-limit test file", async () => {
	// SPEC §5.6: test files are in scope, so a long test file blocks.
	const fakes = createFakePorts();
	fakes.fs.seedText(
		"tests/unit/packs/size-cap.test.ts",
		"one\ntwo\nthree\nfour\n",
	);
	const rule = makeRule("test/rule", {
		maxLines: { type: "integer", default: 3, bound: 5, stricter: "lower" },
	});
	const made = resolveParametric(makeDecl("file-size", {}), rule, fakes.ports);
	assert.equal(made.ok, true);
	if (!made.ok || made.value === undefined) {
		assert.fail("expected a bound enforcer");
	}
	const findings = await made.value.check(
		context(["tests/unit/packs/size-cap.test.ts"]),
		{},
	);
	assert.equal(findings.length, 1);
	assert.equal(findings[0]?.ruleId, "test/rule");
	assert.equal(findings[0]?.path, "tests/unit/packs/size-cap.test.ts");
});

test("[§4.4.6] file-size still skips fixture and lockfile paths", async () => {
	// SPEC §5.6: generated vectors stay governed by the pack self-test and
	// dep-lockfile, not the line cap.
	const fakes = createFakePorts();
	fakes.fs.seedText("fixtures/big/data.txt", "one\ntwo\nthree\nfour\n");
	fakes.fs.seedText("pnpm-lock.yaml", "one\ntwo\nthree\nfour\n");
	const rule = makeRule("test/rule", {
		maxLines: { type: "integer", default: 3, bound: 5, stricter: "lower" },
	});
	const made = resolveParametric(makeDecl("file-size", {}), rule, fakes.ports);
	assert.equal(made.ok, true);
	if (!made.ok || made.value === undefined) {
		assert.fail("expected a bound enforcer");
	}
	const findings = await made.value.check(
		context(["fixtures/big/data.txt", "pnpm-lock.yaml"]),
		{},
	);
	assert.deepEqual(findings, []);
});
