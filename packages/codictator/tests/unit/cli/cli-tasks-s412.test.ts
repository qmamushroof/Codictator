import { strict as assert } from "node:assert";

import test from "node:test";

import { listTaskIds } from "../../../src/cli/tasks.ts";

import type { TaskRecord } from "../../../src/features/workflow/index.ts";

import { type CliResult, runNodeScript } from "../../support/cli-runner.ts";

import { createTempRepo, type TempRepo } from "../../support/temp-repo.ts";

async function cli(
	argv: ReadonlyArray<string>,
	cwd: string,
): Promise<CliResult> {
	const entry = new URL("../../../src/cli/main.ts", import.meta.url).href;
	const script = `const { main } = await import(${JSON.stringify(entry)}); process.exitCode = await main(${JSON.stringify(argv)}, ${JSON.stringify(cwd)});`;
	return runNodeScript({
		nodeArgs: ["--input-type=module", "-e", script],
		cwd,
		timeoutMs: 120000,
	});
}

function jsonLine(stdout: string): unknown {
	const at = stdout.indexOf("{");
	assert.ok(at >= 0, `expected a JSON line, saw: ${stdout}`);
	return JSON.parse(stdout.slice(at)) as unknown;
}

function recordFor(overrides: Partial<TaskRecord> = {}): TaskRecord {
	return {
		version: 1,
		id: "T-0001",
		type: "docs",
		title: "task",
		branch: "main",
		phase: "discovery",
		phases: [],
		spec: [],
		acceptanceCriteria: [],
		files: { allow: [] },
		...overrides,
	};
}

function seedTask(repo: TempRepo, record: TaskRecord): void {
	repo.writeFile(
		`.codictator/tasks/${record.id}.json`,
		`${JSON.stringify(record)}\n`,
	);
}

test("[§4.12] task new needs a type and a title", async () => {
	// SPEC §4.12.1: creation without flags is a usage error (exit 2).
	const repo = createTempRepo();
	try {
		const ran = await cli(["task", "new"], repo.dir);
		assert.equal(ran.code, 2);
		assert.ok(ran.stderr.includes("usage: codictator task new"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.12] task new on an unborn branch still binds a branch", async () => {
	// SPEC §4.12.1: creation binds the branch; git names the unborn HEAD,
	// so the record carries it even before the first commit.
	const repo = createTempRepo();
	try {
		const ran = await cli(
			["--json", "task", "new", "--type", "docs", "--title", "t"],
			repo.dir,
		);
		assert.equal(ran.code, 0);
		const made = jsonLine(ran.stdout) as { id: string; branch: string };
		assert.equal(made.id, "T-0001");
		assert.ok(made.branch.length > 0);
	} finally {
		repo.cleanup();
	}
});

test("[§4.12] task new and show round-trip a record", async () => {
	// SPEC §4.12.1: creation binds branch, starts at discovery and numbers
	// T-####; show lists every record through the same terse line.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const created = await cli(
			["--json", "task", "new", "--type", "docs", "--title", "write docs"],
			repo.dir,
		);
		assert.equal(created.code, 0);
		const made = jsonLine(created.stdout) as {
			id: string;
			phase: string;
			branch: string;
		};
		assert.equal(made.id, "T-0001");
		assert.equal(made.phase, "discovery");
		assert.ok(made.branch.length > 0);
		const listed = await cli(["--json", "task", "show"], repo.dir);
		assert.equal(listed.code, 0);
		assert.deepEqual(jsonLine(listed.stdout), { tasks: ["T-0001"] });
		const shown = await cli(["task", "show", "T-0001"], repo.dir);
		assert.equal(shown.code, 0);
		assert.ok(shown.stdout.includes("T-0001 [docs] discovery: write docs"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.12] task show for an unknown id fails CDX-E903", async () => {
	// SPEC §4.12.1: reading a record that is not there fails closed.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await cli(["task", "show", "T-0099"], repo.dir);
		assert.equal(ran.code, 5);
		assert.ok(ran.stderr.includes("CDX-E903"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.12] task show with no tasks reports the empty list", async () => {
	// SPEC §4.12.1: an empty task dir lists zero ids instead of failing.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await cli(["--json", "task", "show"], repo.dir);
		assert.equal(ran.code, 0);
		assert.deepEqual(jsonLine(ran.stdout), { tasks: [] });
	} finally {
		repo.cleanup();
	}
});

test("[§4.12] task checkpoint needs an id and a record", async () => {
	// SPEC §4.12.6: the checkpoint word takes --id; a stray positional is
	// a usage error, and an unknown id fails CDX-E903 before any state
	// is written.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const usage = await cli(["task", "checkpoint", "stray"], repo.dir);
		assert.equal(usage.code, 2);
		const missing = await cli(
			["task", "checkpoint", "--id", "T-0099"],
			repo.dir,
		);
		assert.equal(missing.code, 5);
		assert.ok(missing.stderr.includes("CDX-E903"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.12] task checkpoint records the phase and branch", async () => {
	// SPEC §4.12.6: checkpoints are cache state with the task's phase.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const created = await cli(
			["task", "new", "--type", "docs", "--title", "t"],
			repo.dir,
		);
		assert.equal(created.code, 0);
		const ran = await cli(
			["--json", "task", "checkpoint", "--id", "T-0001"],
			repo.dir,
		);
		assert.equal(ran.code, 0);
		assert.deepEqual(jsonLine(ran.stdout), { id: "T-0001", checkpoint: true });
	} finally {
		repo.cleanup();
	}
});

test("[§4.12] task close moves an unknown or known record", async () => {
	// SPEC §4.12.6: closing an unknown id fails CDX-E903; closing a known
	// record moves it out of the open set.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const missing = await cli(["task", "close", "--id", "T-0099"], repo.dir);
		assert.equal(missing.code, 5);
		assert.ok(missing.stderr.includes("CDX-E903"));
		const created = await cli(
			["task", "new", "--type", "docs", "--title", "t"],
			repo.dir,
		);
		assert.equal(created.code, 0);
		const closed = await cli(["task", "close", "--id", "T-0001"], repo.dir);
		assert.equal(closed.code, 0);
		assert.deepEqual(await listTaskIds(repo.dir), []);
	} finally {
		repo.cleanup();
	}
});

test("[§4.12] task amend needs a field and rewrites the line", async () => {
	// SPEC §4.12.1: amend without a field is a usage error; with a title
	// the terse line carries the new title.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const created = await cli(
			["task", "new", "--type", "docs", "--title", "old"],
			repo.dir,
		);
		assert.equal(created.code, 0);
		const usage = await cli(["task", "amend", "--id", "T-0001"], repo.dir);
		assert.equal(usage.code, 2);
		const amended = await cli(
			["task", "amend", "--id", "T-0001", "--title", "new"],
			repo.dir,
		);
		assert.equal(amended.code, 0);
		assert.ok(amended.stdout.includes("T-0001 [docs] discovery: new"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.12] task ack without a TTY fails CDX-E107", async () => {
	// SPEC §4.2.3: ack clears an escalation and stays human-only, so the
	// child process without a TTY is refused with CDX-E107 (exit 4).
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		seedTask(repo, recordFor());
		const ran = await cli(
			["task", "ack", "--id", "T-0001", "--note", "seen"],
			repo.dir,
		);
		assert.equal(ran.code, 4);
		assert.ok(ran.stderr.includes("CDX-E107"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.12] phase next on a fresh task lists missing evidence", async () => {
	// SPEC §4.12.2: discovery owes spec refs, so the first advance blocks
	// (exit 1) with the gate evidence instead of moving phase.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const created = await cli(
			["task", "new", "--type", "docs", "--title", "t"],
			repo.dir,
		);
		assert.equal(created.code, 0);
		const ran = await cli(
			["--json", "task", "phase", "next", "--id", "T-0001"],
			repo.dir,
		);
		assert.equal(ran.code, 1);
		const body = jsonLine(ran.stdout) as {
			id: string;
			phase: string;
			blocked: Array<{ message: string }>;
		};
		assert.equal(body.phase, "discovery");
		assert.ok((body.blocked[0]?.message ?? "").includes("spec refs"));
	} finally {
		repo.cleanup();
	}
});
