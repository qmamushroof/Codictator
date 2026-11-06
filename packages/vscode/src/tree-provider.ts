// SPEC §4.20.2: the vscode TreeDataProvider both view layers share. The
// extHost renders a view by calling getChildren then getTreeItem, so the
// adapter registers this provider object instead of a bare items array.
import { fieldOf, isRecord, stringFieldOf } from "./engine-client.ts";
import type { ExtensionApi } from "./host-adapter.ts";

export interface ExtensionDisposable {
	dispose(): void;
}

export interface ExtensionTreeItemCommand {
	readonly command: string;
	readonly title: string;
	readonly args?: ReadonlyArray<unknown>;
}

export interface ExtensionTreeItem {
	readonly label: string;
	readonly command?: ExtensionTreeItemCommand;
}

export type ExtensionTreeEvent = (
	listener: (value: unknown) => void,
) => ExtensionDisposable;

// SPEC §4.20.2: the provider behind every view. Activation keeps one per
// registered view and replaces its items after the engine handshake (and
// on every refresh); each replacement fires onDidChangeTreeData once so
// the host re-renders.
export interface MutableTreeDataProvider {
	getTreeItem(element: unknown): ExtensionTreeItem;
	getChildren(element?: unknown): Array<unknown>;
	onDidChangeTreeData: ExtensionTreeEvent;
	setItems(items: ReadonlyArray<unknown>): void;
}

export type ExtensionCommandHandler = (...args: Array<unknown>) => unknown;

// SPEC §4.20.2: every row renders its label; anything else reads as one
// generic row instead of breaking the render.
function labelOf(item: unknown): string {
	if (typeof item === "string") {
		return item === "" ? "(empty)" : item;
	}
	const label = stringFieldOf(item, "label");
	return label === undefined || label === "" ? "item" : label;
}

// SPEC §4.20.2 EC-10: a tree item narrows an optional command record, so
// the "No packs configured" row runs the setup command when clicked.
function commandOf(item: unknown): ExtensionTreeItemCommand | undefined {
	if (!isRecord(item)) {
		return undefined;
	}
	const command = fieldOf(item, "command");
	if (!isRecord(command)) {
		return undefined;
	}
	const id = stringFieldOf(command, "command");
	const title = stringFieldOf(command, "title");
	if (id === undefined || id === "" || title === undefined) {
		return undefined;
	}
	const args = fieldOf(command, "args");
	return Array.isArray(args)
		? { args: [...args], command: id, title }
		: { command: id, title };
}

function toTreeItem(element: unknown): ExtensionTreeItem {
	const command = commandOf(element);
	return command === undefined
		? { label: labelOf(element) }
		: { command, label: labelOf(element) };
}

// SPEC §4.20.2: one mutable provider per registered view. Activation keeps
// the provider and replaces its items after the engine handshake (and on
// every refresh); each replacement fires onDidChangeTreeData once.
export function createViewProvider(
	initial?: ReadonlyArray<unknown>,
): MutableTreeDataProvider {
	let items: Array<unknown> = [...(initial ?? [])];
	const listeners = new Set<(value: unknown) => void>();
	return {
		getChildren: (_element?: unknown): Array<unknown> => [...items],
		getTreeItem: (element: unknown): ExtensionTreeItem => toTreeItem(element),
		onDidChangeTreeData: (
			listener: (value: unknown) => void,
		): ExtensionDisposable => {
			listeners.add(listener);
			return {
				dispose: (): void => {
					listeners.delete(listener);
				},
			};
		},
		setItems: (next: ReadonlyArray<unknown>): void => {
			items = [...next];
			for (const listener of [...listeners]) {
				listener(undefined);
			}
		},
	};
}

// SPEC §4.20.2 EC-10: the Active rules empty-state item. Zero packs shows
// this one row; clicking it runs the setup command, which pre-fills the
// setup terminal and executes nothing.
export function noPacksConfiguredItem(): unknown {
	return {
		command: { command: "codictator.setup", title: "Set up Codictator" },
		label: "No packs configured",
	};
}

// SPEC §4.20 EC-2: the offline item. With no engine connected every view
// shows this row instead of an empty tree that reads as broken.
export function disconnectedItem(): unknown {
	return "Disconnected: engine not running";
}

// SPEC §4.20.2: healthy-empty rows. The engine is connected but has nothing
// to show, so each view keeps one plain row with no command instead of an
// empty tree that reads as broken.
export function noViolationsItem(): unknown {
	return "No violations";
}

// SPEC §4.20.2: healthy-empty Timeline row; connected with zero events.
export function noTimelineEventsItem(): unknown {
	return "No timeline events";
}

// SPEC §4.20.2: healthy-empty Steering row; connected with zero injections.
export function noSteeringEntriesItem(): unknown {
	return "No steering entries";
}

// SPEC §4.20.1: the host owns the registration lifetime; surfacing its
// disposable lets callers dispose exactly what the host registered.
export function toDisposable(value: unknown): ExtensionDisposable | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	const dispose = fieldOf(value, "dispose");
	if (typeof dispose !== "function") {
		return undefined;
	}
	return {
		dispose: (): void => {
			dispose();
		},
	};
}

// The narrow port the P1 views need to register their tree data providers.
export interface P1ViewsApi {
	registerTreeDataProvider(
		viewId: string,
		provider: MutableTreeDataProvider,
	): void;
}

// SPEC §4.20.2: the Codictator container gains the three P1 tree views
// beside the P0 ones; each registration pins its view id and the returned
// providers stay live for post-handshake population.
export function registerSteeringBudgetHealthViews(
	api: P1ViewsApi,
): Map<string, MutableTreeDataProvider> {
	const providers = new Map<string, MutableTreeDataProvider>();
	for (const viewId of [
		"codictator-budget",
		"codictator-health",
		"codictator-steering",
	]) {
		const provider = createViewProvider();
		providers.set(viewId, provider);
		api.registerTreeDataProvider(viewId, provider);
	}
	return providers;
}

// SPEC §4.20.2: all tree view ids the container owns; P0 first.
// F-04: P0 ids register directly while the P1 helper owns its three;
// every view registers exactly once.
const P0_VIEW_IDS: ReadonlyArray<string> = [
	"codictator-active-rules",
	"codictator-violations",
	"codictator-timeline",
];

export const ALL_VIEW_IDS: ReadonlyArray<string> = [
	...P0_VIEW_IDS,
	"codictator-steering",
	"codictator-budget",
	"codictator-health",
];

export function registerAllViews(
	api: ExtensionApi,
): Map<string, MutableTreeDataProvider> {
	const providers = new Map<string, MutableTreeDataProvider>();
	for (const viewId of P0_VIEW_IDS) {
		const provider = createViewProvider();
		providers.set(viewId, provider);
		api.registerTreeDataProvider?.(viewId, provider);
	}
	const p1 = registerSteeringBudgetHealthViews({
		registerTreeDataProvider: (
			viewId: string,
			provider: MutableTreeDataProvider,
		): void => {
			api.registerTreeDataProvider?.(viewId, provider);
		},
	});
	for (const [viewId, provider] of p1) {
		providers.set(viewId, provider);
	}
	return providers;
}

// SPEC §4.20 EC-2: every view shows this row while no engine is connected.
export function setDisconnectedViews(
	providers: ReadonlyMap<string, MutableTreeDataProvider>,
): void {
	for (const provider of providers.values()) {
		provider.setItems([disconnectedItem()]);
	}
}
// SPEC §4.20.2: the extHost shape guard. Registrations reuse it so a
// provider without function-typed getTreeItem/getChildren throws where
// the real host would refuse it.
export function isTreeDataProvider(
	value: unknown,
): value is MutableTreeDataProvider {
	if (!isRecord(value)) {
		return false;
	}
	return (
		typeof fieldOf(value, "getTreeItem") === "function" &&
		typeof fieldOf(value, "getChildren") === "function"
	);
}
