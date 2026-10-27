import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";
import { extensionId } from "../../src/main.ts";

test("[§4.20] extension entry exposes the package id", () => {
	assert.equal(extensionId, "codictator-vscode");
});

test("[§10.7] vscode red ledger starts empty", () => {
	const text = readFileSync(
		new URL("../red-ledger.json", import.meta.url),
		"utf8",
	);
	assert.equal(/"version":\s*1/.test(text), true);
	assert.equal(/"red":\s*\[\]/.test(text), true);
});
