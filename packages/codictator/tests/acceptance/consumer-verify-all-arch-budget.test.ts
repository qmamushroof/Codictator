// BUG-0118 (SPEC §5.7, §4.11.4): verify --all over a wide tree judges
// core/arch-boundaries within its budget, with no CDX-E902 and no finding.
import { strict as assert } from "node:assert";
import test from "node:test";
import {
	installConsumer,
	srcMain,
	writeTreeFile,
} from "../support/consumer-harness.ts";
import { createTempRepo } from "../support/temp-repo.ts";

test("[consumer] [§5.7] verify --all judges core/arch-boundaries within its budget (BUG-0118)", async () => {
	const repo = createTempRepo();
	try {
		await installConsumer(repo);
		for (let i = 0; i < 60; i += 1) {
			writeTreeFile(repo, `src/wide${i}.ts`, `export const w${i} = ${i};\n`);
		}
		repo.git(["add", "-A"]);
		repo.commit("wide tree");
		const run = await srcMain(["verify", "--all"], repo.dir);
		const out = `${run.stdout}${run.stderr}`;
		assert.ok(!out.includes("CDX-E902"), `a guard timed out:\n${out}`);
		assert.ok(!out.includes("core/arch-boundaries"), `arch fired:\n${out}`);
	} finally {
		repo.cleanup();
	}
});
