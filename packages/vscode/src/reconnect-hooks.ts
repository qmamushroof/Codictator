// SPEC §4.20.1 Engine + §4.20.4 EC-2/EC-3: the spawn seam and the rescue
// ports. ServerSpawner owns the argv rule; EngineSpawner is its production
// specialization. reconnectHooks builds the adopt/forget/log/repopulate
// ports the rescue chains use: readopt stores, routes, subscribes and
// watches one fresh spawn, a spawn throw logs and skips the folder, and
// watching chains so a rescued handle is watched. Refresh here is the full
// repopulate; PR2 refines it to selective refresh.
import { setEngineRequest } from "./engine-client.ts";
import type { ExtensionApi } from "./host-adapter.ts";
import { detailOf } from "./output-channel.ts";
import type { DelayFn, ReconnectHooks } from "./reconnect.ts";
import { defaultDelay, watchHandle } from "./reconnect.ts";
import type { StdioEngineHandle } from "./stdio-client.ts";
import { routeEngineRequests } from "./stdio-client.ts";
import { setTimelineSource } from "./timeline.ts";
import type { MutableTreeDataProvider } from "./tree-provider.ts";
import { populateViews } from "./view-population.ts";
import { refreshViolationDiagnostics } from "./views.ts";

export interface ServerHandle {
	readonly folderPath: string;
}

// SPEC §4.20.1 Engine: the single spawn seam (R10). ServerSpawner owns the
// argv rule (`node <root>/.codictator/bin/run.mjs serve --stdio` per folder
// with a config) via serversForFolders; EngineSpawner is its production
// specialization returning the full stdio handle.
export type ServerSpawner = (
	folderPath: string,
	args: ReadonlyArray<string>,
) => ServerHandle;

export const defaultSpawner: ServerSpawner = (folderPath) => ({
	folderPath,
});

// SPEC §4.20.1 Engine: the production spawner seam. Production passes
// spawnStdioEngine (one stdio child per folder); unit tests inject a fake
// so no real process starts under node:test. The log port carries client
// transport and handshake failures to the Codictator output channel.
export type EngineSpawner = (
	folderPath: string,
	log?: (message: string) => void,
) => StdioEngineHandle;

// SPEC §4.20.1 Engine: route engine requests through the spawned handles
// instead of the canned defaults once at least one engine is up.
export function wireEngineRequests(
	handles: ReadonlyMap<string, StdioEngineHandle>,
): void {
	if (handles.size === 0) {
		return;
	}
	setEngineRequest(routeEngineRequests(handles));
}

// SPEC §4.20.1 Engine: one per-handle refresh subscription. Engine events
// refresh violation diagnostics plus every tree view for the currently
// connected folders; refreshes float, so a failing refresh never escapes
// as an unhandled rejection (fail closed).
export function attachHandleRefresh(
	api: ExtensionApi,
	providers: ReadonlyMap<string, MutableTreeDataProvider>,
	handles: ReadonlyMap<string, StdioEngineHandle>,
	handle: StdioEngineHandle,
): void {
	handle.onEventsAppended((changed) => {
		void refreshViolationDiagnostics(changed).catch(() => undefined);
		void populateViews(api, providers, [...handles.keys()].sort()).catch(
			() => undefined,
		);
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

// SPEC §4.20.4 EC-2/EC-3: the rescue and restart ports. Readopt stores,
// routes, subscribes and watches one fresh spawn; a spawn throw logs and
// skips the folder, and watching chains so a rescued handle is watched.
export function reconnectHooks(
	api: ExtensionApi,
	providers: ReadonlyMap<string, MutableTreeDataProvider>,
	handles: Map<string, StdioEngineHandle>,
	spawnEngine: EngineSpawner,
	delay?: DelayFn,
): ReconnectHooks {
	const hooks: ReconnectHooks = {
		delay: delay ?? defaultDelay,
		forget: (folderPath) => {
			handles.get(folderPath)?.dispose();
			handles.delete(folderPath);
		},
		log: (message) => {
			api.log(message);
		},
		readopt: (folderPath, attempt) => {
			try {
				const handle = spawnEngine(folderPath, (message: string): void => {
					api.log(message);
				});
				handles.set(folderPath, handle);
				attachHandleRefresh(api, providers, handles, handle);
				wireEngineRequests(handles);
				wireTimelineSource(handles);
				watchHandle(handle, hooks, attempt);
			} catch (cause: unknown) {
				api.log(`engine spawn failed for ${folderPath}: ${detailOf(cause)}`);
			}
		},
		repopulate: () => {
			void populateViews(api, providers, [...handles.keys()].sort()).catch(
				() => undefined,
			);
		},
	};
	return hooks;
}
