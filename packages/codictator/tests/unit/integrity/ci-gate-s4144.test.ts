import { strict as assert } from "node:assert";

import test from "node:test";

import {
	EXPECTED_HOOKS_PATH,
	hookInstallPlan,
	renderHookScript,
	renderHuskyBlock,
} from "../../../src/features/integrity/index.ts";

test("[§4.14.4] rendered hook guards node and execs the launcher", async () => {
	// SPEC §4.14.4: each hook verifies node, then execs run.mjs for its hook.
	const script = renderHookScript("pre-commit");
	assert.ok(script.startsWith("#!/bin/sh"));
	assert.ok(script.includes("CDX-E001"));
	assert.ok(script.includes("CDX-E002"));
	assert.ok(script.includes("git pre-commit"));
	assert.ok(script.endsWith("\n"));
	const older = renderHookScript("pre-push", 22);
	assert.ok(older.includes("v22"));
});

test("[§4.14.4] husky block names the hook", async () => {
	// SPEC §4.14.4: with .husky/ present Codictator inserts a managed block.
	const block = renderHuskyBlock("commit-msg");
	assert.ok(block.includes("codictator:begin"));
	assert.ok(block.includes("git commit-msg"));
	assert.ok(block.includes("codictator:end"));
});

test("[§4.14.4] install plan writes hooks with the exec bit", async () => {
	// SPEC §4.14.4 + EC-9/EC-12: mode 755, hooksPath, prepare script.
	const plan = hookInstallPlan();
	assert.equal(plan.hooksPath, EXPECTED_HOOKS_PATH);
	assert.equal(plan.mode, 0o755);
	assert.equal(plan.files.length, 3);
	assert.ok(plan.prepareScript.includes("install-hooks"));
	assert.ok(plan.gitattributes.includes("eol=lf"));
});

test("[§4.14.4] install plan defers to an existing husky setup", async () => {
	// SPEC §4.14.4: .husky/ present means blocks, not a hooks takeover.
	const plan = hookInstallPlan({
		huskyPresent: true,
		existingHooksPath: ".custom-hooks",
	});
	assert.equal(plan.files.length, 0);
	assert.equal(plan.hooksPath, ".custom-hooks");
	assert.equal(plan.huskyBlocks.length, 3);
});
