// SPEC §4.9.3 EC-9 + BUG-0083: the L4 history-entry check judges each
// non-merge commit in the range on its own files, over fake git ports.
import { strict as assert } from "node:assert";
import test from "node:test";
import { rangeHistoryFindings } from "../../../src/cli/ci-history.ts";
import { createFakePorts } from "../../support/fake-ports.ts";

const SHA = "abcdef1234567890";

function commit(sha: string, isMerge: boolean) {
	return { sha, message: "m", author: "a", isMerge };
}

function diffTree(sha: string): ReadonlyArray<string> {
	return [
		"git",
		"diff-tree",
		"--no-commit-id",
		"--name-only",
		"-r",
		"--root",
		"-z",
		sha,
	];
}

function listing(files: ReadonlyArray<string>) {
	return {
		code: 0,
		stdout: files.map((file) => `${file}\0`).join(""),
		stderr: "",
		timedOut: false,
		truncated: false,
	};
}

function portsWith(sha: string, files: ReadonlyArray<string>) {
	const fake = createFakePorts();
	fake.proc.when(diffTree(sha), listing(files));
	return { ...fake.ports, root: "/repo" };
}

test("[§4.9.3 EC-9] a code commit with no HISTORY file is flagged", async () => {
	const found = await rangeHistoryFindings(portsWith(SHA, ["src/a.ts"]), [
		commit(SHA, false),
	]);
	assert.deepEqual(
		found.map((finding) => finding.ruleId),
		["core/history-entry"],
	);
	assert.ok(found[0]?.message.includes("abcdef1"));
});

test("[§4.9.3 EC-9] a commit touching a HISTORY file is not flagged", async () => {
	const found = await rangeHistoryFindings(
		portsWith(SHA, ["src/a.ts", "docs/HISTORY/2026-01-01.md"]),
		[commit(SHA, false)],
	);
	assert.deepEqual(found, []);
});

test("[§4.9.3 EC-9] a merge commit owes no entry and is never read", async () => {
	const fake = createFakePorts();
	fake.proc.whenMissing({
		code: 1,
		stdout: "",
		stderr: "must not run",
		timedOut: false,
		truncated: false,
	});
	const found = await rangeHistoryFindings({ ...fake.ports, root: "/repo" }, [
		commit(SHA, true),
	]);
	assert.deepEqual(found, []);
});

test("[§4.9.3 EC-9] a commit whose files cannot be read fails closed", async () => {
	const fake = createFakePorts();
	fake.proc.whenMissing({
		code: 128,
		stdout: "",
		stderr: "fatal: bad object",
		timedOut: false,
		truncated: false,
	});
	const found = await rangeHistoryFindings({ ...fake.ports, root: "/repo" }, [
		commit(SHA, false),
	]);
	assert.deepEqual(
		found.map((finding) => finding.ruleId),
		["core/history-entry"],
	);
});
