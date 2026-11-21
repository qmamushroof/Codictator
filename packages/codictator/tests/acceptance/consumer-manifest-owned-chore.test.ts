// BUG-0116 (SPEC §4.14.1, §4.12.2): a chore limited to manifest-owned files,
// including a path the manifest lists, takes the record-only short path; a
// chore that also plans a file the manifest does not list does not.
import { strict as assert } from "node:assert";
import test from "node:test";
import { buildManifest } from "../../src/features/integrity/index.ts";
import { sha256Text, stableStringify } from "../../src/kernel/index.ts";
import { installConsumer, srcMain } from "../support/consumer-harness.ts";
import { createTempRepo, type TempRepo } from "../support/temp-repo.ts";

async function choreRepo(allow: ReadonlyArray<string>): Promise<{
	repo: TempRepo;
	id: string;
}> {
	const repo = createTempRepo();
	await installConsumer(repo);
	const artifacts = ["AGENTS.md", ".claude/settings.json"].map((path) => ({
		path,
		owner: "core",
		mode: "file" as const,
		hash: sha256Text(path),
	}));
	repo.writeFile(
		".codictator/manifest.json",
		`${stableStringify(buildManifest("unknown", artifacts))}\n`,
	);
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

test("[consumer] [§4.14.1] a chore staging manifest-listed files walks to record with no tests or proofs (BUG-0116)", async () => {
	const { repo, id } = await choreRepo(["AGENTS.md", ".claude/**"]);
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

test("[consumer] [§4.14.1] a chore also planning a file the manifest does not list still owes the planning evidence (BUG-0116)", async () => {
	const { repo, id } = await choreRepo(["AGENTS.md", "src/**"]);
	try {
		const out = await next(repo, id);
		assert.ok(out.startsWith("1|"), `code chore was not blocked: ${out}`);
		assert.ok(out.includes("spec refs"), `no discovery gate: ${out}`);
	} finally {
		repo.cleanup();
	}
});
