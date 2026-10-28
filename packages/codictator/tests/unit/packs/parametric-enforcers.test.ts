// SPEC §4.4.6: unit proof for the six parametric enforcers. Each test binds
// a rule and decl through the pack resolver and runs the check against fake
// ports, so a failure proves the enforcer and never the harness.
import { strict as assert } from "node:assert";
import test from "node:test";
import type { CheckContext } from "../../../src/features/engine/index.ts";
import { resolveParametric } from "../../../src/features/packs/enforcers/parametric.ts";
import type { PackRule } from "../../../src/features/packs/index.ts";
import type { EnforcerDecl } from "../../../src/features/packs/manifest.ts";
import { notFoundError } from "../../../src/kernel/index.ts";
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

test("[§4.4.6] file-size without a limit stays deferred", () => {
	const fakes = createFakePorts();
	const made = resolveParametric(
		makeDecl("file-size", {}),
		makeRule("test/rule"),
		fakes.ports,
	);
	assert.equal(made.ok, true);
	if (!made.ok) {
		return;
	}
	assert.equal(made.value, undefined);
});

test("[§4.4.6] file-size with a malformed limit fails the load", () => {
	const fakes = createFakePorts();
	const made = resolveParametric(
		makeDecl("file-size", { maxLines: -1 }),
		makeRule("test/rule"),
		fakes.ports,
	);
	assert.equal(made.ok, false);
	if (!made.ok) {
		assert.equal(made.error.code, "CDX-E203");
	}
});

test("[§4.4.6] file-required flags a missing file and absent content", async () => {
	const fakes = createFakePorts();
	fakes.fs.seedText("present.txt", "nothing here\n");
	const made = resolveParametric(
		makeDecl("file-required", {
			files: ["missing.txt", "present.txt"],
			contains: { "present.txt": "marker" },
		}),
		makeRule("test/rule"),
		fakes.ports,
	);
	assert.equal(made.ok, true);
	if (!made.ok || made.value === undefined) {
		assert.fail("expected a bound enforcer");
	}
	const findings = await made.value.check(context([]), {});
	assert.deepEqual(
		findings.map((finding) => finding.path),
		["missing.txt", "present.txt"],
	);
});

test("[§4.4.6] json-key flags an absent required key and a forbidden key", async () => {
	const fakes = createFakePorts();
	fakes.fs.seedText("config.json", '{"name": "x"}');
	const absent = resolveParametric(
		makeDecl("json-key", { file: "config.json", key: "version" }),
		makeRule("test/rule"),
		fakes.ports,
	);
	assert.equal(absent.ok, true);
	if (!absent.ok || absent.value === undefined) {
		assert.fail("expected a bound enforcer");
	}
	const missing = await absent.value.check(context([]), {});
	assert.equal(missing.length, 1);
	assert.equal(missing[0]?.ruleId, "test/rule");
	const forbidden = resolveParametric(
		makeDecl("json-key", {
			file: "config.json",
			key: "name",
			mode: "forbidden",
		}),
		makeRule("test/rule"),
		fakes.ports,
	);
	assert.equal(forbidden.ok, true);
	if (!forbidden.ok || forbidden.value === undefined) {
		assert.fail("expected a bound enforcer");
	}
	const present = await forbidden.value.check(context([]), {});
	assert.equal(present.length, 1);
});

test("[§4.4.6] json-key stays silent on required present and forbidden absent", async () => {
	const fakes = createFakePorts();
	fakes.fs.seedText("config.json", '{"version": 1}');
	const required = resolveParametric(
		makeDecl("json-key", {
			file: "config.json",
			key: "version",
			value: 1,
		}),
		makeRule("test/rule"),
		fakes.ports,
	);
	assert.equal(required.ok, true);
	if (!required.ok || required.value === undefined) {
		assert.fail("expected a bound enforcer");
	}
	assert.deepEqual(await required.value.check(context([]), {}), []);
	const forbidden = resolveParametric(
		makeDecl("json-key", {
			file: "config.json",
			key: "secret",
			mode: "forbidden",
		}),
		makeRule("test/rule"),
		fakes.ports,
	);
	assert.equal(forbidden.ok, true);
	if (!forbidden.ok || forbidden.value === undefined) {
		assert.fail("expected a bound enforcer");
	}
	assert.deepEqual(await forbidden.value.check(context([]), {}), []);
});

test("[§4.4.6] json-key fails closed on invalid JSON", async () => {
	const fakes = createFakePorts();
	fakes.fs.seedText("config.json", "not json {");
	const made = resolveParametric(
		makeDecl("json-key", { file: "config.json", key: "version" }),
		makeRule("test/rule"),
		fakes.ports,
	);
	assert.equal(made.ok, true);
	if (!made.ok || made.value === undefined) {
		assert.fail("expected a bound enforcer");
	}
	const findings = await made.value.check(context([]), {});
	assert.equal(findings.length, 1);
	assert.equal(findings[0]?.ruleId, "test/rule");
	assert.ok((findings[0]?.code ?? "").startsWith("CDX-E"));
});

test("[§4.4.6] unreadable files fail closed with the port error code", async () => {
	const fakes = createFakePorts();
	fakes.fs.failNext(notFoundError("src/a.ts"));
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
	assert.equal(findings[0]?.code, "CDX-E903");
	assert.equal(findings[0]?.ruleId, "test/rule");
});
