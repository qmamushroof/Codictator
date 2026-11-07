// SPEC §4.20.1 Engine: activation wiring for the extension entry. The
// spawn fan-out, request routing, Timeline source wiring and missing-engine
// notification live here; palette commands live in palette-command.ts and
// view population in view-population.ts, so the entry keeps its shape
// (extension id, palette runtime, re-exports) under its file limit.

import type { ExtensionApi, ExtensionHostFs } from "./host-adapter.ts";
import {
	buildExtensionApi,
	createFallbackApi,
	enginePathFor,
} from "./host-adapter.ts";
import {
	attachHandleRefresh,
	attachWorkspaceRefresh,
	startLivenessPing,
	wireTimelineSource,
} from "./live-refresh.ts";
import { registerPaletteCommands, runSetupCommand } from "./palette-command.ts";
import type { DelayFn, ReconnectHooks } from "./reconnect.ts";
import { restartFolder, shouldRestartOnLockChange } from "./reconnect.ts";
import {
	defaultSpawner,
	type EngineSpawner,
	reconnectHooks,
	type ServerHandle,
	type ServerSpawner,
	wireEngineRequests,
} from "./reconnect-hooks.ts";
import type { StdioEngineHandle } from "./stdio-client.ts";
import { spawnStdioEngine } from "./stdio-client.ts";
import type { MutableTreeDataProvider } from "./tree-provider.ts";
import { registerAllViews, setDisconnectedViews } from "./tree-provider.ts";
import { type UxChrome, wireUxPolish } from "./ux-chrome.ts";
import type { TreeViewHandle } from "./ux-host.ts";
import { populateViews } from "./view-population.ts";

// The spawn seam lives in reconnect-hooks.ts; the entry re-exports its
// types so existing importers keep working.
export type {
	EngineSpawner,
	ServerHandle,
	ServerSpawner,
} from "./reconnect-hooks.ts";

export function activateWithHost(
	host: unknown,
	fs?: ExtensionHostFs,
	spawnEngine?: EngineSpawner,
): Promise<void> {
	if (typeof host !== "object" || host === null) {
		return activateExtension(createFallbackApi(), spawnEngine);
	}
	return activateExtension(buildExtensionApi(host, fs), spawnEngine);
}

// SPEC §4.20.1 Module format: the CommonJS shim dynamic-imports the ESM main
// and passes it the vscode API object; main activates with that object.
// Activation starts one stdio engine per folder with a config through the
// spawn seam (default production), routes engine requests through the
// spawned handles, fans `events/appended` out to the Timeline source, and
// notifies for folders whose engine is missing instead of spawning them.
// SPEC §4.20.2: activation registers commands and live view providers
// first, spawns one stdio engine per folder, routes requests through the
// handles, populates the providers from the live engine, and refreshes
// them on engine events and saves. With no engine every view shows its
// offline item.
export async function activateExtension(
	api: ExtensionApi,
	spawnEngine: EngineSpawner = spawnStdioEngine,
	delay?: DelayFn,
): Promise<void> {
	api.registerCommand("codictator.setup", () => runSetupCommand(api));
	registerPaletteCommands(api);
	const views = new Map<string, TreeViewHandle>();
	const providers = registerAllViews(api, views);
	const handles = new Map<string, StdioEngineHandle>();
	const hooks = reconnectHooks(api, providers, handles, spawnEngine, delay);
	// SPEC §4.20.2 PR4: the UX polish wires here — status bar, UX and
	// violation commands, the steering document, the Timeline badge and
	// the block toast — so the shaping modules take effect on activation.
	const chrome = wireUxPolish(
		api,
		providers,
		views,
		() => [...handles.keys()].sort(),
		() => {
			for (const folderPath of [...handles.keys()].sort()) {
				restartFolder(hooks, folderPath);
			}
		},
	);
	await spawnHandles(api, hooks);
	const folders = [...handles.keys()].sort();
	if (folders.length === 0) {
		setDisconnectedViews(providers);
	} else {
		wireEngineRequests(handles);
		await populateViews(api, providers, folders);
	}
	await chrome.refresh();
	wireViewRefresh(api, providers, handles, spawnEngine, hooks, chrome);
	notifyFoldersMissingEngine(api);
}

// SPEC §4.20.1 Engine: spawn one stdio engine per folder that has both a
// config and an engine on disk. Adoption logs and skips a failed folder
// instead of aborting activation; client transport and handshake failures
// log through the injected log port.
async function spawnHandles(
	api: ExtensionApi,
	hooks: ReconnectHooks,
): Promise<void> {
	const spawner: ServerSpawner = (folderPath) => {
		hooks.readopt(folderPath, 0);
		return { folderPath };
	};
	// Folders with a config but no engine get the install notification, not
	// a server; serversForFolders only sees folders with an engine present.
	const withEngine: ExtensionApi = {
		...api,
		workspaceFolderPaths: () =>
			api
				.workspaceFolderPaths()
				.filter((folderPath) => api.engineExists(folderPath)),
	};
	await serversForFolders(withEngine, spawner);
}

// SPEC §4.20 EC-9: late-setup reconnect. A save re-checks existence per
// folder and spawns engines that appeared after activation (the human ran
// `setup`), so the views connect without a reload. New handles join the
// request router, the Timeline fan-out and the refresh subscriptions;
// a spawn throw logs and skips the folder instead of aborting.
export function connectMissing(
	api: ExtensionApi,
	providers: ReadonlyMap<string, MutableTreeDataProvider>,
	handles: Map<string, StdioEngineHandle>,
	spawnEngine: EngineSpawner,
	delay?: DelayFn,
): Array<string> {
	const hooks = reconnectHooks(api, providers, handles, spawnEngine, delay);
	for (const folderPath of api.workspaceFolderPaths()) {
		if (handles.has(folderPath)) {
			continue;
		}
		if (!api.configExists(folderPath) || !api.engineExists(folderPath)) {
			continue;
		}
		hooks.readopt(folderPath, 0);
	}
	return [...handles.keys()].sort();
}

// SPEC §4.20.1 Engine: fan `events/appended` out to the Timeline source
// and refresh the event views per changed folder. Saves re-query the
// engine the same way through the host save seam when the host provides
// one. The save listener registers unconditionally so a late `setup`
// (config or engine appearing after activation) reconnects on the next
// save; the Timeline and per-handle wiring needs a live engine, so it
// stays behind the size guard. The ping and the workspace watch run
// regardless, so liveness and config changes surface without a save.
function wireViewRefresh(
	api: ExtensionApi,
	providers: ReadonlyMap<string, MutableTreeDataProvider>,
	handles: Map<string, StdioEngineHandle>,
	spawnEngine: EngineSpawner,
	hooks: ReconnectHooks,
	chrome: UxChrome,
): void {
	if (handles.size > 0) {
		wireTimelineSource(handles);
		for (const handle of handles.values()) {
			attachHandleRefresh(api, providers, handles, handle);
			handle.onEventsAppended(() => {
				void chrome.refresh().catch(() => undefined);
			});
		}
	}
	startLivenessPing(handles);
	let watching = attachWorkspaceRefresh(api, providers, handles);
	api.onDidSave?.((event) => {
		void (async (): Promise<void> => {
			if (shouldRestartOnLockChange(event.filePath)) {
				restartFolder(hooks, event.folderPath);
			} else {
				connectMissing(api, providers, handles, spawnEngine, hooks.delay);
			}
			watching.dispose();
			watching = attachWorkspaceRefresh(api, providers, handles);
			await populateViews(api, providers, [...handles.keys()].sort());
			await chrome.refresh();
		})().catch(() => undefined);
	});
}

// SPEC §4.20.1 Engine: folders with a config but no engine get the install
// notification instead of a server.
function notifyFoldersMissingEngine(api: ExtensionApi): void {
	for (const folderPath of api.workspaceFolderPaths()) {
		if (api.configExists(folderPath) && !api.engineExists(folderPath)) {
			void notifyMissingEngine(api, folderPath);
		}
	}
}

// SPEC §4.20.1 Engine: one stdio server per folder that has a config.
export function serversForFolders(
	api: ExtensionApi,
	spawn: ServerSpawner = defaultSpawner,
): Promise<Array<ServerHandle>> {
	const servers: Array<ServerHandle> = [];
	for (const folderPath of api.workspaceFolderPaths()) {
		if (api.configExists(folderPath)) {
			servers.push(
				spawn(folderPath, [
					"node",
					enginePathFor(folderPath),
					"serve",
					"--stdio",
				]),
			);
		}
	}
	return Promise.resolve(servers);
}

// SPEC §4.20.1 Engine: no engine installed → a notification offering the
// install in a terminal.
export async function notifyMissingEngine(
	api: ExtensionApi,
	folderPath: string,
): Promise<string | undefined> {
	const installAction = "Install in a terminal";
	const chosen = await api.showWarningMessage(
		`Codictator engine not found for ${folderPath}. Run npm ci in a terminal to install it.`,
		[installAction, "Dismiss"],
	);
	if (chosen === installAction) {
		const terminal = api.createTerminal("Codictator Install");
		terminal.sendText("npm ci", true);
		terminal.show();
	}
	return chosen;
}
