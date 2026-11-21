// BUG-0113 (SPEC §4.12.3): verify --all judges the tree, not a change. It has
// no diff, so core/writes-within-plan judges nothing under --all, while the
// staged and range scopes still judge a write outside the plan.
import { strict as assert } from "node:assert";
import test from "node:test";
import {
	installConsumer,
	srcMain,
	taskId,
	writeTreeFile,
} from "../support/consumer-harness.ts";
import { createTempRepo, type TempRepo } from "../support/temp-repo.ts";

const RULE = "core/writes-within-plan";

async function discoveryRepo(): Promise<TempRepo> {
	const repo = createTempRepo();
	await installConsumer(repo);
	repo.git(["checkout", "-b", "feature/tree-scope"]);
	await taskId(repo, "tree scope widget");
	writeTreeFile(repo, "src/a.ts", "export const a = 1;\n");
	repo.git(["add", "-A"]);
	repo.commit("record and first source");
	return repo;
}

async function output(
	repo: TempRepo,
	args: ReadonlyArray<string>,
): Promise<string> {
	const run = await srcMain(["verify", ...args], repo.dir);
	return `${run.stdout}${run.stderr}`;
}

test("[consumer] [§4.12.3] verify --all judges no write plan over committed task records (BUG-0113)", async () => {
	const repo = await discoveryRepo();
	try {
		const out = await output(repo, ["--all"]);
		assert.ok(!out.includes(RULE), `${RULE} fired under --all:\n${out}`);
	} finally {
		repo.cleanup();
	}
});

test("[consumer] [§4.12.3] writes-within-plan still fires under --staged and a range (BUG-0113)", async () => {
	const repo = await discoveryRepo();
	try {
		writeTreeFile(repo, "src/b.ts", "export const b = 1;\n");
		repo.git(["add", "src/b.ts"]);
		const staged = await output(repo, ["--staged"]);
		assert.ok(staged.includes(RULE), `no ${RULE} under --staged:\n${staged}`);
		repo.commit("second source");
		const ranged = await output(repo, ["--base", "HEAD~1", "--head", "HEAD"]);
		assert.ok(ranged.includes(RULE), `no ${RULE} under a range:\n${ranged}`);
	} finally {
		repo.cleanup();
	}
});
