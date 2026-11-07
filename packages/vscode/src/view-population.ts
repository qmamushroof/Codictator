// SPEC §4.20.2: live view population. After the engine handshake succeeds,
// activation queries the engine (rules, findings, timeline, steering,
// budget, health) and fills every registered provider; one failing source
// disconnects only its own view. EC-1 groups rows by folder in multi-root
// workspaces; EC-10 shows the setup item on zero packs.

import { healthSummary } from "./health-views.ts";
import type { ExtensionApi } from "./host-adapter.ts";
import { detailOf } from "./output-channel.ts";
import { currentBudget, listSteeringEntries } from "./p1-views.ts";
import { listTimelineEvents } from "./timeline.ts";
import type { MutableTreeDataProvider } from "./tree-provider.ts";
import {
	errorItem,
	noPacksConfiguredItem,
	noSteeringEntriesItem,
	noTimelineEventsItem,
	noViolationsItem,
	setDisconnectedViews,
} from "./tree-provider.ts";
import {
	diagnosticsForFolder,
	listRuleGroups,
	refreshViolationDiagnostics,
} from "./views.ts";

function setViewItems(
	providers: ReadonlyMap<string, MutableTreeDataProvider>,
	viewId: string,
	items: ReadonlyArray<unknown>,
): void {
	providers.get(viewId)?.setItems(items);
}

function failView(
	api: ExtensionApi,
	providers: ReadonlyMap<string, MutableTreeDataProvider>,
	viewId: string,
	method: string,
	cause: unknown,
): void {
	const detail = detailOf(cause);
	api.log(`${method} refresh failed: ${detail}`);
	setViewItems(providers, viewId, [errorItem(method, codeOf(detail), detail)]);
}

// SPEC §4.20.2: the CDX code behind a method failure for the Explain
// action; a bare message carries no code to explain.
function codeOf(detail: string): string {
	return detail.match(/CDX-E\d+/)?.[0] ?? "engine error";
}

// SPEC §4.20.2: Active rules view data, one row per pack. EC-1 groups by
// folder in multi-root workspaces; EC-10 shows the setup item on zero
// packs instead of an empty view.
async function populateRuleView(
	api: ExtensionApi,
	providers: ReadonlyMap<string, MutableTreeDataProvider>,
	folders: ReadonlyArray<string>,
): Promise<void> {
	const viewId = "codictator-active-rules";
	let groups: Awaited<ReturnType<typeof listRuleGroups>>;
	try {
		groups = await listRuleGroups(folders);
	} catch (cause: unknown) {
		failView(api, providers, viewId, "rules/list", cause);
		return;
	}
	if (groups.length === 0) {
		setViewItems(providers, viewId, [noPacksConfiguredItem()]);
		return;
	}
	const multi = folders.length > 1;
	setViewItems(
		providers,
		viewId,
		groups.map((group) =>
			multi
				? `${group.folder} ${group.pack} (${group.rules.length})`
				: `${group.pack} (${group.rules.length})`,
		),
	);
}

// SPEC §4.20.2: Violations view data, one row per diagnostic flattened
// from the per-folder diagnostics map (EC-1).
async function populateViolationView(
	api: ExtensionApi,
	providers: ReadonlyMap<string, MutableTreeDataProvider>,
	folders: ReadonlyArray<string>,
): Promise<void> {
	const viewId = "codictator-violations";
	try {
		const items: Array<unknown> = [];
		for (const folder of folders) {
			await refreshViolationDiagnostics(folder);
			for (const uri of [...diagnosticsForFolder(folder).keys()].sort()) {
				for (const entry of diagnosticsForFolder(folder).get(uri) ?? []) {
					items.push(`${entry.code}: ${entry.message} (${uri})`);
				}
			}
		}
		setViewItems(
			providers,
			viewId,
			items.length === 0 ? [noViolationsItem()] : items,
		);
	} catch (cause: unknown) {
		failView(api, providers, viewId, "findings/list", cause);
	}
}

// SPEC §4.20.2: Timeline view data, newest first, across every folder.
async function populateTimelineView(
	api: ExtensionApi,
	providers: ReadonlyMap<string, MutableTreeDataProvider>,
	folders: ReadonlyArray<string>,
): Promise<void> {
	const viewId = "codictator-timeline";
	try {
		const items: Array<unknown> = [];
		for (const folder of folders) {
			const page = await listTimelineEvents(folder);
			for (const event of page.events) {
				items.push(
					event.message === undefined
						? `${event.kind}: ${event.id}`
						: `${event.kind}: ${event.message}`,
				);
			}
		}
		setViewItems(
			providers,
			viewId,
			items.length === 0 ? [noTimelineEventsItem()] : items,
		);
	} catch (cause: unknown) {
		failView(api, providers, viewId, "events/tail", cause);
	}
}

// SPEC §4.20.2: Steering view data — exactly what was injected, when,
// into which harness session.
async function populateSteeringView(
	api: ExtensionApi,
	providers: ReadonlyMap<string, MutableTreeDataProvider>,
	folders: ReadonlyArray<string>,
): Promise<void> {
	const viewId = "codictator-steering";
	try {
		const multi = folders.length > 1;
		const items: Array<unknown> = [];
		for (const folder of folders) {
			for (const entry of await listSteeringEntries(folder)) {
				items.push(
					multi
						? `${folder} ${entry.sessionId} (${entry.harness}) @ ${entry.injectedAt}`
						: `${entry.sessionId} (${entry.harness}) @ ${entry.injectedAt}`,
				);
			}
		}
		setViewItems(
			providers,
			viewId,
			items.length === 0 ? [noSteeringEntriesItem()] : items,
		);
	} catch (cause: unknown) {
		failView(api, providers, viewId, "steering/history", cause);
	}
}

// SPEC §4.20.2: Budget view data — the band and the usage per session, or
// "unavailable" when the engine has no usage to report.
async function populateBudgetView(
	api: ExtensionApi,
	providers: ReadonlyMap<string, MutableTreeDataProvider>,
	folders: ReadonlyArray<string>,
): Promise<void> {
	const viewId = "codictator-budget";
	try {
		const multi = folders.length > 1;
		const items: Array<unknown> = [];
		for (const folder of folders) {
			const state = await currentBudget(folder);
			items.push(
				multi
					? `${folder} ${state.band}: ${state.usage}`
					: `${state.band}: ${state.usage}`,
			);
		}
		setViewItems(providers, viewId, items);
	} catch (cause: unknown) {
		failView(api, providers, viewId, "budget/current", cause);
	}
}

// SPEC §4.20.2: Health view data — ratchet trend, dependency freshness,
// integrity and remediation progress in one row each.
async function populateHealthView(
	api: ExtensionApi,
	providers: ReadonlyMap<string, MutableTreeDataProvider>,
	folders: ReadonlyArray<string>,
): Promise<void> {
	const viewId = "codictator-health";
	try {
		const multi = folders.length > 1;
		const items: Array<unknown> = [];
		for (const folder of folders) {
			const state = await healthSummary(folder);
			const prefix = multi ? `${folder} ` : "";
			items.push(
				`${prefix}ratchet: ${state.ratchet}`,
				`${prefix}dependencies: ${state.dependencies}`,
				`${prefix}integrity: ${state.integrity}`,
				`${prefix}remediation: ${state.remediation}`,
			);
		}
		setViewItems(providers, viewId, items);
	} catch (cause: unknown) {
		failView(api, providers, viewId, "status", cause);
	}
}

// SPEC §4.20.2: query the engine (rules, findings, timeline, steering,
// budget, health) and fill every registered provider. One failing source
// fails only its own view with the method error item; with no folders
// every view disconnects.
export async function populateViews(
	api: ExtensionApi,
	providers: ReadonlyMap<string, MutableTreeDataProvider>,
	folders: ReadonlyArray<string>,
): Promise<void> {
	if (folders.length === 0) {
		setDisconnectedViews(providers);
		return;
	}
	await Promise.all([
		populateRuleView(api, providers, folders),
		populateViolationView(api, providers, folders),
		populateTimelineView(api, providers, folders),
		populateSteeringView(api, providers, folders),
		populateBudgetView(api, providers, folders),
		populateHealthView(api, providers, folders),
	]);
}
