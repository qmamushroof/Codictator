// SPEC §4.12.2: a change that touches code files is reclassified as code and
// owes every gate (BUG-0087: a docs-typed task writing code skipped the red
// proof). Driven through the real CLI in a temp consumer repo.
import { strict as assert } from "node:assert";
import test from "node:test";
import { installConsumer, srcMain } from "../support/consumer-harness.ts";
import { createTempRepo } from "../support/temp-repo.ts";

async function docsTaskInPlanning(
	dir: string,
	allow: ReadonlyArray<string>,
): Promise<string> {
	const created = await srcMain(
		["task", "new", "--type", "docs", "--title", "write notes"],
		dir,
	);
	const id = /created (T-\d+)/.exec(created.stdout)?.[1];
	assert.ok(id !== undefined, `no task id in: ${created.stdout}`);
	const amended = await srcMain(
		[
			"task",
			"amend",
			"--id",
			id,
			"--spec",
			"docs/SPEC/04-12-WORKFLOW.md",
			"--accept",
			"notes written",
			...allow.flatMap((glob) => ["--allow", glob]),
		],
		dir,
	);
	assert.equal(amended.code, 0, `amend failed: ${amended.stderr}`);
	const next = await srcMain(["task", "phase", "next", "--id", id], dir);
	assert.equal(
		next.code,
		0,
		`to planning failed: ${next.stdout}${next.stderr}`,
	);
	return id;
}

test("[§4.12.2] consumer docs task that plans a src write is reclassified as code and owes the red proof", async () => {
	const repo = createTempRepo();
	try {
		await installConsumer(repo);
		repo.git(["checkout", "-b", "docs/mixed"]);
		const id = await docsTaskInPlanning(repo.dir, ["docs/**", "src/**"]);
		const next = await srcMain(["task", "phase", "next", "--id", id], repo.dir);
		assert.notEqual(next.code, 0, `planning exited: ${next.stdout}`);
		const out = `${next.stdout}${next.stderr}`;
		assert.ok(out.includes("red proof"), out);
	} finally {
		repo.cleanup();
	}
});

test("[§4.12.2] consumer docs task that plans only docs paths skips the red proof", async () => {
	const repo = createTempRepo();
	try {
		await installConsumer(repo);
		repo.git(["checkout", "-b", "docs/only"]);
		const id = await docsTaskInPlanning(repo.dir, ["docs/**"]);
		const next = await srcMain(["task", "phase", "next", "--id", id], repo.dir);
		assert.equal(
			next.code,
			0,
			`docs-only blocked: ${next.stdout}${next.stderr}`,
		);
	} finally {
		repo.cleanup();
	}
});
