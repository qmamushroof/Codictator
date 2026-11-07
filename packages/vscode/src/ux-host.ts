// SPEC §4.20.1 Module format + §4.20.2 PR4: the host seams behind the view
// surfaces — the status bar item and the tree views with badges. Both
// duck-type the host object (no vscode import keeps the source erasable,
// §11 S6) and degrade to undefined when the host lacks the surface, so
// unit tests and older hosts keep the provider-only path unbadged.
import { fieldOf, isRecord } from "./engine-client.ts";
import type { ExtensionApi } from "./host-adapter.ts";
import { showOf } from "./output-channel.ts";
import type { StatusBarItemHandle, StatusBarPorts } from "./status-bar.ts";
import type { SteeringDocProvider } from "./steering-doc.ts";
import { steeringDocPortsOf } from "./steering-doc.ts";
import type { MutableTreeDataProvider } from "./tree-provider.ts";
import { configReadOf, focusViewsOf } from "./ux-commands.ts";
import { openFileAtOf } from "./violation-actions.ts";

type HostFn = (...args: Array<unknown>) => unknown;

function isHostFn(value: unknown): value is HostFn {
	return typeof value === "function";
}

// SPEC §4.20.2 PR4: the tree view handle behind the Timeline badge. The
// badge carries the unseen block count; without a createTreeView surface
// the views register provider-only and stay unbadged.
export interface TreeViewHandle {
	dispose(): void;
	badge?: number | { value: number; tooltip: string } | undefined;
}

export type TreeViewFactory = (
	viewId: string,
	provider: MutableTreeDataProvider,
) => TreeViewHandle | undefined;

// SPEC §4.20.2 PR4: one view handle. createTreeView owns the badge; without
// it the provider-only surface registers instead.
export function trackViewHandle(
	api: ExtensionApi,
	views: Map<string, TreeViewHandle> | undefined,
	viewId: string,
	provider: MutableTreeDataProvider,
): void {
	const created = api.createTreeView?.(viewId, provider);
	if (created !== undefined) {
		views?.set(viewId, created);
		return;
	}
	api.registerTreeDataProvider?.(viewId, provider);
}

// SPEC §4.20.2 PR4: the UX polish surfaces. Each seam duck-types the host
// and spreads only when present, so a host without the surface omits the
// port instead of an explicit undefined, per exactOptionalPropertyTypes.

function hostWindow(host: unknown): Record<string, unknown> | undefined {
	const window = fieldOf(host, "window");
	return isRecord(window) ? window : undefined;
}

// SPEC §4.20.2 PR4: the status bar item behind registerStatusBar. Updates
// buffer locally and flush to the host item on show, which registerStatusBar
// calls after every update; a missing or read-only host surface no-ops.
export function statusBarPortsOf(host: unknown): StatusBarPorts | undefined {
	const create = fieldOf(hostWindow(host), "createStatusBarItem");
	if (!isHostFn(create)) {
		return undefined;
	}
	return {
		createItem: (): StatusBarItemHandle => bufferedStatusItem(create),
	};
}

// The host item narrowed to the status shape, or a no-op item when the
// host surface is not real. A narrowed item is returned directly, so
// updates apply to the host without a local buffer.
function bufferedStatusItem(create: HostFn): StatusBarItemHandle {
	let raw: unknown;
	try {
		raw = create();
	} catch {
		raw = undefined;
	}
	if (isStatusItem(raw)) {
		return raw;
	}
	return {
		dispose: (): void => undefined,
		show: (): void => undefined,
		text: "",
		tooltip: "",
	};
}

function isStatusItem(raw: unknown): raw is StatusBarItemHandle {
	if (!isRecord(raw)) {
		return false;
	}
	return (
		typeof fieldOf(raw, "text") === "string" &&
		typeof fieldOf(raw, "tooltip") === "string" &&
		typeof fieldOf(raw, "show") === "function" &&
		typeof fieldOf(raw, "dispose") === "function"
	);
}

// SPEC §4.20.2 PR4: the tree view behind the badge. createTreeView owns
// the badge; without it registration falls back to the provider-only
// surface and the badge stays unset.
export function createTreeViewOf(
	host: unknown,
):
	| ((
			viewId: string,
			provider: MutableTreeDataProvider,
	  ) => TreeViewHandle | undefined)
	| undefined {
	const create = fieldOf(hostWindow(host), "createTreeView");
	if (!isHostFn(create)) {
		return undefined;
	}
	return (
		viewId: string,
		provider: MutableTreeDataProvider,
	): TreeViewHandle | undefined => {
		let view: unknown;
		try {
			view = create(viewId, { treeDataProvider: provider });
		} catch {
			return undefined;
		}
		if (!isRecord(view)) {
			return undefined;
		}
		const dispose = fieldOf(view, "dispose");
		let badge: TreeViewHandle["badge"];
		return {
			get badge(): TreeViewHandle["badge"] {
				return badge;
			},
			set badge(next: TreeViewHandle["badge"]) {
				badge = next;
				try {
					if (next === undefined) {
						delete view["badge"];
					} else {
						view["badge"] = next;
					}
				} catch {
					// An unsettable badge leaves the views unbadged.
				}
			},
			dispose: (): void => {
				if (isHostFn(dispose)) {
					try {
						dispose();
					} catch {
						// Disposal never blocks deactivation.
					}
				}
			},
		};
	};
}

export function spreadUxHost(host: unknown): Partial<ExtensionApi> {
	const createTreeView = createTreeViewOf(host);
	const statusBar = statusBarPortsOf(host);
	const steeringDocs = steeringDocPortsOf(host);
	const openFileAt = openFileAtOf(host);
	const focusViews = focusViewsOf(host);
	const readConfig = configReadOf(host);
	const showLog = showOf(host);
	return {
		...(createTreeView === undefined ? {} : { createTreeView }),
		...(statusBar === undefined
			? {}
			: {
					createStatusBarItem: (): StatusBarItemHandle | undefined => {
						try {
							return statusBar.createItem();
						} catch {
							return undefined;
						}
					},
				}),
		...(steeringDocs === undefined
			? {}
			: {
					registerTextDocumentContentProvider: (
						scheme: string,
						provider: SteeringDocProvider,
					): void => {
						steeringDocs.registerContentProvider(scheme, provider);
					},
				}),
		...(openFileAt === undefined ? {} : { openFileAt }),
		...(focusViews === undefined ? {} : { focusViews }),
		...(readConfig === undefined ? {} : { readConfig }),
		...(showLog === undefined ? {} : { showLog }),
	};
}
