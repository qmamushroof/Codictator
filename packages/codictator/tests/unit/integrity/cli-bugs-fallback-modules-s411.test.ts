import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ciVerifyExit } from "../../../src/cli/ci.ts";
import { resolveVerifyScope } from "../../../src/cli/evaluate.ts";
import { withTrackedBugsFallback } from "../../../src/cli/git-history.ts";

test("[§4.11] cli bugs-fallback modules keep their public import shape", () => {
	// SPEC §4.11 + §4.9 EC-22: the CI leg resolves the range scope through
	// evaluate.ts and unions tracked BUGS rows through git-history.ts,
	// wired in ci.ts — the public import shape is pinned here like the
	// records/waiver splits.
	assert.equal(typeof resolveVerifyScope, "function");
	assert.equal(typeof withTrackedBugsFallback, "function");
	assert.equal(typeof ciVerifyExit, "function");
	const integrityDir = dirname(fileURLToPath(import.meta.url));
	const ciText = readFileSync(
		join(integrityDir, "..", "..", "..", "src", "cli", "ci.ts"),
		"utf8",
	);
	assert.ok(
		ciText.includes('resolveVerifyScope } from "./evaluate.ts"'),
		"ci.ts imports resolveVerifyScope from evaluate.ts",
	);
	assert.ok(
		ciText.includes('withTrackedBugsFallback } from "./git-history.ts"'),
		"ci.ts imports withTrackedBugsFallback from git-history.ts",
	);
	assert.ok(
		ciText.includes("withTrackedBugsFallback("),
		"ci.ts calls withTrackedBugsFallback on the ranged scope",
	);
});
