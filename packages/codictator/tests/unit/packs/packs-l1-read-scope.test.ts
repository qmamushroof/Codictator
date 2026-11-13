// SPEC §4.12.3 L1: "A write is blocked" — a read is not. Before the fix the
// L1 hook scope carried every tool target with no tool kind, so a Read of a
// src file in a planning task counted as a live write and core/workflow-gates
// plus core/writes-within-plan denied it. Secret reads stay judged.
import { strict as assert } from "node:assert";
import test from "node:test";
import type { HookEvent } from "../../../src/features/adapters/contract.ts";
import { hookScope } from "../../../src/features/adapters/hook-scope.ts";
import type {
	CheckContext,
	Enforcer,
	Finding,
	Scope,
} from "../../../src/features/engine/index.ts";
import { resolveNoSecretReads } from "../../../src/features/packs/enforcers/secret-scan.ts";
import {
	resolveWorkflowGates,
	resolveWritesWithinPlan,
} from "../../../src/features/packs/enforcers/workflow-guards.ts";
import type { TaskRecord } from "../../../src/features/workflow/index.ts";
import type {
	PackRule,
	Ports,
	ProcResult,
	Result,
} from "../../../src/kernel/index.ts";
import { stableStringify } from "../../../src/kernel/index.ts";
import { FIXED_INSTANT } from "../../support/fake-clock.ts";
import { FakeFs } from "../../support/fake-fs.ts";
import { FakeGit } from "../../support/fake-git.ts";
import { createFakePorts } from "../../support/fake-ports.ts";

const DECL = { id: "test-enforcer", kind: "code", budgetMs: 1000 } as const;

function ruleFor(id: string): PackRule {
	return {
		id,
		family: "test",
		tier: "floor",
		statement: "a rule",
		reason: "testing",
		remediation: "fix it",
		enforcer: "test-enforcer",
		triggers: ["pre-tool"],
		scope: [],
		params: {},
		measureVersion: 1,
		fixtures: { violating: [], passing: [] },
	};
}

function branchResult(stdout: string): ProcResult {
	return { code: 0, stdout, stderr: "", timedOut: false, truncated: false };
}

// A planning task on the branch, with no red proof and no files.allow, so
// any src write owes both workflow gates.
function planningPorts(): Ports {
	const fs = new FakeFs();
	const record: TaskRecord = {
		version: 1,
		id: "T-0001",
		type: "feature",
		title: "task T-0001",
		branch: "fix/x",
		phase: "planning",
		phases: [],
		spec: ["§4.12.3"],
		acceptanceCriteria: ["reads are not judged as writes"],
		files: { allow: [] },
	};
	fs.seedText(".codictator/tasks/T-0001.json", `${stableStringify(record)}\n`);
	const bundle = createFakePorts();
	bundle.proc.when(
		["git", "branch", "--show-current"],
		branchResult("fix/x\n"),
	);
	return { ...bundle.ports, fs, git: new FakeGit() };
}

function checked(resolved: Result<Enforcer>): Enforcer {
	assert.equal(resolved.ok, true);
	if (!resolved.ok) {
		throw new Error("resolver failed");
	}
	return resolved.value;
}

function eventFor(kind: "read" | "write", target: string): HookEvent {
	return {
		harness: "muse-code",
		event: "PreToolUse",
		trigger: "pre-tool",
		sessionId: "session-1",
		cwd: "/repo",
		tool: { kind, name: kind, paths: [target] },
	};
}

function ctxFor(scope: Scope): CheckContext {
	return {
		trigger: "pre-tool",
		scope,
		now: FIXED_INSTANT,
		configHash: "test-hash",
	};
}

async function workflowFindings(scope: Scope): Promise<Array<Finding>> {
	const ports = planningPorts();
	const gates = checked(
		resolveWorkflowGates(DECL, ruleFor("core/workflow-gates"), ports),
	);
	const plan = checked(
		resolveWritesWithinPlan(DECL, ruleFor("core/writes-within-plan"), ports),
	);
	return [
		...(await gates.check(ctxFor(scope), {})),
		...(await plan.check(ctxFor(scope), {})),
	];
}

test("[§4.12.3] L1 hook scope marks a read tool call as read access", () => {
	const scope = hookScope(eventFor("read", "/repo/src/x.ts"), "/repo");
	assert.equal(scope.toolAccess, "read");
	assert.deepEqual(scope.proposedPaths, ["src/x.ts"]);
});

test("[§4.12.3] L1 hook scope marks a write tool call as write access", () => {
	const scope = hookScope(eventFor("write", "/repo/src/x.ts"), "/repo");
	assert.equal(scope.toolAccess, "write");
});

test("[§4.12.3] L1 workflow gates allow a planning-phase read of a src file", async () => {
	const scope = hookScope(eventFor("read", "/repo/src/x.ts"), "/repo");
	assert.deepEqual(await workflowFindings(scope), []);
});

test("[§4.12.3] L1 workflow gates still block a planning-phase write of a src file", async () => {
	const scope = hookScope(eventFor("write", "/repo/src/x.ts"), "/repo");
	const ids = (await workflowFindings(scope)).map((finding) => finding.ruleId);
	assert.ok(ids.includes("core/workflow-gates"));
	assert.ok(ids.includes("core/writes-within-plan"));
});

test("[§4.7.1] L1 no-secret-reads still judges a read of a secret path", async () => {
	const ports = planningPorts();
	const enforcer = checked(
		resolveNoSecretReads(DECL, ruleFor("core/no-secret-reads"), ports),
	);
	const scope = hookScope(eventFor("read", "/repo/.env"), "/repo");
	const findings = await enforcer.check(ctxFor(scope), {});
	assert.ok(findings.some((f) => f.ruleId === "core/no-secret-reads"));
});
