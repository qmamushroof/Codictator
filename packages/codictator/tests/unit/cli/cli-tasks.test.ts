// SPEC §4.12 + §4.19: branch coverage for the task-record CLI (tasks.ts
// plus the task-advance.ts dispatch and task-phases.ts steps) the red
// ledger does not pin. Each scenario drives the built entry in a child
// process (the EC-6 pattern in audit.test.ts), so handler stdout/stderr
// stays assertable: the in-process runner shares process.stdout with
// reporter writes, and intercepting it swallows reporter lines. Nothing
// reaches the network and no wall clock is asserted.
import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
	branchOf,
	listTaskIds,
	readTask,
	taskLine,
	writeTask,
} from "../../../src/cli/tasks.ts";
import type { TaskRecord } from "../../../src/features/workflow/index.ts";
import { MANDATORY_PHASES } from "../../../src/features/workflow/index.ts";
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

test("[§4.19] task dispatch rejects an unknown subcommand", async () => {
	// SPEC §4.19.2: anything outside the task word list is a usage error
	// (exit 2) on stderr.
	const repo = createTempRepo();
	try {
		const ran = await cli(["task", "frobnicate"], repo.dir);
		assert.equal(ran.code, 2);
		assert.ok(ran.stderr.includes("usage: codictator task"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.19] task without a subcommand is a usage error", async () => {
	// SPEC §4.19.2: the bare word lists no record, it prints usage.
	const repo = createTempRepo();
	try {
		const ran = await cli(["task"], repo.dir);
		assert.equal(ran.code, 2);
		assert.ok(ran.stderr.includes("usage: codictator task"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.19] task phase without next is a usage error", async () => {
	// SPEC §4.19.2: "phase" alone is not a word; only "phase next" is.
	const repo = createTempRepo();
	try {
		const ran = await cli(["task", "phase"], repo.dir);
		assert.equal(ran.code, 2);
		assert.ok(ran.stderr.includes("usage: codictator task"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.19] task outside a repo fails CDX-E703", async () => {
	// SPEC §4.19.2: every task word resolves the repo root first.
	const dir = mkdtempSync(path.join(tmpdir(), "codictator-norepo-"));
	try {
		const ran = await cli(["task", "show"], dir);
		assert.equal(ran.code, 6);
		assert.ok(ran.stderr.includes("CDX-E703"));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

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

test("[§4.12] phase next advances a task whose gate holds", async () => {
	// SPEC §4.12.2: with spec refs the discovery gate holds and the task
	// enters planning with phase-entry evidence.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		seedTask(repo, recordFor({ spec: ["§1"] }));
		const ran = await cli(
			["--json", "task", "phase", "next", "--id", "T-0001"],
			repo.dir,
		);
		assert.equal(ran.code, 0);
		assert.deepEqual(jsonLine(ran.stdout), { id: "T-0001", phase: "planning" });
		const moved = await readTask(repo.dir, "T-0001");
		assert.equal(moved?.phase, "planning");
		assert.equal(moved?.phases.length, 1);
	} finally {
		repo.cleanup();
	}
});

test("[§4.12] phase next past the last phase fails CDX-E604", async () => {
	// SPEC §4.12.2: the seven mandatory phases end at integrate; past it
	// the task closes instead of advancing.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const last = MANDATORY_PHASES[MANDATORY_PHASES.length - 1] ?? "integrate";
		seedTask(repo, recordFor({ phase: last }));
		const ran = await cli(
			["task", "phase", "next", "--id", "T-0001"],
			repo.dir,
		);
		assert.equal(ran.code, 1);
		assert.ok(ran.stderr.includes("CDX-E604"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.12] phase next for an unknown id fails CDX-E903", async () => {
	// SPEC §4.12.1: advancing a record that is not there fails closed.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const ran = await cli(
			["task", "phase", "next", "--id", "T-0099"],
			repo.dir,
		);
		assert.equal(ran.code, 5);
		assert.ok(ran.stderr.includes("CDX-E903"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.12] writeTask rejects a record with a bad id", async () => {
	// SPEC §4.12.1: structural validation runs before any port is
	// touched, so ids outside T-#### fail CDX-E604 without I/O.
	const repo = createTempRepo();
	try {
		const saved = await writeTask(repo.dir, recordFor({ id: "nope" }));
		assert.equal(saved.ok, false);
		if (!saved.ok) {
			assert.equal(saved.error.code, "CDX-E604");
		}
	} finally {
		repo.cleanup();
	}
});

test("[§4.12] readTask answers undefined for missing or corrupt records", async () => {
	// SPEC §4.18.1: only paths and digests travel in events, so a task
	// record that is absent or unparsable reads back undefined.
	const repo = createTempRepo();
	try {
		assert.equal(await readTask(repo.dir, "T-0001"), undefined);
		repo.writeFile(".codictator/tasks/T-0001.json", "not json\n");
		assert.equal(await readTask(repo.dir, "T-0001"), undefined);
	} finally {
		repo.cleanup();
	}
});

test("[§4.12] listTaskIds ignores files outside T-####", async () => {
	// SPEC §4.12.1: ids are T-####; anything else in the dir is skipped.
	const repo = createTempRepo();
	try {
		repo.writeFile(".codictator/tasks/notes.json", "{}\n");
		seedTask(repo, recordFor());
		assert.deepEqual(await listTaskIds(repo.dir), ["T-0001"]);
	} finally {
		repo.cleanup();
	}
});

test("[§4.12] taskLine formats the terse record line", () => {
	// SPEC §4.12.1: show surfaces every record through the same line.
	assert.equal(
		taskLine(recordFor({ title: "t" })),
		"T-0001 [docs] discovery: t",
	);
});

test("[§4.12] task new on a detached HEAD fails CDX-E903", async () => {
	// SPEC §4.12.1: creation binds the branch, so a detached HEAD (no
	// current branch) fails closed before any record is written.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		repo.git(["checkout", "--detach"]);
		const ran = await cli(
			["task", "new", "--type", "docs", "--title", "t"],
			repo.dir,
		);
		assert.equal(ran.code, 5);
		assert.ok(ran.stderr.includes("cannot read the current branch"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.12] task amend with a type rewrites the line", async () => {
	// SPEC §4.12.1: amend rewrites the type when only --type is given.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const created = await cli(
			["task", "new", "--type", "docs", "--title", "t"],
			repo.dir,
		);
		assert.equal(created.code, 0);
		const amended = await cli(
			["task", "amend", "--id", "T-0001", "--type", "fix"],
			repo.dir,
		);
		assert.equal(amended.code, 0);
		assert.ok(amended.stdout.includes("T-0001 [fix] discovery: t"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.12] task show prints human lines", async () => {
	// SPEC §4.12.1: the human rendering names the empty set and lists
	// records through the terse line.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const empty = await cli(["task", "show"], repo.dir);
		assert.equal(empty.code, 0);
		assert.ok(empty.stdout.includes("no tasks recorded"));
		const created = await cli(
			["task", "new", "--type", "docs", "--title", "t"],
			repo.dir,
		);
		assert.equal(created.code, 0);
		const listed = await cli(["task", "show"], repo.dir);
		assert.equal(listed.code, 0);
		assert.ok(listed.stdout.includes("T-0001 [docs] discovery: t"));
		const one = await cli(["--json", "task", "show", "T-0001"], repo.dir);
		assert.equal(one.code, 0);
		const body = jsonLine(one.stdout) as { id: string; phase: string };
		assert.equal(body.id, "T-0001");
		assert.equal(body.phase, "discovery");
	} finally {
		repo.cleanup();
	}
});

test("[§4.12] phase next rejects bad flags", async () => {
	// SPEC §4.19.2: stray positionals and unknown flags are usage errors.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const stray = await cli(["task", "phase", "next", "stray"], repo.dir);
		assert.equal(stray.code, 2);
		const bogus = await cli(["task", "phase", "next", "--bogus"], repo.dir);
		assert.equal(bogus.code, 2);
		assert.ok(bogus.stderr.includes("usage: codictator task phase next"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.12] phase next reports blocked and entered phases as text", async () => {
	// SPEC §4.12.2: the human rendering prints each blocking finding with
	// its remediation, and the entered phase on success.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const created = await cli(
			["task", "new", "--type", "docs", "--title", "t"],
			repo.dir,
		);
		assert.equal(created.code, 0);
		const blocked = await cli(
			["task", "phase", "next", "--id", "T-0001"],
			repo.dir,
		);
		assert.equal(blocked.code, 1);
		assert.ok(blocked.stdout.includes("core/workflow-gates"));
		assert.ok(blocked.stdout.includes("Do instead:"));
		seedTask(repo, recordFor({ id: "T-0002", spec: ["§1"] }));
		const moved = await cli(
			["task", "phase", "next", "--id", "T-0002"],
			repo.dir,
		);
		assert.equal(moved.code, 0);
		assert.ok(moved.stdout.includes("task T-0002 entered planning"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.12] task new usage rejects stray positionals and flags", async () => {
	// SPEC §4.19.2: new takes only --type and --title.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const stray = await cli(
			["task", "new", "--type", "docs", "--title", "t", "stray"],
			repo.dir,
		);
		assert.equal(stray.code, 2);
		const bogus = await cli(
			["task", "new", "--type", "docs", "--title", "t", "--bogus"],
			repo.dir,
		);
		assert.equal(bogus.code, 2);
	} finally {
		repo.cleanup();
	}
});

test("[§4.12] task checkpoint prints human confirmation", async () => {
	// SPEC §4.12.6: the human rendering confirms the checkpoint.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		const created = await cli(
			["task", "new", "--type", "docs", "--title", "t"],
			repo.dir,
		);
		assert.equal(created.code, 0);
		const ran = await cli(["task", "checkpoint", "--id", "T-0001"], repo.dir);
		assert.equal(ran.code, 0);
		assert.ok(ran.stdout.includes("checkpoint recorded for T-0001"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.12] task close prints human confirmation", async () => {
	// SPEC §4.12.6: the human rendering names the closed id.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		seedTask(repo, recordFor());
		const ran = await cli(["task", "close", "--id", "T-0001"], repo.dir);
		assert.equal(ran.code, 0);
		assert.ok(ran.stdout.includes("closed T-0001"));
	} finally {
		repo.cleanup();
	}
});

test("[§4.12] branchOf answers undefined outside a repo", async () => {
	// SPEC §4.12.1: creation binds the branch, so outside git there is
	// no branch to bind.
	const dir = mkdtempSync(path.join(tmpdir(), "codictator-nobranch-"));
	try {
		assert.equal(await branchOf(dir), undefined);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
