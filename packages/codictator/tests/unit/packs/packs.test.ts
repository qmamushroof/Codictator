// SPEC §4.4.8: one red test per packs EC row. Self-test rows build a Pack
// literal and assert the self-test failure code; loader rows assert the
// load outcome; tool-safety rows drive the real external runner (probe,
// plan, execute, attribute) against stub tools on the Proc fake. EC-13
// needs extractor-overlap reporting from a later module, and EC-14 needs
// core/agent-assets-present from phase 9, so both stay red and listed.
import { strict as assert } from "node:assert";
import test from "node:test";
import type {
	CheckContext,
	Enforcer,
	Finding,
} from "../../../src/features/engine/index.ts";
import {
	commandLength,
	executeBatch,
	planRuns,
} from "../../../src/features/packs/enforcers/external-runs.ts";
import type {
	Pack,
	PackRule,
	ToolDecl,
} from "../../../src/features/packs/index.ts";
import {
	loadPack,
	resolveExternal,
	selfTest,
} from "../../../src/features/packs/index.ts";
import type { EnforcerDecl } from "../../../src/features/packs/manifest.ts";
import { FIXED_INSTANT } from "../../support/fake-clock.ts";
import { createFakePorts } from "../../support/fake-ports.ts";

function packRule(
	id: string,
	violating: ReadonlyArray<string>,
	passing: ReadonlyArray<string>,
): PackRule {
	return {
		id,
		family: "F2",
		tier: "tunable",
		statement: "statement",
		reason: "reason",
		remediation: "remediation",
		enforcer: "check",
		triggers: ["startup"],
		scope: ["src/**/*.ts"],
		params: {},
		measureVersion: 1,
		fixtures: { violating: [...violating], passing: [...passing] },
	};
}

function testPack(
	id: string,
	rules: ReadonlyArray<PackRule>,
	enforcers: ReadonlyArray<Enforcer>,
): Pack {
	return {
		manifest: {
			id,
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

function stubEnforcer(findings: ReadonlyArray<Finding>): Enforcer {
	return {
		id: "core/x",
		kinds: ["startup"],
		budgetMs: 1000,
		check: async (): Promise<Array<Finding>> => [...findings],
	};
}

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

test("[§4.4 EC-1] rule without a violating fixture", async () => {
	// SPEC §4.4.8 EC-1: load fails CDX-E211.
	const pack = testPack("core", [packRule("core/x", [], ["basic"])], []);
	const result = await selfTest(pack);
	assert.equal(result.ok, false);
	if (!result.ok) {
		assert.equal(result.error.code, "CDX-E211");
	}
});

test("[§4.4 EC-2] violating fixture passes", async () => {
	// SPEC §4.4.8 EC-2: CDX-E212, the pack is inert.
	const pack = testPack(
		"core",
		[packRule("core/x", ["basic"], ["basic"])],
		[stubEnforcer([])],
	);
	const result = await selfTest(pack);
	assert.equal(result.ok, false);
	if (!result.ok) {
		assert.equal(result.error.code, "CDX-E212");
	}
});

test("[§4.4 EC-3] passing fixture blocked", async () => {
	// SPEC §4.4.8 EC-3: CDX-E213, the pack is inert.
	const pack = testPack(
		"core",
		[packRule("core/x", ["basic"], ["basic"])],
		[stubEnforcer([{ ruleId: "core/x", message: "m", remediation: "r" }])],
	);
	const result = await selfTest(pack);
	assert.equal(result.ok, false);
	if (!result.ok) {
		assert.equal(result.error.code, "CDX-E213");
	}
});

test("[§4.4 EC-4] custom pack edited after acceptance", async () => {
	// SPEC §4.4.8 EC-4: inert at L1-L3 with an advise naming it;
	// L4 blocks core/custom-pack-selftest.
	const result = await loadPack("custom-packs/edited-after-accept");
	assert.equal(result.ok, false);
});

test("[§4.4 EC-5] custom rule id under the core namespace", async () => {
	// SPEC §4.4.8 EC-5: CDX-E204.
	// SPEC §4.10.4 integrity note: same EC, same code asserted; the test now
	// loads the real custom-packs/core-id fixture whose rule id core/x sits
	// outside its own namespace, so a failure still proves the EC-5 check.
	const result = await loadPack("custom-packs/core-id");
	assert.equal(result.ok, false);
	if (!result.ok) {
		assert.equal(result.error.code, "CDX-E204");
	}
});

test("[§4.4 EC-6] external tool mapped to core/no-secrets", async () => {
	// SPEC §4.4.8 EC-6: CDX-E210.
	const result = await loadPack("custom-packs/external-maps-core");
	assert.equal(result.ok, false);
	if (!result.ok) {
		assert.equal(result.error.code, "CDX-E210");
	}
});

test("[§4.4 EC-7] external tool newer than its pin", async () => {
	// SPEC §4.4.8 EC-7: CDX-E208 and block; the fix pins the new version
	// through config.
	// SPEC §4.10.4 integrity note: same EC, same code asserted; the test now
	// drives the real version probe with a stubbed tool reporting 2.0.0
	// against pin 1.0.0, so a failure still proves the EC-7 mapping.
	const { ports, proc } = createFakePorts();
	proc.when(["tool", "--version"], {
		code: 0,
		stdout: "tool 2.0.0\n",
		stderr: "",
		timedOut: false,
		truncated: false,
	});
	const made = resolveExternal(
		externalDecl("test/version-drift", {
			input: "files",
			output: { format: "exit-code" },
		}),
		externalRule("test/version-drift"),
		ports,
		stubTool(["tool", "{files}"]),
	);
	assert.equal(made.ok, true);
	if (!made.ok) {
		assert.fail("expected the external enforcer to resolve");
	}
	const findings = await made.value.check(checkContext(["src/a.ts"]), {});
	assert.ok(
		findings.some((finding) => finding.code === "CDX-E208"),
		"a newer tool version blocks with CDX-E208",
	);
});

test("[§4.4 EC-8] external tool exits with an unlisted code", async () => {
	// SPEC §4.4.8 EC-8: CDX-E207 and block (fail closed).
	// SPEC §4.10.4 integrity note: same EC, same code asserted; the test now
	// drives the real check with a stubbed tool exiting 3 outside the
	// pass/findings lists, so a failure still proves the EC-8 mapping.
	const { ports, proc } = createFakePorts();
	proc.when(["tool", "--version"], {
		code: 0,
		stdout: "tool 1.0.0\n",
		stderr: "",
		timedOut: false,
		truncated: false,
	});
	proc.when(["tool", "src/a.ts"], {
		code: 3,
		stdout: "",
		stderr: "",
		timedOut: false,
		truncated: false,
	});
	const made = resolveExternal(
		externalDecl("test/unlisted-exit", {
			input: "files",
			output: { format: "exit-code" },
			exitCodes: { pass: [0], findings: [1] },
		}),
		externalRule("test/unlisted-exit"),
		ports,
		stubTool(["tool", "{files}"]),
	);
	assert.equal(made.ok, true);
	if (!made.ok) {
		assert.fail("expected the external enforcer to resolve");
	}
	const findings = await made.value.check(checkContext(["src/a.ts"]), {});
	assert.ok(
		findings.some((finding) => finding.code === "CDX-E207"),
		"an unlisted exit code blocks with CDX-E207",
	);
});

test("[§4.4 EC-9] SARIF finding outside the repo root", async () => {
	// SPEC §4.4.8 EC-9: the finding is dropped and CDX-E207 is raised;
	// tool output is untrusted.
	// SPEC §4.10.4 integrity note: same EC, same code asserted plus the
	// drop; the test now drives the real SARIF parser with an absolute
	// tool path, so a failure still proves the EC-9 mapping.
	const { ports, proc } = createFakePorts();
	proc.when(["tool", "--version"], {
		code: 0,
		stdout: "tool 1.0.0\n",
		stderr: "",
		timedOut: false,
		truncated: false,
	});
	const sarif = JSON.stringify({
		runs: [
			{
				results: [
					{
						ruleId: "T1",
						locations: [
							{
								physicalLocation: {
									artifactLocation: { uri: "/etc/secret.txt" },
									region: { startLine: 1 },
								},
							},
						],
						message: { text: "leak" },
					},
				],
			},
		],
	});
	proc.when(["tool", "src/a.ts"], {
		code: 1,
		stdout: sarif,
		stderr: "",
		timedOut: false,
		truncated: false,
	});
	const made = resolveExternal(
		externalDecl("test/sarif-escape", {
			input: "files",
			output: { format: "sarif", source: "stdout" },
			exitCodes: { pass: [0], findings: [1] },
		}),
		externalRule("test/sarif-escape"),
		ports,
		stubTool(["tool", "{files}"]),
	);
	assert.equal(made.ok, true);
	if (!made.ok) {
		assert.fail("expected the external enforcer to resolve");
	}
	const findings = await made.value.check(checkContext(["src/a.ts"]), {});
	assert.ok(
		findings.some((finding) => finding.code === "CDX-E207"),
		"an escaping SARIF path raises CDX-E207",
	);
	assert.ok(
		!findings.some((finding) => finding.path === "/etc/secret.txt"),
		"the outside-root path is dropped, never a finding",
	);
});

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

test("[§4.4 EC-13] two language packs claim one extension", async () => {
	// SPEC §4.4.8 EC-13: the first pack in config.packs wins; status reports it.
	const result = await loadPack("repo-ts-py-overlap");
	assert.equal(result.ok, true);
});

test("[§4.4 EC-14] helper tool missing for agent assets", async () => {
	// SPEC §4.4.8 EC-14: only core/agent-assets-present blocks, at L4 alone.
	const result = await loadPack("repo-missing-helper-tool");
	assert.equal(result.ok, true);
});
