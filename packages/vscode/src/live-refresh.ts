// SPEC §7.15 + §4.20.2: live refresh triggers. An events-log change owns
// the event views; a config, waivers, baseline or plan change owns the
// rules and health views. PR1 owns spawn and reconnect; this module only
// holds the watcher, the ping and the selective refresh.
import { watch } from "node:fs";
import type { ExtensionApi } from "./host-adapter.ts";
import type { StdioEngineHandle } from "./stdio-client.ts";
import { setTimelineSource } from "./timeline.ts";
import type { MutableTreeDataProvider } from "./tree-provider.ts";
import { populateViews } from "./view-population.ts";

export const EVENT_VIEW_IDS: ReadonlyArray<string> = [
	"codictator-timeline",
	"codictator-steering",
	"codictator-budget",
	"codictator-violations",
];

export const CONFIG_VIEW_IDS: ReadonlyArray<string> = [
	"codictator-active-rules",
	"codictator-health",
];

function isEventsLog(normalized: string): boolean {
	return (
		normalized === ".codictator/state/events.jsonl" ||
		normalized.endsWith("/.codictator/state/events.jsonl")
	);
}

const CONFIG_FILES = [
	".codictator/config.json",
	".codictator/waivers.json",
	".codictator/baseline.json",
];

const PLAN_DIR = ".codictator/plan";

function isConfigFile(normalized: string): boolean {
	if (
		CONFIG_FILES.some(
			(file) => normalized === file || normalized.endsWith(`/${file}`),
		)
	) {
		return true;
	}
	return (
		normalized === PLAN_DIR ||
		normalized.endsWith(`/${PLAN_DIR}`) ||
		normalized.includes(`/${PLAN_DIR}/`) ||
		normalized.startsWith(`${PLAN_DIR}/`)
	);
}

// The trigger map: a changed path names exactly the views it owns, so a
// belt-and-braces file watch never repopulates the world. Backslashes
// normalize first, so Windows watcher paths match (SPEC §4.20 EC-11).
export function viewsForChangedPath(filePath: string): ReadonlyArray<string> {
	const normalized = filePath.replace(/\\/g, "/");
	if (isEventsLog(normalized)) {
		return [...EVENT_VIEW_IDS];
	}
	if (isConfigFile(normalized)) {
		return [...CONFIG_VIEW_IDS];
	}
	return [];
}

// Selective populate: only the providers in viewIds re-query, so the rest
// keep their rows while the trigger's views go live.
export function refreshSelectedViews(
	api: ExtensionApi,
	providers: ReadonlyMap<string, MutableTreeDataProvider>,
	folders: ReadonlyArray<string>,
	viewIds: ReadonlyArray<string>,
): Promise<void> {
	if (folders.length === 0 || viewIds.length === 0) {
		return Promise.resolve();
	}
	const selected = new Map<string, MutableTreeDataProvider>();
	for (const viewId of viewIds) {
		const provider = providers.get(viewId);
		if (provider !== undefined) {
			selected.set(viewId, provider);
		}
	}
	return populateViews(api, selected, folders);
}

// SPEC §4.20.1 Engine: one per-handle refresh subscription. Engine events
// refresh the event views for the changed folder only; refreshes float, so
// a failing refresh never escapes as an unhandled rejection (fail closed).
export function attachHandleRefresh(
	api: ExtensionApi,
	providers: ReadonlyMap<string, MutableTreeDataProvider>,
	handles: ReadonlyMap<string, StdioEngineHandle>,
	handle: StdioEngineHandle,
): void {
	handle.onEventsAppended((changed) => {
		const folders = handles.has(changed)
			? [changed]
			: [...handles.keys()].sort();
		void refreshSelectedViews(api, providers, folders, [
			...EVENT_VIEW_IDS,
		]).catch(() => undefined);
	});
}

// SPEC §4.20.1 Engine: fan `events/appended` out to the Timeline source
// across every connected handle.
export function wireTimelineSource(
	handles: ReadonlyMap<string, StdioEngineHandle>,
): void {
	setTimelineSource({
		onEventsAppended: (listener: (folderPath: string) => void) => {
			const disposables = [...handles.values()].map((handle) =>
				handle.onEventsAppended(listener),
			);
			return {
				dispose: (): void => {
					for (const disposable of disposables) {
						disposable.dispose();
					}
				},
			};
		},
	});
}

export interface LiveRefreshHandle {
	dispose(): void;
}

const WORKSPACE_DEBOUNCE_MS = 300;

function watchRepoDir(
	dir: string,
	folderPath: string,
	note: (folderPath: string, changed: string) => void,
): (() => void) | undefined {
	let watcher: { close(): void } | undefined;
	try {
		const started = watch(dir, (_event, filename) => {
			if (typeof filename !== "string" || filename === "") {
				return;
			}
			note(folderPath, `${dir}/${filename}`);
		});
		started.on("error", () => undefined);
		// The watch never holds the loop on its own; the extension host
		// stays alive through its own lifetime, and unit tests exit.
		started.unref();
		watcher = started;
	} catch {
		return undefined;
	}
	return (): void => {
		watcher?.close();
	};
}

interface RefreshPending {
	readonly folders: Set<string>;
	readonly views: Set<string>;
}

// One debounced flush: refresh the union of pending folders and views,
// then clear the batch so the next burst starts fresh.
function flushPending(
	api: ExtensionApi,
	providers: ReadonlyMap<string, MutableTreeDataProvider>,
	handles: ReadonlyMap<string, StdioEngineHandle>,
	pending: RefreshPending,
): void {
	const folders = [...handles.keys()]
		.filter((folder) => pending.folders.has(folder))
		.sort();
	const views = [...pending.views];
	pending.folders.clear();
	pending.views.clear();
	if (folders.length === 0 || views.length === 0) {
		return;
	}
	void refreshSelectedViews(api, providers, folders, views).catch(
		() => undefined,
	);
}

function noteChange(
	handles: ReadonlyMap<string, StdioEngineHandle>,
	pending: RefreshPending,
	rearm: () => void,
	folderPath: string,
	changed: string,
): void {
	if (!handles.has(folderPath)) {
		return;
	}
	const views = viewsForChangedPath(changed);
	if (views.length === 0) {
		return;
	}
	pending.folders.add(folderPath);
	for (const view of views) {
		pending.views.add(view);
	}
	rearm();
}

// Belt-and-braces file watch beside the server push: `.codictator`,
// `.codictator/state` and `.codictator/plan` per folder, debounced so a
// save burst refreshes once. A missing dir watches nothing instead of
// failing; the server push still covers it.
export function attachWorkspaceRefresh(
	api: ExtensionApi,
	providers: ReadonlyMap<string, MutableTreeDataProvider>,
	handles: ReadonlyMap<string, StdioEngineHandle>,
): LiveRefreshHandle {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const pending: RefreshPending = {
		folders: new Set<string>(),
		views: new Set<string>(),
	};
	const closers: Array<() => void> = [];
	const arm = (): void => {
		if (timer !== undefined) {
			clearTimeout(timer);
		}
		timer = setTimeout(() => {
			timer = undefined;
			flushPending(api, providers, handles, pending);
		}, WORKSPACE_DEBOUNCE_MS);
		// The debounce never holds the loop on its own; a live host or a
		// running test keeps it alive until it fires.
		timer.unref();
	};
	const note = (folderPath: string, changed: string): void => {
		noteChange(handles, pending, arm, folderPath, changed);
	};
	for (const folderPath of handles.keys()) {
		for (const sub of ["", "/state", "/plan"]) {
			const closer = watchRepoDir(
				`${folderPath}/.codictator${sub}`,
				folderPath,
				note,
			);
			if (closer !== undefined) {
				closers.push(closer);
			}
		}
	}
	return {
		dispose: (): void => {
			if (timer !== undefined) {
				clearTimeout(timer);
				timer = undefined;
			}
			pending.folders.clear();
			pending.views.clear();
			for (const closer of closers) {
				closer();
			}
		},
	};
}

// SPEC §7.15: the liveness ping. One `ping` per handle every 30 s keeps a
// dead child visible between pushes; a failure stays silent here and the
// next tick retries, while reconnect (PR1) owns the recovery.
export const LIVENESS_PING_MS = 30000;

export function startLivenessPing(
	handles: ReadonlyMap<string, StdioEngineHandle>,
	intervalMs: number = LIVENESS_PING_MS,
): LiveRefreshHandle {
	const timer = setInterval(() => {
		for (const handle of handles.values()) {
			void handle.request(handle.folderPath, "ping", {}).catch(() => undefined);
		}
	}, intervalMs);
	// The ping never holds the loop on its own; the extension host stays
	// alive through its own lifetime, and unit tests exit between ticks.
	timer.unref();
	return {
		dispose: (): void => {
			clearInterval(timer);
		},
	};
}
