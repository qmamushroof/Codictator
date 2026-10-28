// SPEC §4.4.5: unit proof for the external-tool input modes, the {out}
// temp file, env passing and tool events. Scripted fake ports drive every
// path; assertions read the recorded spawns.
import { strict as assert } from "node:assert";
import test from "node:test";
import type { CheckContext } from "../../../src/features/engine/index.ts";
import type {
	ToolDecl,
	ToolEvent,
} from "../../../src/features/packs/enforcers/external.ts";
import { resolveExternal } from "../../../src/features/packs/enforcers/external-check.ts";
import type { PackRule } from "../../../src/features/packs/index.ts";
import type { EnforcerDecl } from "../../../src/features/packs/manifest.ts";
import { stableStringify } from "../../../src/kernel/index.ts";
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

function makeRule(): PackRule {
	return {
		id: RULE,
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

function seedProbe(
	fakes: ReturnType<typeof createFakePorts>,
	tool: ToolDecl,
): void {
	fakes.proc.when(tool.version.probe, {
		code: 0,
		stdout: "lint 1.2.3\n",
		stderr: "",
		timedOut: false,
		truncated: false,
	});
}

function toolRuns(
	fakes: ReturnType<typeof createFakePorts>,
): Array<(typeof fakes.proc.calls)[number]> {
	return fakes.proc.calls.filter(
		(call) => call.argv[0] === "lint" && call.argv[1] !== "--version",
	);
}

test("[§4.4.5] the {out} temp file is read and deleted", async () => {
	const fakes = createFakePorts();
	const tool = makeTool({ command: ["lint", "{out}", "{files}"] });
	seedProbe(fakes, tool);
	fakes.fs.seedText(
		".codictator-tool-out-0-0.json",
		JSON.stringify({
			version: "2.1.0",
			runs: [
				{
					tool: { driver: { rules: [] } },
					results: [
						{
							ruleId: "L1",
							message: { text: "no" },
							locations: [
								{
									physicalLocation: {
										artifactLocation: { uri: "src/a.ts" },
										region: { startLine: 4 },
									},
								},
							],
						},
					],
				},
			],
		}),
	);
	fakes.proc.when(["lint", ".codictator-tool-out-0-0.json", "src/a.ts"], {
		code: 1,
		stdout: "",
		stderr: "",
		timedOut: false,
		truncated: false,
	});
	const made = resolveExternal(
		makeDecl({ output: { format: "sarif", source: "{out}" } }, { L1: RULE }),
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
	assert.equal(findings[0]?.path, "src/a.ts");
	const seen = await fakes.fs.exists(".codictator-tool-out-0-0.json");
	assert.equal(seen.ok, true);
	if (seen.ok) {
		assert.equal(seen.value, false);
	}
});

test("[§4.4.5] stdin-json sends the scope as JSON on stdin", async () => {
	const fakes = createFakePorts();
	const tool = makeTool({ command: ["lint"] });
	seedProbe(fakes, tool);
	const made = resolveExternal(
		makeDecl({ input: "stdin-json" }, { "*": RULE }),
		makeRule(),
		fakes.ports,
		tool,
	);
	assert.equal(made.ok, true);
	if (!made.ok) {
		return;
	}
	assert.deepEqual(await made.value.check(context(["src/a.ts"]), {}), []);
	const runs = toolRuns(fakes);
	assert.equal(runs.length, 1);
	assert.equal(
		runs[0]?.options.stdin,
		stableStringify({ files: ["src/a.ts"] }),
	);
});

test("[§4.4.5] staged input reads the git staged files", async () => {
	const fakes = createFakePorts();
	const tool = makeTool({ command: ["lint", "{staged}"] });
	seedProbe(fakes, tool);
	fakes.git.setStaged(["src/staged.ts"]);
	const made = resolveExternal(
		makeDecl({ input: "staged" }, { "*": RULE }),
		makeRule(),
		fakes.ports,
		tool,
	);
	assert.equal(made.ok, true);
	if (!made.ok) {
		return;
	}
	await made.value.check(context(["src/ignored.ts"]), {});
	const runs = toolRuns(fakes);
	assert.equal(runs.length, 1);
	assert.deepEqual(runs[0]?.argv, ["lint", "src/staged.ts"]);
});

test("[§4.4.5] only named env entries reach the tool", async () => {
	const fakes = createFakePorts({ env: { TOKEN: "s3cr3t", OTHER: "x" } });
	const tool = makeTool({ envPass: ["TOKEN"] });
	seedProbe(fakes, tool);
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
	await made.value.check(context(["src/a.ts"]), {});
	const runs = toolRuns(fakes);
	assert.equal(runs.length, 1);
	assert.deepEqual(runs[0]?.options.env, { TOKEN: "s3cr3t" });
});

test("[§4.4.5] each run reports a tool event", async () => {
	const fakes = createFakePorts();
	const tool = makeTool();
	seedProbe(fakes, tool);
	fakes.proc.when(["lint", "src/a.ts"], {
		code: 1,
		stdout: JSON.stringify({
			version: "2.1.0",
			runs: [{ tool: { driver: { rules: [] } }, results: [] }],
		}),
		stderr: "",
		timedOut: false,
		truncated: false,
	});
	const events: Array<ToolEvent> = [];
	const made = resolveExternal(
		makeDecl({ output: { format: "sarif", source: "stdout" } }, { "*": RULE }),
		makeRule(),
		fakes.ports,
		tool,
		{ onToolEvent: (event) => events.push(event) },
	);
	assert.equal(made.ok, true);
	if (!made.ok) {
		return;
	}
	await made.value.check(context(["src/a.ts"]), {});
	assert.equal(events.length, 1);
	assert.equal(events[0]?.toolId, "lint");
	assert.equal(events[0]?.version, "1.2.3");
	assert.equal(events[0]?.exitCode, 1);
	assert.equal(events[0]?.findingCount, 0);
	assert.equal(typeof events[0]?.argvDigest, "string");
	assert.equal(events[0]?.argvDigest.length, 64);
});
