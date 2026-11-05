import { strict as assert } from "node:assert";

import test from "node:test";

import { readTask } from "../../../src/cli/tasks.ts";

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
