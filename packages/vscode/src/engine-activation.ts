// SPEC §4.20.1 Engine: activation wiring for the extension entry. The
// spawn fan-out, request routing, Timeline source wiring and missing-engine
// notification live here; palette commands live in palette-command.ts and
// view population in view-population.ts, so the entry keeps its shape
// (extension id, palette runtime, re-exports) under its file limit.
import { setEngineRequest } from "./engine-client.ts";
import type { ExtensionApi, ExtensionHostFs } from "./host-adapter.ts";
import {
	buildExtensionApi,
	createFallbackApi,
	enginePathFor,
} from "./host-adapter.ts";
import { detailOf } from "./output-channel.ts";
import { registerPaletteCommands, runSetupCommand } from "./palette-command.ts";
import type { StdioEngineHandle } from "./stdio-client.ts";
import { routeEngineRequests, spawnStdioEngine } from "./stdio-client.ts";
import { setTimelineSource } from "./timeline.ts";
import type { MutableTreeDataProvider } from "./tree-provider.ts";
import { registerAllViews, setDisconnectedViews } from "./tree-provider.ts";
import { populateViews } from "./view-population.ts";
import { refreshViolationDiagnostics } from "./views.ts";

export interface ServerHandle {
	readonly folderPath: string;
}

// SPEC §4.20.1 Engine: the single spawn seam (R10). ServerSpawner owns the
// argv rule (`node <root>/.codictator/bin/run.mjs serve --stdio` per folder
// with a config) via serversForFolders; EngineSpawner is its production
// specialization returning the full stdio handle. activateExtension adapts
// the engine spawner into the argv spawner and delegates to
// serversForFolders, so the argv rule lives in exactly one place.
export type ServerSpawner = (
	folderPath: string,
	args: ReadonlyArray<string>,
) => ServerHandle;

const defaultSpawner: ServerSpawner = (folderPath) => ({ folderPath });

// SPEC §4.20.1 Engine: the production spawner seam. Production passes
// spawnStdioEngine (one stdio child per folder); unit tests inject a fake
// so no real process starts under node:test. The log port carries client
// transport and handshake failures to the Codictator output channel.
export type EngineSpawner = (
	folderPath: string,
	log?: (message: string) => void,
) => StdioEngineHandle;

// SPEC §4.20.1 Module format: the production host entry. The CommonJS shim
// (src/extension.cts) dynamic-imports this module and passes the host vscode
// API object plus the node:fs exists port; a shapeless host still activates
// the narrow-port path used by unit tests, so views stay live instead of
// "no data provider". The fs port is optional so existing single-argument
// callers keep working.
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
): Promise<void> {
	api.registerCommand("codictator.setup", () => runSetupCommand(api));
	registerPaletteCommands(api);
	const providers = registerAllViews(api);
	const handles = await spawnHandles(api, spawnEngine);
	const folders = [...handles.keys()].sort();
	if (folders.length === 0) {
		setDisconnectedViews(providers);
	} else {
		wireEngineRequests(handles);
		await populateViews(api, providers, folders);
	}
	wireViewRefresh(api, providers, folders, handles);
	notifyFoldersMissingEngine(api);
}

// SPEC §4.20.1 Engine: spawn one stdio engine per folder that has both a
// config and an engine on disk. The engine filter narrows the api before
// delegating to serversForFolders, so the argv rule stays in one place. A
// spawn throw logs to the output channel and skips the folder instead of
// aborting activation; client transport and handshake failures log through
// the injected log port.
async function spawnHandles(
	api: ExtensionApi,
	spawnEngine: EngineSpawner,
): Promise<Map<string, StdioEngineHandle>> {
	const handles = new Map<string, StdioEngineHandle>();
	const spawner: ServerSpawner = (folderPath) => {
		try {
			const handle = spawnEngine(folderPath, (message: string): void => {
				api.log(message);
			});
			handles.set(folderPath, handle);
		} catch (cause: unknown) {
			api.log(`engine spawn failed for ${folderPath}: ${detailOf(cause)}`);
		}
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
	return handles;
}

// SPEC §4.20.1 Engine: route engine requests through the spawned handles
// instead of the canned defaults once at least one engine is up.
function wireEngineRequests(
	handles: ReadonlyMap<string, StdioEngineHandle>,
): void {
	if (handles.size === 0) {
		return;
	}
	setEngineRequest(routeEngineRequests(handles));
}

// SPEC §4.20.1 Engine: fan `events/appended` out to the Timeline source
// and refresh violation diagnostics plus every tree view per changed
// folder. Refreshes float, so a failing refresh never escapes as an
// unhandled rejection (fail closed). Saves re-query the engine the same
// way through the host save seam when the host provides one.
function wireViewRefresh(
	api: ExtensionApi,
	providers: ReadonlyMap<string, MutableTreeDataProvider>,
	folders: ReadonlyArray<string>,
	handles: ReadonlyMap<string, StdioEngineHandle>,
): void {
	if (handles.size === 0) {
		return;
	}
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
	for (const handle of handles.values()) {
		handle.onEventsAppended((changed) => {
			void refreshViolationDiagnostics(changed).catch(() => undefined);
			void populateViews(api, providers, folders).catch(() => undefined);
		});
	}
	api.onDidSave?.(() => {
		void populateViews(api, providers, folders).catch(() => undefined);
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
