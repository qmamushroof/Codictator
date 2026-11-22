import { strict as assert } from "node:assert";

import test from "node:test";

import { setupHandoffLines } from "../../../src/cli/setup-handoff.ts";

import { BUILTIN_PACK_IDS } from "../../../src/features/packs/index.ts";

const LANGUAGE_IDS = BUILTIN_PACK_IDS.filter((id) => id !== "core");

test("[§4.19.6] the empty-packs hint offers a repair line per built-in pack except core", () => {
	// SPEC §4.19.6 step 8: one repair line per built-in pack id of §4.4.2
	// except core, in list order, so a new pack needs no text edit.
	const lines = setupHandoffLines(true);
	const repair = lines.filter((line) => line.includes("--repair --pack"));
	assert.deepEqual(
		repair,
		LANGUAGE_IDS.map((id) => `  npx codictator setup --repair --pack ${id}`),
	);
	for (const id of ["typescript", "dotnet", "python"]) {
		assert.ok(lines.includes(`  npx codictator setup --repair --pack ${id}`));
	}
	assert.ok(!lines.some((line) => line.includes("--pack core")));
	assert.deepEqual(lines, [
		"Setup complete — core rules only. No language packs installed.",
		"To add a language pack, run the line for your language:",
		...LANGUAGE_IDS.map((id) => `  npx codictator setup --repair --pack ${id}`),
		`Fresh adoption omits --repair: npx codictator setup --pack <${LANGUAGE_IDS.join("|")}>`,
		"To install the VS Code extension, run:",
		"  code --install-extension codictator.codictator-vscode",
	]);
});

test("[§4.19.6] the fresh hint joins the built-in pack ids except core with a pipe", () => {
	// SPEC §4.19.6 step 8: <ids> is the same ids joined with | in <>.
	const lines = setupHandoffLines(true);
	assert.ok(
		lines.includes(
			"Fresh adoption omits --repair: npx codictator setup --pack <typescript|dotnet|python>",
		),
	);
	assert.ok(!lines.some((line) => line.includes("core|")));
	assert.ok(!lines.some((line) => line.includes("|core")));
});
