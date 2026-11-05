import { strict as assert } from "node:assert";

import test from "node:test";

import type { CheckContext } from "../../../src/features/engine/index.ts";

import type { PackRule, ToolDecl } from "../../../src/features/packs/index.ts";

import { resolveExternal } from "../../../src/features/packs/index.ts";

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
