// SPEC §4.12.1: the shared task-record and branch reads behind the packs,
// steering and CLI active-task lookups. Records come back id-sorted with
// malformed or non-JSON entries skipped; an unreadable or empty branch read
// answers undefined so callers judge with no active task.
import { strict as assert } from "node:assert";
import test from "node:test";
import {
	readBranchAt,
	readTaskRecords,
	TASKS_DIR,
} from "../../../src/features/workflow/index.ts";
import { createFakePorts } from "../../support/fake-ports.ts";

const BRANCH_ARGV = ["git", "branch", "--show-current"];

function record(id: string): string {
	return JSON.stringify({ version: 1, id, branch: "b", phase: "planning" });
}

test("[§4.12.1] task records read id-sorted, skipping malformed entries", async () => {
	const fake = createFakePorts();
	fake.fs.seedText(`${TASKS_DIR}/T-0002.json`, record("T-0002"));
	fake.fs.seedText(`${TASKS_DIR}/T-0001.json`, record("T-0001"));
	fake.fs.seedText(`${TASKS_DIR}/T-0003.json`, "{not json");
	fake.fs.seedText(`${TASKS_DIR}/T-0004.json`, JSON.stringify({ id: 4 }));
	fake.fs.seedText(`${TASKS_DIR}/notes.txt`, record("T-0009"));
	const records = await readTaskRecords(fake.ports);
	assert.deepEqual(
		records.map((task) => task.id),
		["T-0001", "T-0002"],
	);
});

test("[§4.12.1] branch read trims the current branch and answers undefined when unreadable", async () => {
	const fake = createFakePorts();
	const ok = { stderr: "", timedOut: false, truncated: false };
	fake.proc.when(BRANCH_ARGV, { ...ok, code: 0, stdout: "fix/a\n" });
	assert.equal(await readBranchAt(fake.ports, "/repo"), "fix/a");
	fake.proc.when(BRANCH_ARGV, { ...ok, code: 0, stdout: "\n" });
	assert.equal(await readBranchAt(fake.ports, "/repo"), undefined);
	fake.proc.when(BRANCH_ARGV, { ...ok, code: 128, stdout: "" });
	assert.equal(await readBranchAt(fake.ports, "/repo"), undefined);
	fake.proc.when(BRANCH_ARGV, { ...ok, code: 0, stdout: "x", truncated: true });
	assert.equal(await readBranchAt(fake.ports, "/repo"), undefined);
	assert.equal(fake.proc.calls[0]?.options.cwd, "/repo");
});
