// SPEC §4.10.2 + §4.12.3 L4: CI re-runs in-range red proofs. A red proof
// recorded at the implemented tree is not red, so the forgery short-circuit
// judges an empty report; only in-range commits reach a worktree re-run.
import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { rerunRedProofs } from "../../../src/cli/ci-rerun.ts";
import type { CommandPorts } from "../../../src/cli/shared.ts";
import type { Finding } from "../../../src/features/engine/index.ts";
import type { ReRunInput } from "../../../src/features/testing/proofs.ts";
import { createFakePorts } from "../../support/fake-ports.ts";

const COMMIT = "abc123def456";
const RANGE = { base: "base", head: "head" };
const JUNIT =
	'<?xml version="1.0"?><testsuite><testcase name="fails red"><failure message="red"/></testcase></testsuite>';

function tempRoot(): string {
	const root = mkdtempSync(path.join(tmpdir(), "codictator-rerun-test-"));
	mkdirSync(path.join(root, ".codictator", "tasks"), { recursive: true });
	return root;
}

function seedTask(root: string, id: string, record: unknown): void {
	writeFileSync(
		path.join(root, ".codictator", "tasks", `${id}.json`),
		JSON.stringify(record),
	);
}

function proofTask(commit: string): unknown {
	return {
		version: 1,
		id: "T-0001",
		type: "fix",
		title: "fix a defect",
		branch: "fix/x",
		phase: "implementation",
		phases: [],
		spec: ["docs/SPEC/10-TESTING-STRATEGY.md"],
		acceptanceCriteria: ["red proof recorded"],
		files: { allow: ["src/**"] },
		tests: [{ path: "tests/a.test.ts", title: "fails red", kind: "unit" }],
		redProof: {
			commit,
			tree: "tree0",
			failing: ["fails red"],
			at: "2026-01-01T00:00:00.000Z",
		},
	};
}

function scriptGit(
	fake: ReturnType<typeof createFakePorts>,
	logStdout: string,
	headTree: string,
	proofTree: string,
): void {
	fake.proc.when(["git", "log", "--format=%H", "base..head"], {
		code: 0,
		stdout: logStdout,
		stderr: "",
		timedOut: false,
		truncated: false,
	});
	fake.proc.when(["git", "rev-parse", "head^{tree}"], {
		code: 0,
		stdout: headTree,
		stderr: "",
		timedOut: false,
		truncated: false,
	});
	fake.proc.when(["git", "rev-parse", `${COMMIT}^{tree}`], {
		code: 0,
		stdout: proofTree,
		stderr: "",
		timedOut: false,
		truncated: false,
	});
}

test("[§4.10] no task records re-runs nothing", async () => {
	const root = tempRoot();
	try {
		const fake = createFakePorts();
		const ports: CommandPorts = { ...fake.ports, root };
		const seen: Array<ReRunInput> = [];
		const findings = await rerunRedProofs(ports, root, RANGE, (input) => {
			seen.push(input);
			return [];
		});
		assert.deepEqual(findings, []);
		assert.deepEqual(seen, []);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("[§4.10] a task without a red proof stays quiet", async () => {
	const root = tempRoot();
	try {
		seedTask(root, "T-0001", {
			version: 1,
			id: "T-0001",
			type: "fix",
			title: "fix a defect",
			branch: "fix/x",
			phase: "implementation",
			phases: [],
			spec: [],
			acceptanceCriteria: ["fixed"],
			files: { allow: ["src/**"] },
		});
		const fake = createFakePorts();
		const ports: CommandPorts = { ...fake.ports, root };
		const findings = await rerunRedProofs(ports, root, RANGE);
		assert.deepEqual(findings, []);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("[§4.10] a red proof with no matching declared tests stays quiet", async () => {
	const root = tempRoot();
	try {
		const record = proofTask(COMMIT) as Record<string, unknown>;
		seedTask(root, "T-0001", {
			...record,
			tests: [{ path: "tests/b.test.ts", title: "other", kind: "unit" }],
		});
		const fake = createFakePorts();
		const ports: CommandPorts = { ...fake.ports, root };
		const findings = await rerunRedProofs(ports, root, RANGE);
		assert.deepEqual(findings, []);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("[§4.10] a failed range read stays quiet", async () => {
	const root = tempRoot();
	try {
		seedTask(root, "T-0001", proofTask(COMMIT));
		const fake = createFakePorts();
		fake.proc.whenMissing({
			code: 1,
			stdout: "",
			stderr: "fatal",
			timedOut: false,
			truncated: false,
		});
		const ports: CommandPorts = { ...fake.ports, root };
		const findings = await rerunRedProofs(ports, root, RANGE);
		assert.deepEqual(findings, []);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("[§4.10] an out-of-range commit stays quiet", async () => {
	const root = tempRoot();
	try {
		seedTask(root, "T-0001", proofTask(COMMIT));
		const fake = createFakePorts();
		scriptGit(fake, "deadbeef\n", "treeH\n", "treeP\n");
		const ports: CommandPorts = { ...fake.ports, root };
		const seen: Array<ReRunInput> = [];
		const findings = await rerunRedProofs(ports, root, RANGE, (input) => {
			seen.push(input);
			return [];
		});
		assert.deepEqual(findings, []);
		assert.deepEqual(seen, []);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("[§4.10] a proof at the implemented tree judges an empty report", async () => {
	const root = tempRoot();
	try {
		seedTask(root, "T-0001", proofTask(COMMIT));
		const fake = createFakePorts();
		scriptGit(fake, `${COMMIT}\n`, "treeH\n", "treeH\n");
		const ports: CommandPorts = { ...fake.ports, root };
		const seen: Array<ReRunInput> = [];
		const findings = await rerunRedProofs(ports, root, RANGE, (input) => {
			seen.push(input);
			return [];
		});
		assert.deepEqual(findings, []);
		assert.equal(seen.length, 1);
		assert.equal(seen[0]?.rerunReportXml, "");
		assert.deepEqual(seen[0]?.declared, [
			{ path: "tests/a.test.ts", title: "fails red" },
		]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("[§4.10] an in-range proof re-runs in a worktree", async () => {
	const root = tempRoot();
	try {
		seedTask(root, "T-0001", proofTask(COMMIT));
		const fake = createFakePorts();
		scriptGit(fake, `${COMMIT}\n`, "treeH\n", "treeP\n");
		fake.proc.whenMissing({
			code: 0,
			stdout: JUNIT,
			stderr: "",
			timedOut: false,
			truncated: false,
		});
		const ports: CommandPorts = { ...fake.ports, root };
		const rerun: Finding = {
			ruleId: "core/red-before-green",
			message: "re-run judged the proof",
			remediation: "record an honest red proof",
		};
		const findings = await rerunRedProofs(ports, root, RANGE, () => [rerun]);
		assert.deepEqual(findings, [rerun]);
		assert.ok(
			fake.proc.calls.some(
				(call) => call.argv[0] === "git" && call.argv[2] === "add",
			),
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("[§4.10] a failed worktree add stays quiet", async () => {
	const root = tempRoot();
	try {
		seedTask(root, "T-0001", proofTask(COMMIT));
		const fake = createFakePorts();
		scriptGit(fake, `${COMMIT}\n`, "treeH\n", "treeP\n");
		fake.proc.whenMissing({
			code: 1,
			stdout: "",
			stderr: "worktree busy",
			timedOut: false,
			truncated: false,
		});
		const ports: CommandPorts = { ...fake.ports, root };
		const findings = await rerunRedProofs(ports, root, RANGE);
		assert.deepEqual(findings, []);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
