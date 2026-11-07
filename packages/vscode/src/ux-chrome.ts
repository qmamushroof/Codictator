// SPEC §4.20.2 PR4: activation wiring for the UX polish. The shaping
// modules (status bar, UX commands, violation actions, steering document,
// badge and toast) stay pure; this module connects them to the extension
// host and the live engine at activation time, and refreshes the chrome
// (status item, Timeline badge, block toast, steering texts) alongside the
// views. Every host surface is optional, so the provider-only path keeps
// working where the host lacks it.
import type { ExtensionApi } from "./host-adapter.ts";
import { currentBudget } from "./p1-views.ts";
import { registerStatusBar, type StatusBarInput } from "./status-bar.ts";
import {
	createSteeringDocStore,
	fillSteeringDocs,
	registerSteeringDoc,
} from "./steering-doc.ts";
import { listTimelineEvents, type TimelineEventRow } from "./timeline.ts";
import { loadMorePage, newBlockIds, newBlockToast } from "./timeline-rows.ts";
import type { MutableTreeDataProvider } from "./tree-provider.ts";
import { notifyOnBlockOf, registerUxCommands } from "./ux-commands.ts";
import type { TreeViewHandle } from "./ux-host.ts";
import { listRuleGroups } from "./views.ts";
import { registerViolationActions } from "./violation-actions.ts";

export interface UxChrome {
	refresh(): Promise<void>;
	dispose(): void;
}

// SPEC §4.20.2 PR4: the chrome refresh reads rules, timeline, budget and
// steering for the connected folders, then updates the status item, the
// Timeline badge, the block toast and the steering texts. The first
// refresh seeds the seen set without toasting; later ones toast only new
// blocks. A refresh failure marks the engine error and logs, never
// throwing into the caller.
export function wireUxPolish(
	api: ExtensionApi,
	providers: ReadonlyMap<string, MutableTreeDataProvider>,
	views: ReadonlyMap<string, TreeViewHandle>,
	foldersOf: () => ReadonlyArray<string>,
	restartEngine: () => void,
): UxChrome {
	const createItem = api.createStatusBarItem;
	const item = createItem?.();
	const status =
		item === undefined || item === null
			? undefined
			: registerStatusBar({ createItem: () => item });
	status?.update({ blockCount: 0, connection: "connecting", ruleCount: 0 });

	const store = createSteeringDocStore();
	const registerDocs = api.registerTextDocumentContentProvider;
	if (registerDocs !== undefined) {
		registerSteeringDoc(
			{
				registerContentProvider: (scheme, provider): void => {
					registerDocs(scheme, provider);
				},
			},
			store,
		);
	}

	registerUxCommands({
		createTerminal: (name) => api.createTerminal(name),
		focusViews: (): void => {
			api.focusViews?.();
		},
		loadMore: (cursor: string): void => {
			void loadMorePage(
				(message) => api.log(message),
				providers,
				foldersOf(),
				cursor,
			).catch(() => undefined);
		},
		refreshViews: (): void => {
			void chrome.refresh().catch(() => undefined);
		},
		registerCommand: (commandId, handler): void => {
			api.registerCommand(commandId, handler);
		},
		restartEngine: (): void => {
			restartEngine();
		},
		showLog: (): void => {
			api.showLog?.();
		},
	});
	registerViolationActions({
		createTerminal: (name) => api.createTerminal(name),
		openFileAt: (uri, line): void => {
			api.openFileAt?.(uri, line);
		},
		registerCommand: (commandId, handler): void => {
			api.registerCommand(commandId, handler);
		},
	});

	const state: ChromeRefreshState = { seeded: false, seen: new Set<string>() };

	const chrome: UxChrome = {
		dispose: (): void => {
			status?.dispose();
		},
		refresh: async (): Promise<void> => {
			const folders = [...foldersOf()].sort();
			if (folders.length === 0) {
				status?.update({
					blockCount: 0,
					connection: "engine-missing",
					ruleCount: 0,
				});
				setTimelineBadge(views, undefined);
				return;
			}
			try {
				await refreshConnected(api, views, store, status, folders, state);
			} catch (cause: unknown) {
				const detail = cause instanceof Error ? cause.message : String(cause);
				api.log(`ux chrome refresh failed: ${detail}`);
				markEngineError(status, detail);
			}
		},
	};
	return chrome;
}

// The mutable chrome refresh state: the seen block ids and whether the
// first refresh already seeded them without toasting.
interface ChromeRefreshState {
	readonly seen: Set<string>;
	seeded: boolean;
}

// The collected chrome data behind one connected refresh.
interface ChromeData {
	readonly band: string;
	readonly blockCount: number;
	readonly events: ReadonlyArray<TimelineEventRow>;
	readonly ruleCount: number;
}

// SPEC §4.20.2 PR4: one connected refresh — query the engine, then update
// the status item, the Timeline badge, the block toast and the steering
// texts. Query and presentation split so neither half trips its limit.
async function refreshConnected(
	api: ExtensionApi,
	views: ReadonlyMap<string, TreeViewHandle>,
	store: { setSession(sessionId: string, text: string): void },
	status: { update(input: StatusBarInput): void } | undefined,
	folders: ReadonlyArray<string>,
	state: ChromeRefreshState,
): Promise<void> {
	const groups = await listRuleGroups(folders);
	const pages = await Promise.all(
		folders.map((folder) => listTimelineEvents(folder)),
	);
	const events = pages.flatMap((page) => page.events);
	const first = folders[0];
	if (first === undefined) {
		return;
	}
	const budget = await currentBudget(first);
	await presentChromeRefresh(api, views, store, status, folders, state, {
		band: budget.band,
		blockCount: events.filter((event) => event.verdict === "block").length,
		events,
		ruleCount: groups.reduce((total, group) => total + group.rules.length, 0),
	});
}

// The presentation half: badge, toast, status item and steering texts for
// already-queried chrome data. The first call seeds the seen set; later
// ones toast only new blocks.
async function presentChromeRefresh(
	api: ExtensionApi,
	views: ReadonlyMap<string, TreeViewHandle>,
	store: { setSession(sessionId: string, text: string): void },
	status: { update(input: StatusBarInput): void } | undefined,
	folders: ReadonlyArray<string>,
	state: ChromeRefreshState,
	data: ChromeData,
): Promise<void> {
	const unseen = newBlockIds(data.events, state.seen);
	if (!state.seeded) {
		for (const id of unseen) {
			state.seen.add(id);
		}
		state.seeded = true;
	} else {
		await toastNewBlocks(api, data.events, state.seen, unseen);
	}
	setTimelineBadge(views, unseen.length === 0 ? undefined : unseen.length);
	updateConnectedStatus(status, data, unseen.length);
	await fillSteeringDocs(store, folders);
}

// The non-modal block toast for ids unseen so far, gated by
// `codictator.notifyOnBlock`. Seen marks before the toast so a failing
// toast never re-fires for the same block.
async function toastNewBlocks(
	api: ExtensionApi,
	events: ReadonlyArray<TimelineEventRow>,
	seen: Set<string>,
	unseen: ReadonlyArray<string>,
): Promise<void> {
	const notifyOn =
		api.readConfig === undefined ? true : notifyOnBlockOf(api.readConfig);
	const toast = newBlockToast(events, seen, notifyOn);
	for (const id of unseen) {
		seen.add(id);
	}
	if (toast !== undefined) {
		await api.showInformationMessage(toast, []);
	}
}

// The connected status item, tinted by the known budget band.
function updateConnectedStatus(
	status: { update(input: StatusBarInput): void } | undefined,
	data: ChromeData,
	unseenBlocks: number,
): void {
	const input: StatusBarInput = {
		blockCount: data.blockCount,
		connection: "connected",
		ruleCount: data.ruleCount,
		unseenBlocks,
	};
	if (data.band !== "unavailable" && data.band !== "") {
		status?.update({ ...input, band: data.band });
	} else {
		status?.update(input);
	}
}

// The engine-error status item, naming the CDX code when the failure
// carries one.
function markEngineError(
	status: { update(input: StatusBarInput): void } | undefined,
	detail: string,
): void {
	const code = detail.match(/CDX-E\d+/)?.[0];
	if (code === undefined) {
		status?.update({
			blockCount: 0,
			connection: "engine-error",
			ruleCount: 0,
		});
	} else {
		status?.update({
			blockCount: 0,
			connection: "engine-error",
			errorCode: code,
			ruleCount: 0,
		});
	}
}

// SPEC §4.20.4 EC-5 PR4: the "load more" page. Older events append to the
// Timeline rows in the same plain shape the population uses.
// SPEC §4.20.2 PR4: the Timeline badge carries the unseen block count, or
// clears when there is nothing new.
function setTimelineBadge(
	views: ReadonlyMap<string, TreeViewHandle>,
	count: number | undefined,
): void {
	const timeline = views.get("codictator-timeline");
	if (timeline === undefined) {
		return;
	}
	try {
		timeline.badge =
			count === undefined
				? undefined
				: { tooltip: `Codictator: ${count} unseen blocks`, value: count };
	} catch {
		// An unsettable badge leaves the views unbadged.
	}
}
