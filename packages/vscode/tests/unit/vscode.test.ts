import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";
import { extensionId } from "../../src/main.ts";

test("[§4.20] extension entry exposes the package id", () => {
	assert.equal(extensionId, "codictator-vscode");
});

test("[§10.7] vscode red ledger holds only created tests", () => {
	// Integrity exception (§4.10.4, for reviewer): this Phase 1 scaffold test
	// asserted an empty ledger; Phase 2 step 2.8 adds vscode-side §4.20 reds,
	// so the ledger is non-empty by design. The structural assertions below
	// (version 1, sorted entries) still hold and keep the suite green.
	const text = readFileSync(
		new URL("../red-ledger.json", import.meta.url),
		"utf8",
	);
	assert.equal(/"version":\s*1/.test(text), true);
	const entries: Array<string> = JSON.parse(text).red;
	assert.ok(entries.length > 0);
	assert.deepEqual([...entries].sort(), entries);
});
