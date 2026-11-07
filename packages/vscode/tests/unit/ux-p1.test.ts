// SPEC §4.20.2: the PR4 Steering, Budget and Health polish — session
// grouping with a read-only virtual document, progress labels with human
// reasons, and state icons with repair actions. Red-first: the p1-views.ts
// and steering-doc.ts additions do not exist yet.
import { strict as assert } from "node:assert";
import test from "node:test";
import { healthRows } from "../../src/health-views.ts";
import {
	budgetLabel,
	currentBudget,
	groupInjectionsBySession,
	listSteeringEntries,
} from "../../src/p1-views.ts";
import {
	createSteeringDocStore,
	injectionUri,
	registerSteeringDoc,
} from "../../src/steering-doc.ts";

test("[§4.20.2] steering groups injections by session with a read-only virtual document", async () => {
	// SPEC §4.20.2 PR4: one row per session; the full injected text opens in
	// a read-only virtual document, never an editable file.
	const entries = await listSteeringEntries("/repo", () =>
		Promise.resolve({
			injections: [
				{
					harness: "opencode",
					sessionId: "s1",
					text: "steer one",
					ts: "2026-11-07T11:00:00.000Z",
				},
				{
					harness: "opencode",
					sessionId: "s1",
					text: "steer two",
					ts: "2026-11-07T11:30:00.000Z",
				},
				{
					harness: "Muse",
					sessionId: "s2",
					ts: "2026-11-07T11:45:00.000Z",
				},
			],
		}),
	);
	const sessions = groupInjectionsBySession(entries);
	assert.deepEqual(
		sessions.map((session) => session.sessionId),
		["s1", "s2"],
	);
	assert.equal(sessions[0]?.injections.length, 2);
	assert.equal(entries[0]?.text, "steer one");
	assert.equal(entries[2]?.text, undefined);
	assert.equal(injectionUri("s1"), "codictator-steering:s1");
	const store = createSteeringDocStore();
	store.setSession("s1", "steer one\nsteer two");
	assert.equal(
		store.contentFor("codictator-steering:s1"),
		"steer one\nsteer two",
	);
	assert.equal(store.contentFor("codictator-steering:nope"), undefined);
	const provided: Array<string> = [];
	registerSteeringDoc(
		{
			registerContentProvider: (
				_scheme: string,
				provider: {
					provideTextDocumentContent(uri: string): string | undefined;
				},
			): void => {
				provided.push(
					provider.provideTextDocumentContent("codictator-steering:s1") ?? "",
				);
			},
		},
		store,
	);
	assert.deepEqual(provided, ["steer one\nsteer two"]);
});

test("[§4.20.2] budget shows a progress label or a human reason when unavailable", async () => {
	// SPEC §4.20.2 PR4: "62% · amber" when usage is known; otherwise the
	// harness or session reason in human words, never an estimate.
	const known = await currentBudget("/repo", () =>
		Promise.resolve({
			available: true,
			band: "amber",
			contextWindow: 1000,
			harness: "claude-code",
			usedTokens: 620,
		}),
	);
	assert.equal(known.percent, 62);
	assert.equal(budgetLabel(known), "62% · amber");
	const harnessless = await currentBudget("/repo", () =>
		Promise.resolve({
			available: false,
			harness: "Muse",
			reason: "harness-no-usage",
		}),
	);
	assert.equal(budgetLabel(harnessless), "Muse does not report token usage");
	const sessionless = await currentBudget("/repo", () =>
		Promise.resolve({ available: false, reason: "no-session" }),
	);
	assert.equal(budgetLabel(sessionless), "no agent session yet");
});

test("[§4.20.2] health rows carry state icons and repair actions", () => {
	// SPEC §4.20.2 PR4: each health row names its state icon and, where the
	// repair is human-only or engine-side, the command that runs it.
	const rows = healthRows({
		dependencies: "fresh",
		integrity: "unverified",
		ratchet: "no baseline history",
		remediation: "1 of 4 done",
	});
	const byLabel = new Map(rows.map((row) => [row.label, row]));
	assert.equal(byLabel.get("ratchet: no baseline history")?.icon, "$(warning)");
	assert.equal(
		byLabel.get("ratchet: no baseline history")?.action,
		"codictator.captureBaseline",
	);
	assert.equal(byLabel.get("dependencies: fresh")?.icon, "$(check)");
	assert.equal(
		byLabel.get("dependencies: fresh")?.action,
		"codictator.depsCheck",
	);
	assert.equal(byLabel.get("integrity: unverified")?.icon, "$(warning)");
	assert.equal(
		byLabel.get("remediation: 1 of 4 done")?.action,
		"codictator.remediateNext",
	);
});
