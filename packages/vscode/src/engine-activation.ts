// SPEC §4.20.1 Engine: activation wiring for the extension entry. The
// palette registration, host entry, engine spawn fan-out, request routing,
// Timeline source wiring and missing-engine notification live here so the
// entry (main.ts) keeps its shape (extension id, palette runtime,
// re-exports) under its file limit.
import {
	type EngineRequest,
	engineRequestFor,
	setEngineRequest,
	stringFieldOf,
} from "./engine-client.ts";
import type { ExtensionApi, ExtensionHostFs } from "./host-adapter.ts";
import {
	buildExtensionApi,
	createFallbackApi,
	enginePathFor,
} from "./host-adapter.ts";
import type { StdioEngineHandle } from "./stdio-client.ts";
import { routeEngineRequests, spawnStdioEngine } from "./stdio-client.ts";
import { setTimelineSource } from "./timeline.ts";
import { registerAllViews } from "./tree-provider.ts";
import { refreshViolationDiagnostics } from "./views.ts";

// SPEC §4.20.3: palette command ids map one-to-one to CLI commands; each
// entry runs its argv through the engine `run` method (§7.15). Keys stay
// sorted so registration order is deterministic without a sort call.
const paletteCommandArgv: Readonly<Record<string, ReadonlyArray<string>>> = {
	"codictator.explain": ["explain"],
	"codictator.regen": ["regen"],
	"codictator.remediateNext": ["remediate", "next"],
	"codictator.status": ["status"],
	"codictator.taskShow": ["task", "show"],
	"codictator.verify": ["verify"],
	"codictator.waive": ["waive"],
};

// SPEC §4.20.3: palette commands map one-to-one to CLI commands; each entry
// runs its argv through the engine `run` method via a real handler.
export function registerPaletteCommands(api: ExtensionApi): void {
	for (const [commandId, argv] of Object.entries(paletteCommandArgv)) {
		api.registerCommand(commandId, () =>
			runPaletteCommand(api, commandId, argv),
		);
	}
}

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
// so no real process starts under node:test.
export type EngineSpawner = (folderPath: string) => StdioEngineHandle;

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
export async function activateExtension(
	api: ExtensionApi,
	spawnEngine: EngineSpawner = spawnStdioEngine,
): Promise<void> {
	api.registerCommand("codictator.setup", () =>
		runPaletteCommand(api, "codictator.setup", ["setup"]),
	);
	registerPaletteCommands(api);
	registerAllViews(api);
	const handles = await spawnHandles(api, spawnEngine);
	wireEngineRequests(handles);
	wireTimelineFanout(handles);
	notifyFoldersMissingEngine(api);
}

// SPEC §4.20.1 Engine: spawn one stdio engine per folder that has both a
// config and an engine on disk. The engine filter narrows the api before
// delegating to serversForFolders, so the argv rule stays in one place.
async function spawnHandles(
	api: ExtensionApi,
	spawnEngine: EngineSpawner,
): Promise<Map<string, StdioEngineHandle>> {
	const handles = new Map<string, StdioEngineHandle>();
	const spawner: ServerSpawner = (folderPath) => {
		const handle = spawnEngine(folderPath);
		handles.set(folderPath, handle);
		return handle;
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

// SPEC §4.20.1 Engine: fan `events/appended` out to the Timeline source and
// refresh violation diagnostics per changed folder. The refresh floats, so
// it carries a catch: a failing refresh never escapes as an unhandled
// rejection (fail closed).
function wireTimelineFanout(
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
		});
	}
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

// SPEC §4.19.2: human-only roots refuse agent execution with CDX-E107.
function isHumanOnlyArgv(argv: ReadonlyArray<string>): boolean {
	const [head, sub] = argv;
	return (
		head === "waive" ||
		head === "init" ||
		head === "setup" ||
		head === "uninstall" ||
		(head === "task" && sub === "ack") ||
		(head === "pack" && sub === "accept") ||
		(head === "baseline" && sub === "capture")
	);
}

// SPEC §4.20.3: the CDX-E107 answer opens an integrated terminal pre-filled
// with the exact command; the human runs it, so the UI is never a bypass.
// Fire-and-forget like the setup welcome: pre-fill with execute:false.
export function openPrefilledTerminal(
	api: ExtensionApi,
	name: string,
	commandLine: string,
): string {
	const terminal = api.createTerminal(name);
	terminal.sendText(commandLine, false);
	terminal.show();
	return commandLine;
}

// SPEC §4.20.3: a palette command runs its CLI argv through the engine `run`
// method; a human-only answer (CDX-E107) opens a pre-filled terminal.
export function runPaletteCommand(
	api: ExtensionApi,
	_commandId: string,
	argv: ReadonlyArray<string>,
	request?: EngineRequest,
): Promise<string> {
	const commandLine = `codictator ${argv.join(" ")}`;
	if (isHumanOnlyArgv(argv)) {
		return Promise.resolve(
			openPrefilledTerminal(api, "Codictator", commandLine),
		);
	}
	return runThroughEngine(api, argv, commandLine, request);
}

// SPEC §4.20.3: the palette entry forwards its CLI argv to `run` and
// surfaces the CLI result; without an engine it echoes the command line.
async function runThroughEngine(
	api: ExtensionApi,
	argv: ReadonlyArray<string>,
	commandLine: string,
	request?: EngineRequest,
): Promise<string> {
	const folder = api.workspaceFolderPaths()[0];
	if (folder === undefined) {
		return commandLine;
	}
	let answer: unknown;
	try {
		answer = await engineRequestFor(request)(folder, "run", {
			argv: [...argv],
		});
	} catch (cause: unknown) {
		const message = cause instanceof Error ? cause.message : "";
		if (/CDX-E107|human-only/.test(message)) {
			return openPrefilledTerminal(api, "Codictator", commandLine);
		}
		return commandLine;
	}
	const stdout = stringFieldOf(answer, "stdout");
	return stdout === undefined || stdout === "" ? commandLine : stdout;
}
