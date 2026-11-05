// SPEC §4.20.1 Module format: the host adapter. The production host entry
// (dist/extension.cjs shim → activateWithHost) duck-types the host vscode
// API object into the narrow ExtensionApi port; no vscode import keeps the
// source erasable (§11 S6). main.ts re-exports this seam so the entry keeps
// its shape (§4.20) and existing imports keep working.
import { fieldOf, isRecord } from "./engine-client.ts";
import type { ExtensionHostFs } from "./fs-ports.ts";
import { configPathFor, enginePathFor, existsFile } from "./fs-ports.ts";
import type {
	ExtensionCommandHandler,
	ExtensionDisposable,
	ExtensionTreeDataProvider,
} from "./tree-provider.ts";
import { isTreeDataProvider, toDisposable } from "./tree-provider.ts";

// SPEC §4.20.1 Engine: the fs port lives in fs-ports.ts; the seam is
// re-exported here so existing imports keep working.
export type { ExtensionHostFs } from "./fs-ports.ts";
export { configPathFor, enginePathFor, existsFile } from "./fs-ports.ts";

// SPEC §4.20.1: narrow ports the extension needs from the vscode API object.
// The dist shim passes the real object; unit tests pass the fake (§10.2).
export interface ExtensionTerminal {
	sendText(text: string, execute: boolean): void;
	show(): void;
}

export interface ExtensionApi {
	registerCommand: CommandRegistrar;
	registerTreeDataProvider?: ProviderRegistrar;
	workspaceFolderPaths(): ReadonlyArray<string>;
	configExists(folderPath: string): boolean;
	engineExists(folderPath: string): boolean;
	createTerminal(name: string): ExtensionTerminal;
	showWarningMessage(
		message: string,
		actions: ReadonlyArray<string>,
	): Promise<string | undefined>;
	showInformationMessage(
		message: string,
		actions: ReadonlyArray<string>,
	): Promise<string | undefined>;
	supportedProtocolVersion(): string;
	serverProtocolVersion(folderPath: string): string | undefined;
	extensionVersion(): string;
}

// SPEC §4.20.1 Protocol: the supported initialize.protocolVersion major,
// shared with checkProtocolVersion in main.ts.
export const supportedProtocolMajor = 1;

// F-05: the version the host adapter reports when the host exposes none. The
// source of truth is packages/vscode/package.json, but importing it would
// add a runtime JSON dependency to the erasable host adapter, so the
// fallback stays a literal pin.
const fallbackExtensionVersion = "0.0.0";

// Narrowing: the host object is unknown, so every field narrows through a
// check (CONVENTIONS.md, no `as` widening); one callable guard covers every
// host function slot.
type HostFn = (...args: Array<unknown>) => unknown;

function isHostFn(value: unknown): value is HostFn {
	return typeof value === "function";
}

function sectionOf(
	host: unknown,
	name: string,
): Record<string, unknown> | undefined {
	const section = fieldOf(host, name);
	return isRecord(section) ? section : undefined;
}

// SPEC §4.20.1: the registrar the host exposes once narrowed; the host
// return surfaces as a disposable when it carries one.
export type CommandRegistrar = (
	commandId: string,
	handler: ExtensionCommandHandler,
) => ExtensionDisposable | undefined;

export type ProviderRegistrar = (
	viewId: string,
	provider: ExtensionTreeDataProvider,
) => ExtensionDisposable | undefined;

// SPEC §4.20.3: palette entries reach the engine through a real handler;
// a non-function handler is a programmer error and throws like extHost.
function registerCommandOf(host: unknown): CommandRegistrar {
	const register = fieldOf(sectionOf(host, "commands"), "registerCommand");
	if (isHostFn(register)) {
		return (commandId: string, handler: ExtensionCommandHandler) => {
			if (typeof handler !== "function") {
				throw new TypeError(`command ${commandId} needs a function handler`);
			}
			return toDisposable(register(commandId, handler));
		};
	}
	return (): undefined => undefined;
}

// SPEC §4.20.2: the host receives a real provider, so the container
// renders instead of throwing `provider.getChildren is not a function`.
function registerTreeDataProviderOf(host: unknown): ProviderRegistrar {
	const register = fieldOf(
		sectionOf(host, "window"),
		"registerTreeDataProvider",
	);
	if (isHostFn(register)) {
		return (viewId: string, provider: ExtensionTreeDataProvider) => {
			if (!isTreeDataProvider(provider)) {
				throw new TypeError(`view ${viewId} needs a tree data provider`);
			}
			return toDisposable(register(viewId, provider));
		};
	}
	return (): undefined => undefined;
}

// SPEC §4.20.1 Module format: F-01 builds the narrow-port adapter from a
// duck-typed host shape so activateWithHost stays a thin entry. The fs port
// is optional so existing single-argument callers keep working; without it
// both exists checks stay false and no server spawns.
export function buildExtensionApi(
	host: unknown,
	fs?: ExtensionHostFs,
): ExtensionApi {
	const window = sectionOf(host, "window");
	const workspace = sectionOf(host, "workspace");
	return {
		registerCommand: registerCommandOf(host),
		registerTreeDataProvider: registerTreeDataProviderOf(host),
		workspaceFolderPaths: () => workspacePathsOf(workspace),
		configExists: (folderPath) => existsFile(fs, configPathFor(folderPath)),
		engineExists: (folderPath) => existsFile(fs, enginePathFor(folderPath)),
		createTerminal: (name) => terminalOf(window, name),
		showWarningMessage: (message, actions) =>
			messageOf(window, "showWarningMessage", message, actions),
		showInformationMessage: (message, actions) =>
			messageOf(window, "showInformationMessage", message, actions),
		supportedProtocolVersion: () => supportedProtocolMajor.toString(),
		serverProtocolVersion: () => undefined,
		extensionVersion: () => fallbackExtensionVersion,
	};
}

// F-03: resolves one workspace folder entry; the string case used to sit
// inside the object branch below, where it could never match.
function folderPathOf(folder: unknown): string | undefined {
	if (typeof folder === "string") {
		return folder;
	}
	if (!isRecord(folder)) {
		return undefined;
	}
	const uri = fieldOf(folder, "uri");
	if (!isRecord(uri)) {
		return undefined;
	}
	const fsPath = fieldOf(uri, "fsPath");
	return typeof fsPath === "string" ? fsPath : undefined;
}

function workspacePathsOf(workspace: unknown): Array<string> {
	if (!isRecord(workspace)) {
		return [];
	}
	const folders = fieldOf(workspace, "workspaceFolders");
	if (!Array.isArray(folders)) {
		return [];
	}
	const paths: Array<string> = [];
	for (const folder of folders) {
		const resolved = folderPathOf(folder);
		if (resolved !== undefined) {
			paths.push(resolved);
		}
	}
	return paths;
}

// F-02: wraps a host terminal once; undefined when the handle carries no
// object surface, so terminalOf stays a thin guard.
function wrapTerminal(terminal: unknown): ExtensionTerminal | undefined {
	if (!isRecord(terminal)) {
		return undefined;
	}
	const sendText = fieldOf(terminal, "sendText");
	const show = fieldOf(terminal, "show");
	return {
		sendText: (text: string, execute: boolean): void => {
			if (isHostFn(sendText)) {
				sendText(text, execute);
			}
		},
		show: (): void => {
			if (isHostFn(show)) {
				show();
			}
		},
	};
}

function terminalOf(hostWindow: unknown, name: string): ExtensionTerminal {
	const create = fieldOf(hostWindow, "createTerminal");
	if (isHostFn(create)) {
		try {
			const wrapped = wrapTerminal(create(name));
			if (wrapped !== undefined) {
				return wrapped;
			}
		} catch {
			// Fall through to the no-op terminal below.
		}
	}
	return {
		sendText: (_text: string, _execute: boolean): void => undefined,
		show: (): void => undefined,
	};
}

function messageOf(
	hostWindow: unknown,
	kind: "showWarningMessage" | "showInformationMessage",
	message: string,
	actions: ReadonlyArray<string>,
): Promise<string | undefined> {
	if (!isRecord(hostWindow)) {
		return Promise.resolve(undefined);
	}
	const show = hostWindow[kind];
	if (!isHostFn(show)) {
		return Promise.resolve(undefined);
	}
	let result: unknown;
	try {
		result = show.call(hostWindow, message, ...actions);
	} catch {
		return Promise.resolve(undefined);
	}
	return Promise.resolve(result).then((value): string | undefined =>
		typeof value === "string" ? value : undefined,
	);
}

export function createFallbackApi(): ExtensionApi {
	return {
		registerCommand: (
			_commandId: string,
			_handler: ExtensionCommandHandler,
		): undefined => undefined,
		registerTreeDataProvider: (
			_viewId: string,
			_provider: ExtensionTreeDataProvider,
		): undefined => undefined,
		workspaceFolderPaths: () => [],
		configExists: () => false,
		engineExists: () => false,
		createTerminal: () => ({
			sendText: (_text: string, _execute: boolean): void => undefined,
			show: (): void => undefined,
		}),
		showWarningMessage: () => Promise.resolve(undefined),
		showInformationMessage: () => Promise.resolve(undefined),
		supportedProtocolVersion: () => supportedProtocolMajor.toString(),
		serverProtocolVersion: () => undefined,
		extensionVersion: () => fallbackExtensionVersion,
	};
}
