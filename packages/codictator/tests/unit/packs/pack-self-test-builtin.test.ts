// SPEC §4.4.4 (BUG-0095): every built-in pack passes the real self-test
// over its own case files.
import { strict as assert } from "node:assert";
import test from "node:test";
import {
	builtinCaseSource,
	loadBuiltinPack,
	selfTest,
} from "../../../src/features/packs/index.ts";

for (const id of ["core", "typescript", "python"]) {
	test(`[§4.4.4] the ${id} built-in pack passes self-test over its case files`, async () => {
		const loaded = await loadBuiltinPack(id);
		assert.ok(loaded.ok);
		const source = await builtinCaseSource(id);
		assert.ok(source.ok);
		const result = await selfTest(loaded.value, source.value);
		assert.deepEqual(result.ok ? "pass" : result.error, "pass");
	});
}
