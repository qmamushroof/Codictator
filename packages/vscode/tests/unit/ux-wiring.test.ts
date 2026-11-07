// SPEC §4.20.2 PR4: activation wires the UX polish — status bar, UX and
// violation commands, the steering document, the Timeline badge and the
// block toast. Red-first: engine-activation never called the register*
// entry points, so the shaping modules stayed dead code.
import { strict as assert } from "node:assert";
import test from "node:test";
import { activateExtension } from "../../src/engine-activation.ts";
import type { ExtensionApi } from "../../src/host-adapter.ts";
import { resetEngineRequest, resetTimelineSource } from "../../src/main.ts";
import type { StatusBarItemHandle } from "../../src/status-bar.ts";
import type { StdioEngineHandle } from "../../src/stdio-client.ts";
import type { SteeringDocProvider } from "../../src/steering-doc.ts";
import type {
	ExtensionCommandHandler,
	MutableTreeDataProvider,
} from "../../src/tree-provider.ts";
import type { TreeViewHandle } from "../../src/ux-host.ts";

interface StubStatusItem extends StatusBarItemHandle {
	shown: boolean;
}

interface StubView extends TreeViewHandle {
	shown: boolean;
}

function stubApi(options: {
	folders?: Array<string>;
	config?: (key: string) => string | number | boolean | undefined;
}): {
	api: ExtensionApi;
	commands: Map<string, ExtensionCommandHandler>;
	items: Array<StubStatusItem>;
	views: Map<string, StubView>;
	schemes: Map<string, SteeringDocProvider>;
	messages: Array<string>;
	opened: Array<{ line?: number; uri: string }>;
	terminals: Array<{ name: string; texts: Array<string> }>;
} {
	const commands = new Map<string, ExtensionCommandHandler>();
	const items: Array<StubStatusItem> = [];
	const views = new Map<string, StubView>();
	const schemes = new Map<string, SteeringDocProvider>();
	const messages: Array<string> = [];
	const opened: Array<{ line?: number; uri: string }> = [];
	const terminals: Array<{ name: string; texts: Array<string> }> = [];
	const folders = options.folders ?? [];
	const readConfig = options.config ?? ((): undefined => undefined);
	const api: ExtensionApi = {
		configExists: () => true,
		createStatusBarItem: (): StubStatusItem => {
			const item: StubStatusItem = {
				dispose: (): void => undefined,
				show: (): void => {
					item.shown = true;
				},
				shown: false,
				text: "",
				tooltip: "",
			};
			items.push(item);
			return item;
		},
		createTerminal: (name: string) => {
			const texts: Array<string> = [];
			terminals.push({ name, texts });
			return {
				sendText: (text: string): void => {
					texts.push(text);
				},
				show: (): void => undefined,
			};
		},
		createTreeView: (viewId: string): StubView => {
			const view: StubView = {
				dispose: (): void => undefined,
				shown: false,
			};
			views.set(viewId, view);
			return view;
		},
		engineExists: () => true,
		extensionVersion: () => "0.2.7",
		focusViews: (): void => undefined,
		log: (): void => undefined,
		openFileAt: (uri: string, line?: number): void => {
			opened.push(line === undefined ? { uri } : { line, uri });
		},
		readConfig,
		registerCommand: (
			commandId: string,
			handler: ExtensionCommandHandler,
		): undefined => {
			commands.set(commandId, handler);
			return undefined;
		},
		registerTextDocumentContentProvider: (
			scheme: string,
			provider: SteeringDocProvider,
		): void => {
			schemes.set(scheme, provider);
		},
		registerTreeDataProvider: (
			viewId: string,
			provider: MutableTreeDataProvider,
		): undefined => {
			void viewId;
			void provider;
			return undefined;
		},
		serverProtocolVersion: () => undefined,
		showInformationMessage: (message: string): Promise<string | undefined> => {
			messages.push(message);
			return Promise.resolve(undefined);
		},
		showLog: (): void => undefined,
		showWarningMessage: (): Promise<string | undefined> =>
			Promise.resolve(undefined),
		supportedProtocolVersion: () => "1",
		workspaceFolderPaths: () => [...folders],
	};
	return { api, commands, items, messages, opened, schemes, terminals, views };
}

function stubHandle(tail: () => Array<unknown>): {
	emit: (folderPath: string) => void;
	handle: StdioEngineHandle;
} {
	const listeners = new Set<(folderPath: string) => void>();
	const canned = (method: string): unknown => {
		switch (method) {
			case "rules/list": {
				return { rules: [{ id: "core/a", pack: "core@1.0.0" }] };
			}
			case "findings/list": {
				return { findings: [] };
			}
			case "events/tail": {
				return { events: tail() };
			}
			case "steering/history": {
				return { injections: [] };
			}
			case "budget/current": {
				return { band: "green", contextWindow: 100, usedTokens: 10 };
			}
			default: {
				return {};
			}
		}
	};
	return {
		emit: (folderPath: string): void => {
			for (const listener of [...listeners]) {
				listener(folderPath);
			}
		},
		handle: {
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
			request: (_folderPath: string, method: string) =>
				Promise.resolve(canned(method)),
		},
	};
}

async function waitFor(ready: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 200; attempt += 1) {
		if (ready()) {
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error("timed out waiting for the chrome refresh");
}

test("[§4.20.2] activation registers the UX and violation commands", async () => {
	const stub = stubApi({});
	try {
		await activateExtension(stub.api, () => stubHandle(() => []).handle);
		for (const command of [
			"codictator.restartEngine",
			"codictator.showLog",
			"codictator.refresh",
			"codictator.focusViews",
			"codictator.timelineLoadMore",
			"codictator.installEngine",
			"codictator.captureBaseline",
			"codictator.depsCheck",
			"codictator.openFinding",
			"codictator.waiveFinding",
		]) {
			assert.ok(stub.commands.has(command), `registers ${command}`);
		}
		assert.ok(stub.items.length === 1, "creates one status bar item");
		assert.match(stub.items[0]?.text ?? "", /engine missing/);
		assert.ok(
			stub.schemes.has("codictator-steering"),
			"registers the steering document",
		);
	} finally {
		resetEngineRequest();
		resetTimelineSource();
	}
});

test("[§4.20.2] chrome refresh connects the status bar without toasting", async () => {
	let events: Array<unknown> = [
		{ id: "e1", kind: "verdict", message: "allow", verdict: "allow" },
	];
	const stub = stubApi({ folders: ["/repo"] });
	const { emit, handle } = stubHandle(() => events);
	try {
		await activateExtension(stub.api, () => handle);
		assert.match(stub.items[0]?.text ?? "", /1 rules/);
		assert.match(stub.items[0]?.text ?? "", /blocks/);
		assert.equal(stub.messages.length, 0, "seeding toasts nothing");
		events = [
			...events,
			{ id: "e2", kind: "verdict", message: "block", verdict: "block" },
		];
		emit("/repo");
		await waitFor(() => stub.messages.length === 1);
		assert.match(stub.messages[0] ?? "", /blocked 1 event/);
		assert.deepStrictEqual(stub.views.get("codictator-timeline")?.badge, {
			tooltip: "Codictator: 1 unseen blocks",
			value: 1,
		});
		emit("/repo");
		await new Promise((resolve) => setTimeout(resolve, 100));
		assert.equal(stub.messages.length, 1, "a repeat refresh re-toasts nothing");
	} finally {
		resetEngineRequest();
		resetTimelineSource();
	}
});

test("[§4.20.2] notifyOnBlock off silences the toast but keeps the badge", async () => {
	const events: Array<unknown> = [];
	const stub = stubApi({
		config: (key: string) =>
			key === "codictator.notifyOnBlock" ? false : undefined,
		folders: ["/repo"],
	});
	const { emit, handle } = stubHandle(() => events);
	try {
		await activateExtension(stub.api, () => handle);
		events.push({ id: "e9", kind: "verdict", verdict: "block" });
		emit("/repo");
		await waitFor(
			() => stub.views.get("codictator-timeline")?.badge !== undefined,
		);
		assert.deepStrictEqual(stub.views.get("codictator-timeline")?.badge, {
			tooltip: "Codictator: 1 unseen blocks",
			value: 1,
		});
		assert.equal(stub.messages.length, 0, "disabled setting toasts nothing");
	} finally {
		resetEngineRequest();
		resetTimelineSource();
	}
});

test("[§4.20.3] waive and open commands reach their ports", async () => {
	const stub = stubApi({ folders: ["/repo"] });
	const { handle } = stubHandle(() => []);
	try {
		await activateExtension(stub.api, () => handle);
		stub.commands.get("codictator.waiveFinding")?.("/u/a.ts", "core/a", 3);
		assert.ok(
			stub.terminals.some((terminal) =>
				terminal.texts.some((text) =>
					text.includes(
						"codictator waive --rule core/a --file /u/a.ts --line 3",
					),
				),
			),
			"waive pre-fills the terminal",
		);
		stub.commands.get("codictator.openFinding")?.("/u/a.ts", 3);
		assert.deepEqual(stub.opened, [{ line: 3, uri: "/u/a.ts" }]);
	} finally {
		resetEngineRequest();
		resetTimelineSource();
	}
});
