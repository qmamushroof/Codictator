import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";
import { extensionId } from "../../src/main.ts";

test("[§4.20] extension entry exposes the package id", () => {
	assert.equal(extensionId, "codictator-vscode");
});

test("[§10.7] vscode red ledger holds only created tests", () => {
	// Integrity note (§4.10.4, for reviewer): PR0 added SPEC §4.20 EC-11 and
	// EC-12, whose citing tests failed until PR 1 wired the fixes; PR 1
	// turned them green, so the ledger is back to the empty pin.
	const text = readFileSync(
		new URL("../red-ledger.json", import.meta.url),
		"utf8",
	);
	assert.equal(/"version":\s*1/.test(text), true);
	const entries: Array<string> = JSON.parse(text).red;
	assert.deepEqual(entries, []);
});
