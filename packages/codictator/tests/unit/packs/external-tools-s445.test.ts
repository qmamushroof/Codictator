import { strict as assert } from "node:assert";

import test from "node:test";

import type { CheckContext } from "../../../src/features/engine/index.ts";

import type { ToolDecl } from "../../../src/features/packs/enforcers/external.ts";

import { resolveExternal } from "../../../src/features/packs/enforcers/external-check.ts";

import type { PackRule } from "../../../src/features/packs/index.ts";

import type { EnforcerDecl } from "../../../src/features/packs/manifest.ts";

import { FIXED_INSTANT } from "../../support/fake-clock.ts";

import { createFakePorts } from "../../support/fake-ports.ts";

const RULE = "test/rule";

function makeTool(overrides: Partial<ToolDecl> = {}): ToolDecl {
	return {
		id: "lint",
		command: ["lint", "{files}"],
		version: {
			pin: "1.2.3",
			probe: ["lint", "--version"],
			pattern: "(\\d+\\.\\d+\\.\\d+)",
		},
		role: "enforcer",
		timeoutMs: 5000,
		envPass: [],
		...overrides,
	};
}

function makeRule(id: string = RULE): PackRule {
	return {
		id,
		family: "F6",
		tier: "floor",
		statement: "statement",
		reason: "reason",
		remediation: "pin the tool through config",
		enforcer: "test/tool",
		triggers: ["pre-tool"],
		scope: [],
		params: {},
		measureVersion: 1,
		fixtures: { violating: ["basic"], passing: ["basic"] },
	};
}

function makeDecl(
	args: unknown,
	ruleMap: Record<string, string>,
): EnforcerDecl {
	return {
		id: "test/tool",
		kind: "external",
		budgetMs: 1000,
		tool: "lint",
		ruleMap,
		args,
	};
}

function context(files: ReadonlyArray<string>): CheckContext {
	return {
		trigger: "pre-tool",
		scope: { files: [...files] },
		now: FIXED_INSTANT,
		configHash: "test",
	};
}

function toolRuns(
	fakes: ReturnType<typeof createFakePorts>,
): Array<(typeof fakes.proc.calls)[number]> {
	return fakes.proc.calls.filter(
		(call) => call.argv[0] === "lint" && call.argv[1] !== "--version",
	);
}

function sarifBody(results: ReadonlyArray<unknown>): string {
	return JSON.stringify({
		version: "2.1.0",
		runs: [{ tool: { driver: { rules: [] } }, results }],
	});
}

function sarifResult(ruleId: string, uri: string, line: number): unknown {
	return {
		ruleId,
		message: { text: `${ruleId} says no` },
		locations: [
			{
				physicalLocation: {
					artifactLocation: { uri },
					region: { startLine: line },
				},
			},
		],
	};
}

test("[§4.4.5] a missing tool fails closed with CDX-E209", async () => {
	const fakes = createFakePorts();
	const tool = makeTool();
	fakes.proc.when(tool.version.probe, {
		code: -1,
		stdout: "",
		stderr: "",
		timedOut: false,
		truncated: false,
	});
	const made = resolveExternal(
		makeDecl({ output: { format: "sarif", source: "stdout" } }, { L1: RULE }),
		makeRule(),
		fakes.ports,
		tool,
	);
	assert.equal(made.ok, true);
	if (!made.ok) {
		return;
	}
	const findings = await made.value.check(context(["src/a.ts"]), {});
	assert.equal(findings.length, 1);
	assert.equal(findings[0]?.code, "CDX-E209");
});

test("[§4.4.5] a hanging tool fails closed with CDX-E902", async () => {
	const fakes = createFakePorts();
	const tool = makeTool();
	fakes.proc.when(tool.version.probe, {
		code: 0,
		stdout: "lint 1.2.3\n",
		stderr: "",
		timedOut: false,
		truncated: false,
	});
	fakes.proc.whenHang(["lint", "src/a.ts"]);
	const made = resolveExternal(
		makeDecl({ output: { format: "sarif", source: "stdout" } }, { L1: RULE }),
		makeRule(),
		fakes.ports,
		tool,
	);
	assert.equal(made.ok, true);
	if (!made.ok) {
		return;
	}
	const findings = await made.value.check(context(["src/a.ts"]), {});
	assert.equal(findings.length, 1);
	assert.equal(findings[0]?.code, "CDX-E902");
});

test("[§4.4.5] dash-prefixed paths never parse as flags", async () => {
	const fakes = createFakePorts();
	const tool = makeTool();
	fakes.proc.when(tool.version.probe, {
		code: 0,
		stdout: "lint 1.2.3\n",
		stderr: "",
		timedOut: false,
		truncated: false,
	});
	const made = resolveExternal(
		makeDecl({}, { "*": RULE }),
		makeRule(),
		fakes.ports,
		tool,
	);
	assert.equal(made.ok, true);
	if (!made.ok) {
		return;
	}
	await made.value.check(context(["--exec=rm"]), {});
	const runs = toolRuns(fakes);
	assert.ok(runs.length > 0);
	for (const run of runs) {
		assert.ok(!run.argv.slice(1).some((entry) => entry.startsWith("-")));
	}
	assert.ok(runs.some((run) => run.argv.includes("./--exec=rm")));
});

test("[§4.4.5] long file lists batch under the command-line budget", async () => {
	const fakes = createFakePorts();
	const tool = makeTool();
	fakes.proc.when(tool.version.probe, {
		code: 0,
		stdout: "lint 1.2.3\n",
		stderr: "",
		timedOut: false,
		truncated: false,
	});
	const made = resolveExternal(
		makeDecl({}, { "*": RULE }),
		makeRule(),
		fakes.ports,
		tool,
	);
	assert.equal(made.ok, true);
	if (!made.ok) {
		return;
	}
	const files = Array.from(
		{ length: 20000 },
		(_, index) => `src/f${String(index)}.ts`,
	);
	const findings = await made.value.check(context(files), {});
	assert.deepEqual(findings, []);
	const runs = toolRuns(fakes);
	assert.ok(runs.length > 1);
	for (const run of runs) {
		const length = run.argv.reduce(
			(total, entry) => total + entry.length + 1,
			0,
		);
		assert.ok(length <= 24576);
	}
});

test("[§4.4.5] unmapped tool rules are dropped without findings", async () => {
	const fakes = createFakePorts();
	const tool = makeTool();
	fakes.proc.when(tool.version.probe, {
		code: 0,
		stdout: "lint 1.2.3\n",
		stderr: "",
		timedOut: false,
		truncated: false,
	});
	fakes.proc.when(["lint", "src/a.ts"], {
		code: 1,
		stdout: sarifBody([sarifResult("L9", "src/a.ts", 1)]),
		stderr: "",
		timedOut: false,
		truncated: false,
	});
	const made = resolveExternal(
		makeDecl({ output: { format: "sarif", source: "stdout" } }, { L1: RULE }),
		makeRule(),
		fakes.ports,
		tool,
	);
	assert.equal(made.ok, true);
	if (!made.ok) {
		return;
	}
	assert.deepEqual(await made.value.check(context(["src/a.ts"]), {}), []);
});
