// SPEC §4.1.2: stableStringify writes 2-space JSON, and task and review
// records are written with it, so the repo formatter must leave them alone.
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import test from "node:test";

const ROOT = join(import.meta.dirname, "..", "..", "..", "..", "..");
const BIOME = join(ROOT, "node_modules", "@biomejs", "biome", "bin", "biome");
const RECORD = '{\n  "version": 1\n}\n';

test("[§4.1.2] biome leaves 2-space task and review records unformatted", () => {
	for (const path of [
		".codictator/tasks/T-9999.json",
		".codictator/reviews/T-9999-r1.json",
	]) {
		const run = spawnSync(
			process.execPath,
			[BIOME, "format", `--stdin-file-path=${path}`],
			{ cwd: ROOT, input: RECORD, encoding: "utf8" },
		);
		// A disabled formatter exits non-zero but echoes the input unchanged.
		assert.equal(run.error, undefined);
		assert.equal(run.stdout, RECORD, path);
	}
});
