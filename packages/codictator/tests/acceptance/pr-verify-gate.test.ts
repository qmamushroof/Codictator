// BUG-0064: the generated verify workflow no-oped on pull_request (SPEC
// §4.15 EC-12), so PRs merged with no pre-merge gate. This acceptance test
// drives the real init plan writer and asserts the generated artifact
// judges every event instead of reporting SUCCESS through a no-op.
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { guardrailPlan, writePlan } from "../../src/cli/plan.ts";
import { createTempRepo } from "../support/temp-repo.ts";

test("[§4.15 EC-12] generated verify workflow judges pull_request instead of reporting SUCCESS through the no-op", async () => {
	const repo = createTempRepo();
	try {
		const wrote = await writePlan(
			repo.dir,
			guardrailPlan(["opencode"], "", path.basename(repo.dir), undefined),
		);
		assert.ok(wrote.ok);
		const yml = readFileSync(
			`${repo.dir}/.github/workflows/codictator.yml`,
			"utf8",
		);
		assert.ok(yml.includes("pull_request:"));
		assert.ok(!yml.includes("PR dedup no-op"));
		assert.ok(yml.includes("ci verify"));
	} finally {
		repo.cleanup();
	}
});
