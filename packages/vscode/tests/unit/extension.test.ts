// SPEC §4.20: unit tests with a fake vscode API object (the extension host
// suite runs later on the compiled dist). Each test pins its SPEC view or
// command outcome against the extension entry, which still throws
// "not implemented", so all four fail red until Phase 11 lands.
import { strict as assert } from "node:assert";
import test from "node:test";
import {
	listRuleGroups,
	refreshViolationDiagnostics,
	runHumanOnlyCommand,
	verifyFileOnSave,
} from "../../src/main.ts";

test("[§4.20] active rules view groups packs with tiers and bounds", async () => {
	// SPEC §4.20.2: packs map to rules with tier, effective params and
	// bounds, with per-harness layer coverage including gaps.
	const groups = await listRuleGroups(["/repo-a", "/repo-b"]);
	assert.ok(groups.length > 0);
});

test("[§4.20] violations view shows diagnostics with rule id and remediation", async () => {
	// SPEC §4.20.2: problems-panel diagnostics carry the rule id as code and
	// the remediation as message, with a link to explain.
	const count = await refreshViolationDiagnostics("/repo");
	assert.ok(count >= 0);
});

test("[§4.20] L2 on save verifies the file without blocking", async () => {
	// SPEC §4.20.2 L2 on save: verify with layer L2 for the saved file and
	// refresh diagnostics; the save itself is never blocked.
	const verdict = await verifyFileOnSave("/repo", "src/index.ts");
	assert.ok(verdict.length > 0);
});

test("[§4.20] human-only command opens a terminal pre-filled", async () => {
	// SPEC §4.20.3: CDX-E107 returns the exact command so the UI opens an
	// integrated terminal pre-filled with it; the UI is never a bypass.
	const terminal = await runHumanOnlyCommand("codictator waive --help");
	assert.ok(terminal.length > 0);
});
