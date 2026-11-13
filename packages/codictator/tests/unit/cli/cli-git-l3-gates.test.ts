// SPEC §4.12.3 L3 + §4.9.3: the L3 git hooks enforce the task-phase gate
// at pre-commit and the staged-history gate at commit-msg. Before the fix
// both hooks waved the change through: pre-commit never read the branch
// task, and commit-msg trailered a code commit with no history entry.
import { strict as assert } from "node:assert";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
	checkMissingHistoryEntry,
	checkPreCommitTaskGate,
} from "../../../src/cli/git-history.ts";
import { handleGitHook } from "../../../src/cli/git-hook.ts";
import type { CommandRequest } from "../../../src/cli/shared.ts";
import { portsFor } from "../../../src/cli/shared.ts";
import { createTempRepo, type TempRepo } from "../../support/temp-repo.ts";

function req(args: ReadonlyArray<string>, cwd: string): CommandRequest {
	return {
		args,
		json: false,
		quiet: true,
		cwd,
		nodeVersion: undefined,
		stdinText: undefined,
	};
}

function seedConfig(repo: TempRepo): void {
	repo.writeFile(
		".codictator/config.json",
		JSON.stringify({
			version: 1,
			codictator: "unknown",
			packs: [],
			harnesses: ["muse-code", "opencode"],
		}),
	);
}

function seedTask(repo: TempRepo, phase: string): void {
	const branch = repo.git(["branch", "--show-current"]).trim();
	repo.writeFile(
		".codictator/tasks/T-0099.json",
		JSON.stringify({
			version: 1,
			id: "T-0099",
			type: "feature",
			title: "l3 gate probe",
			branch,
			phase,
			phases: [],
			spec: [],
			acceptanceCriteria: [],
			files: { allow: [] },
			...(phase === "record"
				? {
						historyStaged: true,
						tests: [
							{ path: "tests/a.test.ts", title: "[§4.12] a", kind: "unit" },
							{
								path: "tests/a.test.ts",
								title: "[§4.12] a",
								kind: "architecture",
							},
							{
								path: "tests/a.test.ts",
								title: "[§4.12] a",
								kind: "acceptance",
							},
						],
						redProof: {
							commit: "0".repeat(40),
							tree: "0".repeat(40),
							failing: [],
							at: "2026-01-01T00:00:00.000Z",
						},
					}
				: {}),
		}),
	);
}

function stage(repo: TempRepo, name: string, content: string): void {
	mkdirSync(path.dirname(path.join(repo.dir, name)), { recursive: true });
	writeFileSync(path.join(repo.dir, name), content, "utf8");
	repo.git(["add", name]);
}

function commitMsgFile(repo: TempRepo, subject: string): string {
	const msgFile = path.join(repo.dir, "COMMIT_EDITMSG");
	writeFileSync(msgFile, `${subject}\n`, "utf8");
	return msgFile;
}

test("[§4.12.3 L3] pre-commit on a code-class staged set with no active task is blocked", async () => {
	// SPEC §4.12.3 L3: a code commit owes an active task at phase >= record.
	// No task record on the branch means the hook blocks with
	// core/workflow-gates instead of waving the commit through.
	const repo = createTempRepo();
	try {
		seedConfig(repo);
		stage(repo, "src/a.ts", "export const a = 1;\n");
		const ran = await handleGitHook(req(["pre-commit"], repo.dir));
		assert.equal(ran.ok, true);
		assert.equal(ran.value, 1);
		const ports = await portsFor(repo.dir);
		if (!ports.ok) {
			assert.fail(`portsFor failed: ${ports.error.code}`);
		}
		const findings = await checkPreCommitTaskGate(ports.value, ["src/a.ts"]);
		assert.equal(findings.length, 1);
		assert.equal(findings[0]?.ruleId, "core/workflow-gates");
	} finally {
		repo.cleanup();
	}
});

test("[§4.12.3 L3] pre-commit on a code-class staged set with the active task below record is blocked", async () => {
	// A task still in implementation has not reached the record phase, so
	// its code commit is blocked until the workflow advances.
	const repo = createTempRepo();
	try {
		seedConfig(repo);
		seedTask(repo, "implementation");
		stage(repo, "src/a.ts", "export const a = 1;\n");
		const ran = await handleGitHook(req(["pre-commit"], repo.dir));
		assert.equal(ran.ok, true);
		assert.equal(ran.value, 1);
		const ports = await portsFor(repo.dir);
		if (!ports.ok) {
			assert.fail(`portsFor failed: ${ports.error.code}`);
		}
		const findings = await checkPreCommitTaskGate(ports.value, ["src/a.ts"]);
		assert.equal(findings.length, 1);
		assert.equal(findings[0]?.ruleId, "core/workflow-gates");
	} finally {
		repo.cleanup();
	}
});

test("[§4.12.3 L3] pre-commit on a code-class staged set with the active task at record passes the task gate", async () => {
	// Control: at the record phase the code commit clears the L3 task gate,
	// so the hook verdict is a pass when the gate legs are silent.
	const repo = createTempRepo();
	try {
		seedConfig(repo);
		seedTask(repo, "record");
		stage(repo, "src/a.ts", "export const a = 1;\n");
		const ran = await handleGitHook(req(["pre-commit"], repo.dir));
		assert.equal(ran.ok, true);
		assert.equal(ran.value, 0);
		const ports = await portsFor(repo.dir);
		if (!ports.ok) {
			assert.fail(`portsFor failed: ${ports.error.code}`);
		}
		assert.deepEqual(
			await checkPreCommitTaskGate(ports.value, ["src/a.ts"]),
			[],
		);
	} finally {
		repo.cleanup();
	}
});

test("[§4.9.3] commit-msg on a code staged set with no staged history entry is blocked", async () => {
	// SPEC §4.9.3: the staged diff adds exactly one history entry. A code
	// commit staging no docs/HISTORY/ file blocks instead of trailering.
	const repo = createTempRepo();
	try {
		seedConfig(repo);
		repo.commit("fixture");
		stage(repo, "src/a.ts", "export const a = 1;\n");
		const msgFile = commitMsgFile(repo, "fix(cli): touch code");
		const ran = await handleGitHook(req(["commit-msg", msgFile], repo.dir));
		assert.equal(ran.ok, true);
		assert.equal(ran.value, 1);
		const findings = checkMissingHistoryEntry(["src/a.ts"]);
		assert.equal(findings.length, 1);
		assert.equal(findings[0]?.ruleId, "core/history-entry");
	} finally {
		repo.cleanup();
	}
});

test("[§4.9.3] commit-msg on a docs staged set with no staged history entry is blocked", async () => {
	// Docs-class changes owe the history entry like code changes do; only
	// the deps-shaped path stays exempt.
	const repo = createTempRepo();
	try {
		seedConfig(repo);
		repo.commit("fixture");
		stage(repo, "docs/guide.md", "# guide\n");
		const msgFile = commitMsgFile(repo, "docs(cli): touch docs");
		const ran = await handleGitHook(req(["commit-msg", msgFile], repo.dir));
		assert.equal(ran.ok, true);
		assert.equal(ran.value, 1);
		const findings = checkMissingHistoryEntry(["docs/guide.md"]);
		assert.equal(findings.length, 1);
		assert.equal(findings[0]?.ruleId, "core/history-entry");
	} finally {
		repo.cleanup();
	}
});

test("[§4.12.7 EC-12] commit-msg on a deps-shaped staged set with no history entry still trailers", async () => {
	// Control: SPEC §4.12.7 EC-12 keeps the deps path (manifests and
	// lockfiles only, the class bot dependency updates take) exempt from
	// the history requirement, so the trailer append stands alone.
	const repo = createTempRepo();
	try {
		seedConfig(repo);
		repo.commit("fixture");
		stage(repo, "package.json", '{"name": "probe"}\n');
		const msgFile = commitMsgFile(repo, "chore(deps): bump probe");
		const ran = await handleGitHook(req(["commit-msg", msgFile], repo.dir));
		assert.equal(ran.ok, true);
		assert.equal(ran.value, 0);
		assert.match(readFileSync(msgFile, "utf8"), /^Codictator-L3: /m);
		assert.deepEqual(checkMissingHistoryEntry(["package.json"]), []);
	} finally {
		repo.cleanup();
	}
});

test("[§4.9.3] missing-history entry check answers the change class without git", () => {
	// Unit-shaped: the pure change-class judgement behind commit-msg. Code
	// and docs owe the entry; deps-shaped, chore and empty sets owe nothing.
	const code = checkMissingHistoryEntry(["src/a.ts"]);
	assert.equal(code.length, 1);
	assert.equal(code[0]?.ruleId, "core/history-entry");
	assert.equal(checkMissingHistoryEntry(["docs/guide.md"]).length, 1);
	assert.deepEqual(checkMissingHistoryEntry(["package.json"]), []);
	assert.deepEqual(checkMissingHistoryEntry(["yarn.lock"]), []);
	assert.deepEqual(checkMissingHistoryEntry([".codictator/config.json"]), []);
	assert.deepEqual(checkMissingHistoryEntry([]), []);
});
