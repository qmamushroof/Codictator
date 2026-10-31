// SPEC §4.20.1: the extension entry (a dist/extension.cjs shim plus
// dist/main.js) lands with the extension phase; this stub exposes the package
// id meanwhile so the package has a compiled input.
export const extensionId: string = "codictator-vscode";

export type { EngineRequest } from "./engine-client.ts";
export {
	engineRequestFor,
	resetEngineRequest,
	setEngineRequest,
} from "./engine-client.ts";
export type {
	TimelineDisposable,
	TimelineEventRow,
	TimelineOptions,
	TimelinePage,
	TimelineSource,
} from "./timeline.ts";
export {
	listTimelineEvents,
	resetTimelineSource,
	setTimelineSource,
	subscribeTimeline,
} from "./timeline.ts";
export type {
	DiagnosticEntry,
	DiagnosticSink,
	RefreshPorts,
	RuleGroup,
	SaveApi,
	SaveEvent,
	VerifyPorts,
} from "./views.ts";
// SPEC §4.20.2: Active rules, Violations and Timeline views plus L2 on
// save live in views.ts (Timeline in timeline.ts); main keeps the
// extension shape (§4.20.1) and re-exports the view seam so existing
// imports keep working.
export {
	diagnosticsForFolder,
	listRuleGroups,
	refreshViolationDiagnostics,
	registerL2OnSave,
	resetSaveHistory,
	verifyFileOnSave,
} from "./views.ts";

// SPEC §4.20.3: a human-only command opens a terminal pre-filled with it.
export function runHumanOnlyCommand(_command: string): Promise<string> {
	throw new Error("not implemented: SPEC §4.20.3");
}

// SPEC §4.20.1: narrow ports the extension needs from the vscode API object.
// The dist shim passes the real object; unit tests pass the fake (§10.2).
export interface ExtensionTerminal {
	sendText(text: string, execute: boolean): void;
	show(): void;
}

export interface ExtensionApi {
	registerCommand(commandId: string): void;
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

export interface ServerHandle {
	readonly folderPath: string;
}

// SPEC §4.20.1 Engine: the spawn seam. Production passes a child-process
// spawn; unit tests pass a fake or rely on the default, which records
// nothing and spawns nothing, so no real process starts under node:test.
export type ServerSpawner = (
	folderPath: string,
	args: ReadonlyArray<string>,
) => ServerHandle;

const defaultSpawner: ServerSpawner = (folderPath) => ({ folderPath });

// SPEC §4.20.1 Protocol: the supported initialize.protocolVersion major.
const supportedProtocolMajor = 1;

export interface ProtocolHandshake {
	readonly inert: boolean;
	readonly direction: string;
}

export interface SetupWelcome {
	readonly terminalName: string;
	readonly prefilledCommand: string;
	readonly executed: boolean;
}

// SPEC §4.20.1 Module format: the CommonJS shim dynamic-imports the ESM main
// and passes it the vscode API object; main activates with that object.
export function activateExtension(api: ExtensionApi): Promise<void> {
	api.registerCommand("codictator.setup");
	return Promise.resolve();
}

// SPEC §4.20.1 Activation: workspaceContains config, or the Codictator view.
export function activationEvents(): ReadonlyArray<string> {
	return ["workspaceContains:.codictator/config.json", "onView:Codictator"];
}

// SPEC §4.20.1 Trust: the extension executes the repo engine, so untrusted
// workspaces stay unsupported.
export function untrustedWorkspaceSupport(): boolean {
	return false;
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
					`${folderPath}/.codictator/bin/run.mjs`,
					"serve",
					"--stdio",
				]),
			);
		}
	}
	return Promise.resolve(servers);
}

// SPEC §4.20.1 Protocol: an unsupported version stays inert and names which
// side to update.
export function checkProtocolVersion(actual: string): ProtocolHandshake {
	const first = actual.split(".")[0] ?? "";
	const major = first === "" ? Number.NaN : Number(first);
	if (Number.isNaN(major) || major < supportedProtocolMajor) {
		return {
			inert: true,
			direction: "update codictator to match the extension",
		};
	}
	if (major > supportedProtocolMajor) {
		return { inert: true, direction: "update the extension to match" };
	}
	return { inert: false, direction: "compatible" };
}

// SPEC §4.20.1 Onboarding + EC-9: trusted folder without a config; the setup
// action pre-fills the init terminal and runs nothing without the human.
export function runSetupWelcome(
	api: ExtensionApi,
	_folderPath: string,
): Promise<SetupWelcome> {
	const terminalName = "Codictator Setup";
	const prefilledCommand = `npx codictator@${api.extensionVersion()} init`;
	const terminal = api.createTerminal(terminalName);
	terminal.sendText(prefilledCommand, false);
	terminal.show();
	return Promise.resolve({
		terminalName,
		prefilledCommand,
		executed: false,
	});
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
