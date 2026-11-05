// SPEC §4.20.2: the vscode TreeDataProvider both view layers share. The
// extHost renders a view by calling getChildren then getTreeItem, so the
// adapter registers this provider object instead of a bare items array.
import { fieldOf, isRecord, stringFieldOf } from "./engine-client.ts";
import type { ExtensionApi } from "./host-adapter.ts";

export interface ExtensionDisposable {
	dispose(): void;
}

export interface ExtensionTreeItem {
	readonly label: string;
}

export type ExtensionTreeEvent = (
	listener: (value: unknown) => void,
) => ExtensionDisposable;

// SPEC §4.20.2: the narrow provider port. onDidChangeTreeData stays a
// no-op event while the views are snapshot lists from the engine.
export interface ExtensionTreeDataProvider {
	getTreeItem(element: unknown): ExtensionTreeItem;
	getChildren(element?: unknown): Array<unknown>;
	onDidChangeTreeData?: ExtensionTreeEvent;
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

function noEvents(_listener: (value: unknown) => void): ExtensionDisposable {
	return {
		dispose: (): void => undefined,
	};
}

// SPEC §4.20.2: one snapshot provider per registration; the copy keeps
// later caller mutations out of the render.
export function buildTreeProvider(
	items: ReadonlyArray<unknown>,
): ExtensionTreeDataProvider {
	const snapshot = [...items];
	return {
		getChildren: (_element?: unknown): Array<unknown> => [...snapshot],
		getTreeItem: (element: unknown): ExtensionTreeItem => ({
			label: labelOf(element),
		}),
		onDidChangeTreeData: noEvents,
	};
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
		provider: ExtensionTreeDataProvider,
	): void;
}

// SPEC §4.20.2: the Codictator container gains the three P1 tree views
// beside the P0 ones; each registration pins its view id.
export function registerSteeringBudgetHealthViews(api: P1ViewsApi): void {
	for (const viewId of [
		"codictator-budget",
		"codictator-health",
		"codictator-steering",
	]) {
		api.registerTreeDataProvider(viewId, buildTreeProvider([]));
	}
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

export function registerAllViews(api: ExtensionApi): void {
	for (const viewId of P0_VIEW_IDS) {
		api.registerTreeDataProvider?.(viewId, buildTreeProvider([]));
	}
	registerSteeringBudgetHealthViews({
		registerTreeDataProvider: (
			viewId: string,
			provider: ExtensionTreeDataProvider,
		): void => {
			api.registerTreeDataProvider?.(viewId, provider);
		},
	});
}
// SPEC §4.20.2: the extHost shape guard. Registrations reuse it so a
// provider without function-typed getTreeItem/getChildren throws where
// the real host would refuse it.
export function isTreeDataProvider(
	value: unknown,
): value is ExtensionTreeDataProvider {
	if (!isRecord(value)) {
		return false;
	}
	return (
		typeof fieldOf(value, "getTreeItem") === "function" &&
		typeof fieldOf(value, "getChildren") === "function"
	);
}
