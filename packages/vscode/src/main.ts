// SPEC §4.20.1: the extension entry (a dist/extension.cjs shim plus
// dist/main.js) lands with the extension phase; this stub exposes the package
// id meanwhile so the package has a compiled input.

import { openPrefilledTerminal } from "./engine-activation.ts";
import type { ExtensionApi } from "./host-adapter.ts";
import { supportedProtocolMajor } from "./host-adapter.ts";

export const extensionId: string = "codictator-vscode";

// SPEC §4.20.1 Engine: activation wiring lives in engine-activation.ts; main
// re-exports the seam so existing imports keep working.
export type {
	EngineSpawner,
	ServerHandle,
	ServerSpawner,
} from "./engine-activation.ts";
export {
	activateExtension,
	activateWithHost,
	notifyMissingEngine,
	openPrefilledTerminal,
	registerPaletteCommands,
	runPaletteCommand,
	serversForFolders,
} from "./engine-activation.ts";
export type { EngineRequest } from "./engine-client.ts";
export {
	engineRequestFor,
	resetEngineRequest,
	setEngineRequest,
} from "./engine-client.ts";
export type {
	CommandRegistrar,
	ExtensionApi,
	ExtensionHostFs,
	ExtensionTerminal,
	ProviderRegistrar,
} from "./host-adapter.ts";
export {
	buildExtensionApi,
	configPathFor,
	enginePathFor,
} from "./host-adapter.ts";
export type {
	BudgetState,
	HealthState,
	SteeringEntry,
} from "./p1-views.ts";
export {
	currentBudget,
	healthSummary,
	listSteeringEntries,
} from "./p1-views.ts";
// SPEC §4.20.4: restart and reconnect behaviour plus the Cursor-compatible
// API floor live in reconnect.ts; main re-exports the seam.
export {
	apiFloorVersion,
	isActiveInUntrustedWorkspace,
	reconnectBackoffMs,
	shouldRestartOnLockChange,
} from "./reconnect.ts";
export type { StdioEngineHandle } from "./stdio-client.ts";
export {
	engineArgvFor,
	routeEngineRequests,
	spawnStdioEngine,
} from "./stdio-client.ts";
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
	ExtensionCommandHandler,
	ExtensionDisposable,
	ExtensionTreeDataProvider,
	ExtensionTreeEvent,
	ExtensionTreeItem,
	P1ViewsApi,
} from "./tree-provider.ts";
export {
	ALL_VIEW_IDS,
	buildTreeProvider,
	isTreeDataProvider,
	registerAllViews,
	registerSteeringBudgetHealthViews,
	toDisposable,
} from "./tree-provider.ts";
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
// The palette entry never runs the command itself, so returning the exact
// command line is the contract the terminal pre-fill asserts.
export function runHumanOnlyCommand(command: string): Promise<string> {
	return Promise.resolve(command);
}

// SPEC §4.20.3: the palette runtime (human-only gate plus engine `run`
// routing) lives with the activation wiring in engine-activation.ts; main
// keeps only the waive pre-fill on its local openPrefilledTerminal import.

// SPEC §4.20 EC-7: the waive action opens a terminal pre-filled with the
// exact `codictator waive …` command and runs nothing else.
export function runWaiveCommand(
	api: ExtensionApi,
	_findingId: string,
	argv: ReadonlyArray<string>,
): Promise<string> {
	const commandLine = `codictator ${argv.join(" ")}`;
	return Promise.resolve(
		openPrefilledTerminal(api, "Codictator Waive", commandLine),
	);
}

// SPEC §4.20.1 Activation: workspaceContains config, or opening any
// Codictator view. onView names real view ids (the container id never
// fires), so every entry can actually trigger.
export function activationEvents(): ReadonlyArray<string> {
	return [
		"workspaceContains:.codictator/config.json",
		"onView:codictator-active-rules",
		"onView:codictator-violations",
		"onView:codictator-timeline",
		"onView:codictator-steering",
		"onView:codictator-budget",
		"onView:codictator-health",
	];
}

// SPEC §4.20.1 Trust: the extension executes the repo engine, so untrusted
// workspaces stay unsupported.
export function untrustedWorkspaceSupport(): boolean {
	return false;
}

export interface ProtocolHandshake {
	readonly inert: boolean;
	readonly direction: string;
}

export interface SetupWelcome {
	readonly terminalName: string;
	readonly prefilledCommand: string;
	readonly executed: boolean;
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
