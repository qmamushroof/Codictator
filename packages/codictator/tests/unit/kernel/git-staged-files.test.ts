// Standing deviation (same as the branch deviation): these branch-level unit
// tests pass green and stay unlisted while the future-phase red rows stay
// listed. Covers SPEC §4.1.1 NodeGit stagedFiles over the scripted FakeProc:
// staged deletions never reach enforcers (BUG-0040).
import { strict as assert } from "node:assert";
import test from "node:test";
import type { ProcResult } from "../../../src/kernel/index.ts";
import { NodeGit } from "../../../src/kernel/index.ts";
import { FakeProc } from "../../support/fake-proc.ts";

function result(overrides: Partial<ProcResult> = {}): ProcResult {
	return {
		code: 0,
		stdout: "",
		stderr: "",
		timedOut: false,
		truncated: false,
		...overrides,
	};
}

function gitWith(handler: (proc: FakeProc) => void): {
	git: NodeGit;
	proc: FakeProc;
} {
	const proc = new FakeProc();
	handler(proc);
	return { git: new NodeGit(proc, "repo"), proc };
}

test("[§4.1] git staged files split and sort", async () => {
	const { git } = gitWith((fake) => {
		fake.when(
			["git", "diff", "--name-only", "--cached", "--diff-filter=ACMR"],
			result({ stdout: "b.ts\na.ts\n\n" }),
		);
	});
	const staged = await git.stagedFiles();
	assert.equal(staged.ok, true);
	if (staged.ok) {
		assert.deepEqual(staged.value, ["a.ts", "b.ts"]);
	}
});

test("[§4.1] git staged files failing is CDX-E703", async () => {
	const { git } = gitWith((fake) => {
		fake.when(
			["git", "diff", "--name-only", "--cached", "--diff-filter=ACMR"],
			result({ code: 128 }),
		);
	});
	const staged = await git.stagedFiles();
	assert.equal(staged.ok, false);
	if (!staged.ok) {
		assert.equal(staged.error.code, "CDX-E703");
	}
});

test("[§4.1] git staged files exclude staged deletions (BUG-0040)", async () => {
	// A staged deletion has no worktree content, so a staged list that
	// includes it sends enforcers into a fail-closed readErrorFinding and
	// verify --staged can never go green on a SPEC-blessed task close. Git
	// applies the ACMR filter itself; the harness only forwards the list.
	const { git, proc } = gitWith((fake) => {
		fake.when(
			["git", "diff", "--name-only", "--cached", "--diff-filter=ACMR"],
			result({ stdout: "kept.ts\n" }),
		);
	});
	const staged = await git.stagedFiles();
	assert.equal(staged.ok, true);
	if (staged.ok) {
		assert.deepEqual(staged.value, ["kept.ts"]);
	}
	assert.deepEqual(proc.calls[0]?.argv, [
		"git",
		"diff",
		"--name-only",
		"--cached",
		"--diff-filter=ACMR",
	]);
});
