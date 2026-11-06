// SPEC §10.3 item 6 regression: the live-check template must emit the plain
// JSON.parse call for the external node script, while the src text keeps the
// raw match so the arch guard passes only per occurrence through its
// repo-root-relative path plus string-literal span allowlist.

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { liveCheck } from "../../src/features/ci/workflow-live.ts";
import {
	containingSpan,
	findJsonParseMatches,
	stringLiteralSpans,
} from "../support/arch-scan.ts";

function srcDir(): string {
	return fileURLToPath(new URL("../../src/", import.meta.url));
}

test("[§10.3 item 6] live template emits plain JSON.parse covered only by the allowlist", () => {
	const emitted = liveCheck.join("\n");
	assert.equal(emitted.match(/JSON\.parse\s*\(/g)?.length ?? 0, 2);
	assert.equal(/JSON\.\s*\x22\s*\+/.exec(emitted) === null, true);
	assert.equal(/\x22\s*\+\s*\x22parse/.exec(emitted) === null, true);
	const src = readFileSync(
		path.join(srcDir(), "features", "ci", "workflow-live.ts"),
		"utf8",
	);
	assert.equal(findJsonParseMatches(src).length, 2);
	assert.equal(/JSON\.\s*\x22\s*\+/.exec(src) === null, true);
	assert.equal(/\x22\s*\+\s*\x22parse/.exec(src) === null, true);
	const spans = stringLiteralSpans(src);
	for (const match of findJsonParseMatches(src)) {
		assert.notEqual(containingSpan(spans, match.offset), undefined);
	}
	const guard = readFileSync(
		fileURLToPath(new URL("./architecture.test.ts", import.meta.url)),
		"utf8",
	);
	assert.equal(
		guard.includes(
			"packages/codictator/src/features/ci/workflow-live.ts:21:2-21:64",
		),
		true,
	);
	assert.equal(
		guard.includes(
			"packages/codictator/src/features/ci/workflow-live.ts:80:2-80:86",
		),
		true,
	);
	assert.equal(guard.includes("outside string literal"), true);
	assert.equal(guard.includes("relative to the repository root"), true);
});
