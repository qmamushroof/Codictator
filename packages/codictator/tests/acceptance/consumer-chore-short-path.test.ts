// BUG-0114 (SPEC §4.12.2): a chore task limited to manifest-owned files runs
// record phase only, so it advances to record with no spec, tests or proofs;
// a chore that plans a code file still owes the planning evidence.
import { strict as assert } from "node:assert";
import test from "node:test";
import { installConsumer, srcMain } from "../support/consumer-harness.ts";
import { createTempRepo, type TempRepo } from "../support/temp-repo.ts";

async function choreRepo(allow: ReadonlyArray<string>): Promise<{
	repo: TempRepo;
	id: string;
}> {
	const repo = createTempRepo();
	await installConsumer(repo);
	repo.git(["checkout", "-b", "chore/regen"]);
	const created = await srcMain(
		["task", "new", "--type", "chore", "--title", "regen harness files"],
		repo.dir,
	);
	assert.equal(created.code, 0, `task new failed: ${created.stderr}`);
	const id = /created (T-\d+)/.exec(created.stdout)?.[1];
	assert.ok(id !== undefined, `no task id in: ${created.stdout}`);
	const args = ["task", "amend", "--id", id];
	for (const glob of allow) {
		args.push("--allow", glob);
	}
	const amended = await srcMain(args, repo.dir);
	assert.equal(amended.code, 0, `amend failed: ${amended.stderr}`);
	return { repo, id };
}

async function next(repo: TempRepo, id: string): Promise<string> {
	const run = await srcMain(["task", "phase", "next", "--id", id], repo.dir);
	return `${run.code}|${run.stdout}${run.stderr}`;
}

test("[consumer] [§4.12.2] a manifest-only chore walks to record with no tests or proofs (BUG-0114)", async () => {
	const { repo, id } = await choreRepo(["package.json", ".githooks/**"]);
	try {
		for (let step = 0; step < 5; step++) {
			const out = await next(repo, id);
			assert.ok(out.startsWith("0|"), `step ${step} blocked: ${out}`);
		}
		const status = await srcMain(["task", "show", id], repo.dir);
		assert.ok(
			`${status.stdout}${status.stderr}`.includes("record"),
			`not in record: ${status.stdout}${status.stderr}`,
		);
	} finally {
		repo.cleanup();
	}
});

test("[consumer] [§4.12.2] a chore planning a code file still owes the planning evidence (BUG-0114)", async () => {
	const { repo, id } = await choreRepo(["package.json", "src/**"]);
	try {
		const out = await next(repo, id);
		assert.ok(out.startsWith("1|"), `code chore was not blocked: ${out}`);
		assert.ok(out.includes("spec refs"), `no discovery gate: ${out}`);
	} finally {
		repo.cleanup();
	}
});
