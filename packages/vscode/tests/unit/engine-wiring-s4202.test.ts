import { strict as assert } from "node:assert";

import test from "node:test";

import { activateExtension } from "../../src/engine-activation.ts";

import { resetEngineRequest, resetTimelineSource } from "../../src/main.ts";

import type { StdioEngineHandle } from "../../src/stdio-client.ts";

import { createFakeVscode } from "../support/fake-vscode.ts";

// SPEC §4.20.2: the live-view regression pin (BUG-0032). Activation used
// to register empty snapshot providers before spawning and never query
// the engine, so all six views stayed empty on live data.
function liveHandle(canned: (method: string) => unknown): {
	handle: StdioEngineHandle;
	emitAppended: (folderPath: string) => void;
} {
	const listeners = new Set<(folderPath: string) => void>();
	const handle: StdioEngineHandle = {
		dispose: (): void => undefined,
		folderPath: "/repo",
		onEventsAppended: (listener: (folderPath: string) => void) => {
			listeners.add(listener);
			return {
				dispose: (): void => {
					listeners.delete(listener);
				},
			};
		},
		ready: Promise.resolve("1"),
		request: (
			_folderPath: string,
			method: string,
			_params: unknown,
		): Promise<unknown> => Promise.resolve(canned(method)),
	};
	return {
		handle,
		emitAppended: (folderPath: string): void => {
			for (const listener of [...listeners]) {
				listener(folderPath);
			}
		},
	};
}

function liveCanned(method: string): unknown {
	switch (method) {
		case "rules/list": {
			return { rules: [{ id: "core/arch-module-mapped", pack: "core@1.0.0" }] };
		}
		case "findings/list": {
			return {
				findings: [
					{
						ruleId: "core/arch-module-mapped",
						remediation: "map the file",
						path: "src/a.ts",
						line: 1,
					},
				],
			};
		}
		case "events/tail": {
			return { events: [{ id: "e1", kind: "verdict", message: "allow" }] };
		}
		case "steering/history": {
			return {
				injections: [
					{ sessionId: "s1", ts: "2026-01-01T00:00:00Z", harness: "opencode" },
				],
			};
		}
		case "budget/current": {
			return { band: "soft", usedTokens: 10, contextWindow: 100 };
		}
		case "status": {
			return {
				ratchet: "improving",
				deps: "fresh",
				integrity: "verified",
				remediation: "none open",
			};
		}
		default: {
			return {};
		}
	}
}

function childLabels(
	api: {
		treeProviders: ReadonlyMap<
			string,
			{
				getChildren(e?: unknown): Array<unknown>;
				getTreeItem(e: unknown): { label: string };
			}
		>;
	},
	viewId: string,
): Array<string> {
	const provider = api.treeProviders.get(viewId);
	assert.ok(provider !== undefined, `view ${viewId} registered`);
	return provider
		.getChildren()
		.map((child) => provider.getTreeItem(child).label);
}

async function waitForRefresh(ready: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 200; attempt += 1) {
		if (ready()) {
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error("timed out waiting for the views to refresh");
}

test("[§4.20.2] activation populates tree views from the live engine", async () => {
	// SPEC §4.20.2: after the spawn handshake succeeds, activation queries
	// the engine (rules, findings, timeline, steering, budget, health) and
	// fills every registered provider instead of leaving them empty.
	const api = createFakeVscode();
	api.addFolder("/repo", { config: true, engine: true });
	const { handle } = liveHandle(liveCanned);
	try {
		await activateExtension(api, () => handle);
		assert.match(
			childLabels(api, "codictator-active-rules").join("\n"),
			/core@1\.0\.0/,
		);
		assert.match(
			childLabels(api, "codictator-violations").join("\n"),
			/core\/arch-module-mapped/,
		);
		assert.match(childLabels(api, "codictator-timeline").join("\n"), /verdict/);
		assert.match(childLabels(api, "codictator-steering").join("\n"), /s1/);
		assert.match(childLabels(api, "codictator-budget").join("\n"), /soft/);
		assert.equal(childLabels(api, "codictator-health").length, 4);
	} finally {
		resetEngineRequest();
		resetTimelineSource();
	}
});

test("[§4.20.2] views refresh on engine events and on save", async () => {
	// SPEC §4.20.2: an `events/appended` notification or a saved document
	// re-queries the engine and fires onDidChangeTreeData, so the views
	// follow live data instead of their activation snapshot.
	let extraRules: Array<unknown> = [];
	let extraInjections: Array<unknown> = [];
	const canned = (method: string): unknown => {
		if (method === "rules/list") {
			return {
				rules: [
					{ id: "core/arch-module-mapped", pack: "core@1.0.0" },
					...extraRules,
				],
			};
		}
		if (method === "steering/history") {
			return {
				injections: [
					{ sessionId: "s1", ts: "2026-01-01T00:00:00Z", harness: "opencode" },
					...extraInjections,
				],
			};
		}
		return liveCanned(method);
	};
	const api = createFakeVscode();
	api.addFolder("/repo", { config: true, engine: true });
	const { handle, emitAppended } = liveHandle(canned);
	try {
		await activateExtension(api, () => handle);
		const rules = api.treeProviders.get("codictator-active-rules");
		assert.ok(rules !== undefined);
		let fires = 0;
		const subscription = rules.onDidChangeTreeData?.(() => {
			fires += 1;
		});
		assert.ok(subscription !== undefined);
		const before = rules.getChildren().length;
		extraRules = [{ id: "core/no-secrets", pack: "extra@2.0.0" }];
		emitAppended("/repo");
		await waitForRefresh(() => rules.getChildren().length === before + 1);
		assert.ok(fires >= 1, "events/appended fires the change event");
		const steering = api.treeProviders.get("codictator-steering");
		assert.ok(steering !== undefined);
		const seen = steering.getChildren().length;
		extraInjections = [
			{ sessionId: "s2", ts: "2026-01-02T00:00:00Z", harness: "opencode" },
		];
		api.saveDocument("/repo", "src/a.ts");
		await waitForRefresh(() => steering.getChildren().length === seen + 1);
		subscription.dispose();
	} finally {
		resetEngineRequest();
		resetTimelineSource();
	}
});
