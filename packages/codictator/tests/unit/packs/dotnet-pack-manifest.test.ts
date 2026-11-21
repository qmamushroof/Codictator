// SPEC §4.4.1 and §6.2 (BUG-0104): the built-in dotnet pack ships a
// pack.json, so a config listing it loads.
import { strict as assert } from "node:assert";
import test from "node:test";
import { loadBuiltinPack } from "../../../src/features/packs/index.ts";

test("[§4.4.1] the dotnet built-in pack loads from its pack.json with the §6.2 capabilities", async () => {
	const loaded = await loadBuiltinPack("dotnet");
	assert.ok(loaded.ok);
	assert.equal(loaded.value.manifest.id, "dotnet");
	assert.equal(loaded.value.manifest.maxWaiverDays, 90);
	const capabilities = JSON.stringify(loaded.value.manifest.capabilities);
	assert.ok(capabilities.includes("Newtonsoft.Json"));
	assert.ok(capabilities.includes("NSubstitute"));
});
