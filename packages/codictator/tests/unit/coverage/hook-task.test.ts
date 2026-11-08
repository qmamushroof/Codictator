// SPEC §4.19.3 + §4.12.2: the git word entry rejects unknown hooks, and
// task amend merges set-accept. Amend is append-only except the set-* lists,
// which replace the polluted plan by command instead of hand edits.
import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { handleGitHook } from "../../../src/cli/git-hook.ts";
import type { CommandRequest } from "../../../src/cli/shared.ts";
import { taskAmend } from "../../../src/cli/task-amend.ts";
import type { TaskRecord } from "../../../src/features/workflow/index.ts";

function requestFor(args: ReadonlyArray<string>): CommandRequest {
	return {
		args,
		json: false,
		quiet: true,
		cwd: process.cwd(),
		nodeVersion: "v25.2.1",
		stdinText: undefined,
	};
}

function taskFor(over: Partial<TaskRecord> = {}): TaskRecord {
	return {
		version: 1,
		id: "T-0001",
		type: "fix",
		title: "fix a defect",
		branch: "fix/x",
		phase: "implementation",
		phases: [],
		spec: ["docs/SPEC/10-TESTING-STRATEGY.md"],
		acceptanceCriteria: ["old criterion"],
		files: { allow: ["src/**"] },
		...over,
	};
}

function amendRoot(): string {
	const root = mkdtempSync(path.join(tmpdir(), "codictator-amend-test-"));
	mkdirSync(path.join(root, ".codictator", "tasks"), { recursive: true });
	return root;
}

function readAmended(root: string, id: string): TaskRecord {
	const raw = readFileSync(
		path.join(root, ".codictator", "tasks", `${id}.json`),
		"utf8",
	);
	return JSON.parse(raw) as TaskRecord;
}

test("[§4.19] the git entry rejects an unknown hook", async () => {
	const seen = await handleGitHook(requestFor(["frobnicate"]));
	assert.equal(seen.ok, true);
	if (!seen.ok) {
		return;
	}
	assert.equal(seen.value, 2);
});

test("[§4.19] the git entry rejects a missing hook", async () => {
	const seen = await handleGitHook(requestFor([]));
	assert.equal(seen.ok, true);
	if (!seen.ok) {
		return;
	}
	assert.equal(seen.value, 2);
});

test("[§4.12] amend with no changes is a usage error", async () => {
	const root = amendRoot();
	try {
		const seen = await taskAmend(
			requestFor([]),
			root,
			taskFor(),
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			false,
			false,
		);
		assert.equal(seen.ok, true);
		if (!seen.ok) {
			return;
		}
		assert.equal(seen.value, 2);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("[§4.12] amend set-accept replaces the criteria list", async () => {
	const root = amendRoot();
	try {
		const seen = await taskAmend(
			requestFor([]),
			root,
			taskFor(),
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			["new criterion"],
			undefined,
			undefined,
			false,
			false,
		);
		assert.equal(seen.ok, true);
		if (!seen.ok) {
			return;
		}
		assert.equal(seen.value, 0);
		assert.deepEqual(readAmended(root, "T-0001").acceptanceCriteria, [
			"new criterion",
		]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("[§4.12] amend test refs default to regression kind", async () => {
	const root = amendRoot();
	try {
		const seen = await taskAmend(
			requestFor([]),
			root,
			taskFor(),
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			["tests/a.test.ts"],
			undefined,
			false,
			false,
		);
		assert.equal(seen.ok, true);
		if (!seen.ok) {
			return;
		}
		assert.equal(seen.value, 0);
		assert.deepEqual(readAmended(root, "T-0001").tests, [
			{ path: "tests/a.test.ts", title: "tests/a.test.ts", kind: "regression" },
		]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("[§4.12] amend stays loud when the amended record is invalid", async () => {
	const root = amendRoot();
	try {
		const seen = await taskAmend(
			requestFor([]),
			root,
			taskFor({ id: "nope" }),
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			["new criterion"],
			undefined,
			undefined,
			false,
			false,
		);
		assert.equal(seen.ok, false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
