// SPEC §4.14.2 core/no-bypass at L4 + BUG-0090: rangeCommits parses `git log`
// output, which separates records with a newline, so no sha after the first
// may carry that newline. Driven over fake git ports.
import { strict as assert } from "node:assert";
import test from "node:test";
import { rangeCommits } from "../../../src/cli/ci-range.ts";
import { createFakePorts } from "../../support/fake-ports.ts";

const FIELD = "\x1f";
const RECORD = "\x1e";
const FIRST = "a".repeat(40);
const SECOND = "b".repeat(40);
const THIRD = "c".repeat(40);

function record(sha: string, message: string): string {
	return `${sha}${FIELD}${FIELD}dev${FIELD}${message}${RECORD}`;
}

function logArgv(): ReadonlyArray<string> {
	return [
		"git",
		"log",
		`--format=%H${FIELD}%P${FIELD}%an${FIELD}%B${RECORD}`,
		"base..head",
	];
}

async function listed(...records: ReadonlyArray<string>) {
	const fake = createFakePorts();
	fake.proc.when(logArgv(), {
		code: 0,
		stdout: records.join("\n"),
		stderr: "",
		timedOut: false,
		truncated: false,
	});
	return rangeCommits({ ...fake.ports, root: "/repo" }, "base", "head");
}

test("[§4.14.2] rangeCommits returns every sha of a multi-commit range clean", async () => {
	const commits = await listed(
		record(FIRST, "feat: one\n"),
		record(SECOND, "feat: two\n"),
		record(THIRD, "feat: three\n"),
	);
	assert.ok(commits.ok);
	assert.deepEqual(
		commits.value.map((commit) => commit.sha),
		[FIRST, SECOND, THIRD],
	);
});

test("[§4.14.2] rangeCommits keeps each commit message intact across records (BUG-0090)", async () => {
	const commits = await listed(
		record(FIRST, "feat: one\n\nbody\n"),
		record(SECOND, "feat: two\n"),
	);
	assert.ok(commits.ok);
	assert.deepEqual(
		commits.value.map((commit) => commit.message),
		["feat: one\n\nbody\n", "feat: two\n"],
	);
});

test("[§4.14.2] rangeCommits strips a CRLF record separator from the next sha", async () => {
	const fake = createFakePorts();
	fake.proc.when(logArgv(), {
		code: 0,
		stdout: `${record(FIRST, "feat: one\n")}\r\n${record(SECOND, "feat: two\n")}`,
		stderr: "",
		timedOut: false,
		truncated: false,
	});
	const commits = await rangeCommits(
		{ ...fake.ports, root: "/repo" },
		"base",
		"head",
	);
	assert.ok(commits.ok);
	assert.deepEqual(
		commits.value.map((commit) => commit.sha),
		[FIRST, SECOND],
	);
});

test("[§4.14.2] rangeCommits returns no commits for an empty range", async () => {
	const commits = await listed();
	assert.ok(commits.ok);
	assert.deepEqual(commits.value, []);
});
