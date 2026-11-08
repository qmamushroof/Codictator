// SPEC §4.12.7 EC-1/EC-2: L1 hook enforcement judges the active task for
// the branch, not only tasks claiming the scope. Before the fix, the
// real-scope judges looped only over claiming tasks, so with no task records
// — or no claiming task — every write passed instead of blocking with
// `codictator task new` (G1).
import { strict as assert } from "node:assert";
import test from "node:test";
import type { Finding } from "../../../src/features/engine/index.ts";
import { redBeforeGreenReal } from "../../../src/features/packs/enforcers/testing-real.ts";
import {
	workflowGatesReal,
	writesWithinPlanReal,
} from "../../../src/features/packs/enforcers/workflow-real.ts";
import type { TaskRecord } from "../../../src/features/workflow/index.ts";
import type { Ports, ProcResult } from "../../../src/kernel/index.ts";
import { stableStringify } from "../../../src/kernel/index.ts";
import { FakeFs } from "../../support/fake-fs.ts";
import { FakeGit } from "../../support/fake-git.ts";
import { createFakePorts } from "../../support/fake-ports.ts";

const BRANCH_ARGV = ["git", "branch", "--show-current"];

function branchResult(stdout: string): ProcResult {
	return { code: 0, stdout, stderr: "", timedOut: false, truncated: false };
}

function failedBranch(): ProcResult {
	return {
		code: 128,
		stdout: "",
		stderr: "fatal: not a git repository",
		timedOut: false,
		truncated: false,
	};
}

// Ports with a scripted branch lookup. A missing branch result keeps the
// bundle's git-missing probe, so `root()` fails and the branch is unreadable.
function portsFor(fs: FakeFs, branch: ProcResult | undefined): Ports {
	const bundle = createFakePorts();
	if (branch === undefined) {
		return { ...bundle.ports, fs };
	}
	bundle.proc.when(BRANCH_ARGV, branch);
	return { ...bundle.ports, fs, git: new FakeGit() };
}

function seedTask(
	fs: FakeFs,
	init: {
		readonly id: string;
		readonly branch: string;
		readonly type: string;
		readonly phase: string;
		readonly allow: ReadonlyArray<string>;
	},
): void {
	const record: TaskRecord = {
		version: 1,
		id: init.id,
		type: init.type,
		title: `task ${init.id}`,
		branch: init.branch,
		phase: init.phase,
		phases: [],
		spec: ["§4.12.3"],
		acceptanceCriteria: ["the write is judged against the branch task"],
		files: { allow: [...init.allow] },
	};
	fs.seedText(
		`.codictator/tasks/${init.id}.json`,
		`${stableStringify(record)}\n`,
	);
}

function ruleIds(findings: ReadonlyArray<Finding>): Array<string> {
	return findings.map((finding) => finding.ruleId);
}

test("[§4.12.3] L1 blocks a code write with no active task and names task new", async () => {
	const ports = portsFor(
		new FakeFs(),
		branchResult("fix/consumer-slice1-l1\n"),
	);
	const findings = await writesWithinPlanReal(ports, ["src/a.ts"], true);
	assert.ok(ruleIds(findings).includes("core/workflow-gates"));
	assert.ok(
		findings.some((finding) => finding.remediation.includes("task new")),
		"the block names the task-new command",
	);
});

test("[§4.12.3] L1 judges the active task even when no task claims the scope", async () => {
	const fs = new FakeFs();
	seedTask(fs, {
		id: "T-0001",
		branch: "fix/x",
		type: "feature",
		phase: "planning",
		allow: [],
	});
	const ports = portsFor(fs, branchResult("fix/x\n"));
	const findings = await writesWithinPlanReal(ports, ["src/a.ts"], true);
	assert.ok(ruleIds(findings).includes("core/writes-within-plan"));
});

test("[§4.12.3] L1 fails a code write closed when the branch is unreadable", async () => {
	const fs = new FakeFs();
	seedTask(fs, {
		id: "T-0001",
		branch: "fix/x",
		type: "feature",
		phase: "planning",
		allow: [],
	});
	const ports = portsFor(fs, failedBranch());
	const findings = await writesWithinPlanReal(ports, ["src/a.ts"], true);
	assert.ok(ruleIds(findings).includes("core/workflow-gates"));
});

test("[§4.12.3] L1 fails a code write closed when the repo root is unreadable", async () => {
	const fs = new FakeFs();
	seedTask(fs, {
		id: "T-0001",
		branch: "fix/x",
		type: "feature",
		phase: "planning",
		allow: [],
	});
	const ports = portsFor(fs, undefined);
	const findings = await writesWithinPlanReal(ports, ["src/a.ts"], true);
	assert.ok(ruleIds(findings).includes("core/workflow-gates"));
});

test("[§4.12.3] L1 workflow gates judge the active task for the branch", async () => {
	const fs = new FakeFs();
	seedTask(fs, {
		id: "T-0001",
		branch: "fix/x",
		type: "feature",
		phase: "planning",
		allow: [],
	});
	const ports = portsFor(fs, branchResult("fix/x\n"));
	const findings = await workflowGatesReal(ports, ["src/a.ts"]);
	assert.ok(ruleIds(findings).includes("core/workflow-gates"));
});

test("[§4.12.7 EC-2] L1 workflow gates stay quiet for a planning test-only write", async () => {
	const fs = new FakeFs();
	seedTask(fs, {
		id: "T-0001",
		branch: "fix/x",
		type: "feature",
		phase: "planning",
		allow: [],
	});
	const ports = portsFor(fs, branchResult("fix/x\n"));
	const findings = await workflowGatesReal(ports, ["tests/widget.test.ts"]);
	assert.deepEqual(findings, []);
});

test("[§4.12.7 EC-2] L1 red proof uses the active task before files.allow is set", async () => {
	const fs = new FakeFs();
	seedTask(fs, {
		id: "T-0001",
		branch: "fix/x",
		type: "feature",
		phase: "implementation",
		allow: [],
	});
	const ports = portsFor(fs, branchResult("fix/x\n"));
	const findings = await redBeforeGreenReal(ports, ["src/a.ts"]);
	assert.ok(ruleIds(findings).includes("core/red-before-green"));
});
