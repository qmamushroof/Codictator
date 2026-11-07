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

function recordFor(overrides: Partial<TaskRecord> = {}): TaskRecord {
	return {
		version: 1,
		id: "T-0001",
		type: "fix",
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

function jsonLine(stdout: string): unknown {
	const at = stdout.indexOf("{");
	assert.ok(at >= 0, `expected a JSON line, saw: ${stdout}`);
	return JSON.parse(stdout.slice(at)) as unknown;
}

test("[§4.12 EC-3] amend --allow sets files.allow", async () => {
	// SPEC docs/SPEC/04-12-WORKFLOW.md:73 (EC-3): the remediation for a
	// write outside files.allow is `codictator task amend --allow <glob>`.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		seedTask(repo, recordFor());
		const ran = await cli(
			[
				"task",
				"amend",
				"--id",
				"T-0001",
				"--allow",
				"packages/codictator/src/cli/task-advance.ts",
			],
			repo.dir,
		);
		assert.equal(ran.code, 0);
		const shown = await cli(["--json", "task", "show", "T-0001"], repo.dir);
		assert.equal(shown.code, 0);
		const record = jsonLine(shown.stdout) as {
			files: { allow: Array<string> };
		};
		assert.deepEqual(record.files.allow, [
			"packages/codictator/src/cli/task-advance.ts",
		]);
		const ids = await listTaskIds(repo.dir);
		assert.deepEqual(ids, ["T-0001"]);
	} finally {
		repo.cleanup();
	}
});

test("[§4.12.2] amend --spec/--diagnosis/--accept sets planning evidence", async () => {
	// SPEC docs/SPEC/04-12-WORKFLOW.md:16 (planning gate): files.allow,
	// acceptance criteria and declared tests; :9 task commands only.
	const repo = createTempRepo({ "README.md": "hi" });
	try {
		seedTask(repo, recordFor());
		const specd = await cli(
			[
				"task",
				"amend",
				"--id",
				"T-0001",
				"--spec",
				"docs/SPEC/04-12-WORKFLOW.md:16",
			],
			repo.dir,
		);
		assert.equal(specd.code, 0);
		const diagnosed = await cli(
			["task", "amend", "--id", "T-0001", "--diagnosis", "repro and cause"],
			repo.dir,
		);
		assert.equal(diagnosed.code, 0);
		const accepted = await cli(
			["task", "amend", "--id", "T-0001", "--accept", "gate passes"],
			repo.dir,
		);
		assert.equal(accepted.code, 0);
		const shown = await cli(["--json", "task", "show", "T-0001"], repo.dir);
		assert.equal(shown.code, 0);
		const record = jsonLine(shown.stdout) as {
			spec: Array<string>;
			diagnosis: string;
			acceptanceCriteria: Array<string>;
		};
		assert.deepEqual(record.spec, ["docs/SPEC/04-12-WORKFLOW.md:16"]);
		assert.equal(record.diagnosis, "repro and cause");
		assert.deepEqual(record.acceptanceCriteria, ["gate passes"]);
	} finally {
		repo.cleanup();
	}
});
