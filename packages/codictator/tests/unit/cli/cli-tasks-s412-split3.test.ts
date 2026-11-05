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
