// SPEC §4.20.2: P1 views Steering, Budget and Health. Red-first: the
// p1-views stub still throws "not implemented", so all four fail red until
// step 12.9 lands the implementation.
import { strict as assert } from "node:assert";
import test from "node:test";
import {
	currentBudget,
	healthSummary,
	listSteeringEntries,
	registerSteeringBudgetHealthViews,
} from "../../src/p1-views.ts";
import { createFakeVscode } from "../support/fake-vscode.ts";

test("[§4.20.2] steering view shows exactly what was injected, when and into which harness session", async () => {
	// SPEC §4.20.2 Steering over `steering/history`: each row names the
	// injected content, the time, and the harness session it went into.
	const entries = await listSteeringEntries("/repo");
	assert.ok(entries.length > 0);
	for (const entry of entries) {
		assert.ok(entry.sessionId.length > 0);
		assert.ok(entry.injectedAt.length > 0);
		assert.ok(entry.harness.length > 0);
	}
});

test("[§4.20.2] budget view shows band and usage per session, or unavailable", async () => {
	// SPEC §4.20.2 Budget over `budget/current`: the band and usage per
	// session, or "unavailable" when the engine has no usage to report.
	const budget = await currentBudget("/repo");
	assert.ok(budget.band.length > 0);
	assert.ok(budget.usage.length > 0);
});

test("[§4.20.2] health view shows ratchet trend, dependency freshness, integrity and remediation progress", async () => {
	// SPEC §4.20.2 Health over `status`: ratchet trend, dependency
	// freshness, integrity and remediation progress in one row.
	const health = await healthSummary("/repo");
	assert.ok(health.ratchet.length > 0);
	assert.ok(health.dependencies.length > 0);
	assert.ok(health.integrity.length > 0);
	assert.ok(health.remediation.length > 0);
});

test("[§4.20.2] p1 views register steering, budget and health tree views", () => {
	// SPEC §4.20.2: the Codictator container gains the three P1 tree views
	// beside the P0 ones; each registration pins its view id.
	const api = createFakeVscode();
	registerSteeringBudgetHealthViews(api);
	for (const viewId of [
		"codictator-steering",
		"codictator-budget",
		"codictator-health",
	]) {
		assert.ok(api.treeProviders.has(viewId));
	}
});
