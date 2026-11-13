// SPEC §4.1.2: a task record written by the CLI (stableStringify, 2-space)
// must pass through the repo's own biome config unchanged, or every CLI task
// write leaves `biome ci` red (BUG-0080).
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
	installConsumer,
	packageRoot,
	taskId,
} from "../support/consumer-harness.ts";
import { createTempRepo } from "../support/temp-repo.ts";

test("[§4.1.2] a CLI-written task record passes the repo biome format unchanged", async () => {
	const root = path.resolve(packageRoot(), "..", "..");
	const repo = createTempRepo();
	try {
		await installConsumer(repo);
		const id = await taskId(repo, "record format probe");
		const rel = `.codictator/tasks/${id}.json`;
		const written = readFileSync(path.join(repo.dir, rel), "utf8");
		assert.ok(written.includes('\n  "'), "the CLI writes 2-space JSON");
		repo.writeFile(
			"biome.json",
			readFileSync(path.join(root, "biome.json"), "utf8"),
		);
		const biome = path.join(
			root,
			"node_modules",
			"@biomejs",
			"biome",
			"bin",
			"biome",
		);
		const run = spawnSync(
			process.execPath,
			[biome, "format", `--stdin-file-path=${rel}`],
			{ cwd: repo.dir, input: written, encoding: "utf8" },
		);
		assert.equal(run.error, undefined);
		assert.equal(run.stdout, written);
	} finally {
		repo.cleanup();
	}
});
