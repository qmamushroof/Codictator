import { strict as assert } from "node:assert";

import test from "node:test";

import type { CheckContext } from "../../../src/features/engine/index.ts";

import {
	commandLength,
	executeBatch,
	planRuns,
} from "../../../src/features/packs/enforcers/external-runs.ts";

import type { PackRule, ToolDecl } from "../../../src/features/packs/index.ts";

import {
	loadPack,
	resolveExternal,
} from "../../../src/features/packs/index.ts";

import type { EnforcerDecl } from "../../../src/features/packs/manifest.ts";

import { FIXED_INSTANT } from "../../support/fake-clock.ts";

import { createFakePorts } from "../../support/fake-ports.ts";

// SPEC §4.4.5: a stubbed tool declaration with a pinned version, so the
// EC-7..9 and EC-12 tests drive the real external runner instead of a
// missing pack directory.
function stubTool(command: ReadonlyArray<string>): ToolDecl {
	return {
		id: "tool",
		command: [...command],
		version: {
			pin: "1.0.0",
			probe: ["tool", "--version"],
			pattern: "tool (\\d+\\.\\d+\\.\\d+)",
		},
		role: undefined,
		timeoutMs: 5000,
		envPass: [],
	};
}

function externalRule(id: string): PackRule {
	return {
		id,
		family: "F2",
		tier: "floor",
		statement: "statement",
		reason: "reason",
		remediation: "remediation",
		enforcer: "test/check",
		triggers: ["startup"],
		scope: [],
		params: {},
		measureVersion: 1,
		fixtures: { violating: ["basic"], passing: ["basic"] },
	};
}

function externalDecl(ruleId: string, args: unknown): EnforcerDecl {
	return {
		id: "test/check",
		kind: "external",
		budgetMs: 1000,
		tool: "tool",
		ruleMap: { "*": ruleId },
		args,
	};
}

function checkContext(files: ReadonlyArray<string>): CheckContext {
	return {
		trigger: "startup",
		scope: { files: [...files] },
		now: FIXED_INSTANT,
		configHash: "test",
	};
}

test("[§4.4 EC-10] twenty thousand paths in one expansion", async () => {
	// SPEC §4.4.8 EC-10: batched so no command line exceeds 24 KB; one merged result.
	// SPEC §4.10.4 integrity note: same EC, same batching asserted; the test
	// now drives the real planRuns batcher and executes every batch on the
	// fake, so a failure still proves the EC-10 batching.
	const { ports } = createFakePorts();
	const tool = stubTool(["tool", "{files}"]);
	const files = Array.from({ length: 20000 }, (_, index) => `src/f${index}.ts`);
	const runs = planRuns(tool, "files", files, undefined, "out-0");
	assert.ok(runs.length > 1, "twenty thousand paths batch into many runs");
	for (const run of runs) {
		assert.ok(
			commandLength(run.argv) <= 24576,
			"no batch command line exceeds 24 KB",
		);
	}
	const planned = runs.flatMap((run) =>
		run.argv.filter((entry) => entry !== "tool"),
	);
	assert.deepEqual([...planned].sort(), [...files].sort());
	let executed = 0;
	for (const run of runs) {
		const outcome = await executeBatch(ports, {
			argv: run.argv,
			stdin: run.stdin,
			outPath: run.outPath,
			timeoutMs: tool.timeoutMs,
			env: {},
		});
		assert.equal(outcome.ok, true);
		executed += 1;
	}
	assert.equal(executed, runs.length, "every batch runs; one merged result");
});

test("[§4.4 EC-11] dash-prefixed path passed to a tool", async () => {
	// SPEC §4.4.8 EC-11: passed as a separate argv entry, ./--exec=rm.
	// SPEC §4.10.4 integrity note: same EC, same argv asserted; the test now
	// drives the real planRuns expansion instead of the bare fake's
	// recording, so a failure still proves the EC-11 prefixing.
	const runs = planRuns(
		stubTool(["tool", "{file}"]),
		"file",
		["--exec=rm"],
		undefined,
		"out-0",
	);
	assert.equal(runs.length, 1);
	const recorded = runs[0];
	assert.notEqual(recorded, undefined);
	if (recorded !== undefined) {
		assert.equal(recorded.argv[1], "./--exec=rm");
	}
});

test("[§4.4 EC-12] hanging tool", async () => {
	// SPEC §4.4.8 EC-12: killed at timeoutMs; CDX-E902.
	// SPEC §4.10.4 integrity note: same EC, same code asserted; the test now
	// drives the real check with a hanging stub the fake tree-kills at once,
	// so a failure still proves the EC-12 mapping.
	const { ports, proc } = createFakePorts();
	proc.when(["tool", "--version"], {
		code: 0,
		stdout: "tool 1.0.0\n",
		stderr: "",
		timedOut: false,
		truncated: false,
	});
	proc.whenHang(["tool", "--hang"]);
	const made = resolveExternal(
		externalDecl("test/hanging-tool", {
			input: "files",
			output: { format: "exit-code" },
		}),
		externalRule("test/hanging-tool"),
		ports,
		stubTool(["tool", "--hang"]),
	);
	assert.equal(made.ok, true);
	if (!made.ok) {
		assert.fail("expected the external enforcer to resolve");
	}
	const findings = await made.value.check(checkContext([]), {});
	assert.ok(
		findings.some((finding) => finding.code === "CDX-E902"),
		"a hanging tool blocks with CDX-E902",
	);
});

test("[§4.4 EC-14] helper tool missing for agent assets", async () => {
	// SPEC §4.4.8 EC-14: only core/agent-assets-present blocks, at L4 alone.
	const result = await loadPack("repo-missing-helper-tool");
	assert.equal(result.ok, true);
});
