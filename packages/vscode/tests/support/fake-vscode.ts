// SPEC §4.20.1, §10.2: fake vscode API object for extension unit tests. It
// records every call so shape tests can assert what the extension did —
// commands, terminals, notifications — without an extension host.
import type {
	ExtensionCommandHandler,
	ExtensionDisposable,
	MutableTreeDataProvider,
} from "../../src/tree-provider.ts";
import { isTreeDataProvider } from "../../src/tree-provider.ts";
export interface FakeSentText {
	readonly text: string;
	readonly execute: boolean;
}

export interface FakeTerminal {
	readonly name: string;
	readonly sentTexts: Array<FakeSentText>;
	shown: boolean;
	sendText(text: string, execute: boolean): void;
	show(): void;
}

export interface FakeNotification {
	readonly kind: "info" | "warning";
	readonly message: string;
	readonly actions: ReadonlyArray<string>;
}

// SPEC §4.20.2: Problems-panel diagnostics the Violations view writes —
// code is the rule id, message the remediation with an explain pointer.
export interface FakeDiagnostic {
	readonly uri: string;
	readonly code: string;
	readonly message: string;
	readonly line?: number;
}

// SPEC §4.20.2 EC-1: one collection per folder, mirroring vscode's
// DiagnosticCollection narrow port (set/delete per uri, clear per folder).
export interface FakeDiagnosticCollection {
	readonly name: string;
	readonly entries: ReadonlyMap<string, ReadonlyArray<FakeDiagnostic>>;
	set(uri: string, diagnostics: ReadonlyArray<FakeDiagnostic>): void;
	deleteFile(uri: string): void;
	clear(): void;
	dispose(): void;
}

export interface FakeDisposable {
	dispose(): void;
}

export function createFakeDisposable(onDispose?: () => void): FakeDisposable {
	let disposed = false;
	return {
		dispose(): void {
			if (!disposed) {
				disposed = true;
				onDispose?.();
			}
		},
	};
}

function removeListener<T>(listeners: Array<T>, listener: T): void {
	const at = listeners.indexOf(listener);
	if (at >= 0) {
		listeners.splice(at, 1);
	}
}

// SPEC §4.20.2: the save seam for L2 on save plus the `events/appended`
// notification seam for the Timeline view. Tests drive both directly.
export interface FakeSaveEvent {
	readonly folderPath: string;
	readonly filePath: string;
}

export interface FakeVscode {
	folders: Array<string>;
	configPaths: Set<string>;
	enginePaths: Set<string>;
	extensionVersionValue: string;
	notificationChoice: string | undefined;
	readonly commands: Array<string>;
	readonly commandHandlers: ReadonlyMap<string, ExtensionCommandHandler>;
	readonly terminals: Array<FakeTerminal>;
	readonly notifications: Array<FakeNotification>;
	readonly executedShellCommands: Array<string>;
	readonly logs: Array<string>;
	readonly diagnosticCollections: ReadonlyMap<string, FakeDiagnosticCollection>;
	readonly treeProviders: ReadonlyMap<string, MutableTreeDataProvider>;
	addFolder(path: string, options: { config: boolean; engine: boolean }): void;
	registerCommand(
		commandId: string,
		handler: ExtensionCommandHandler,
	): ExtensionDisposable | undefined;
	workspaceFolderPaths(): ReadonlyArray<string>;
	configExists(folderPath: string): boolean;
	engineExists(folderPath: string): boolean;
	createTerminal(name: string): FakeTerminal;
	showWarningMessage(
		message: string,
		actions: ReadonlyArray<string>,
	): Promise<string | undefined>;
	showInformationMessage(
		message: string,
		actions: ReadonlyArray<string>,
	): Promise<string | undefined>;
	supportedProtocolVersion(): string;
	serverProtocolVersion(_folderPath: string): string | undefined;
	extensionVersion(): string;
	// SPEC §4.20.2: the Codictator output channel recording plus the save
	// seam driving L2-on-save view refreshes.
	log(message: string): void;
	onDidSave(listener: (event: FakeSaveEvent) => void): FakeDisposable;
	// SPEC §4.20.2 views: diagnostics per folder (EC-1), the onDidSave seam
	// for L2 on save, the `events/appended` seam for Timeline, and the tree
	// providers behind the Active rules / Violations / Timeline views.
	createDiagnosticCollection(name: string): FakeDiagnosticCollection;
	onDidSaveTextDocument(
		listener: (event: FakeSaveEvent) => void,
	): FakeDisposable;
	saveDocument(folderPath: string, filePath: string): void;
	onEventsAppended(listener: (folderPath: string) => void): FakeDisposable;
	emitEventsAppended(folderPath: string): void;
	registerTreeDataProvider(
		viewId: string,
		provider: MutableTreeDataProvider,
	): ExtensionDisposable | undefined;
}

export function createFakeVscode(): FakeVscode {
	const commands: Array<string> = [];
	const terminals: Array<FakeTerminal> = [];
	const notifications: Array<FakeNotification> = [];
	const executedShellCommands: Array<string> = [];
	const diagnosticCollections = new Map<string, FakeDiagnosticCollection>();
	const commandHandlers = new Map<string, ExtensionCommandHandler>();
	const treeProviders = new Map<string, MutableTreeDataProvider>();
	const saveListeners: Array<(event: FakeSaveEvent) => void> = [];
	const appendedListeners: Array<(folderPath: string) => void> = [];
	const logs: Array<string> = [];
	const fake: FakeVscode = {
		folders: [],
		configPaths: new Set(),
		enginePaths: new Set(),
		extensionVersionValue: "0.0.0",
		notificationChoice: undefined,
		commands,
		commandHandlers,
		terminals,
		notifications,
		executedShellCommands,
		logs,
		diagnosticCollections,
		treeProviders,
		addFolder(
			path: string,
			options: { config: boolean; engine: boolean },
		): void {
			fake.folders.push(path);
			if (options.config) {
				fake.configPaths.add(path);
			}
			if (options.engine) {
				fake.enginePaths.add(path);
			}
		},
		registerCommand(
			commandId: string,
			handler: ExtensionCommandHandler,
		): ExtensionDisposable | undefined {
			// The real extHost throws without a function handler.
			if (typeof handler !== "function") {
				throw new TypeError(`command ${commandId} needs a function handler`);
			}
			commands.push(commandId);
			commandHandlers.set(commandId, handler);
			return createFakeDisposable(() => {
				commandHandlers.delete(commandId);
			});
		},
		workspaceFolderPaths(): ReadonlyArray<string> {
			return [...fake.folders];
		},
		configExists(folderPath: string): boolean {
			return fake.configPaths.has(folderPath);
		},
		engineExists(folderPath: string): boolean {
			return fake.enginePaths.has(folderPath);
		},
		createTerminal(name: string): FakeTerminal {
			const sentTexts: Array<FakeSentText> = [];
			const terminal: FakeTerminal = {
				name,
				sentTexts,
				shown: false,
				sendText(text: string, execute: boolean): void {
					sentTexts.push({ text, execute });
				},
				show(): void {
					terminal.shown = true;
				},
			};
			terminals.push(terminal);
			return terminal;
		},
		showWarningMessage(
			message: string,
			actions: ReadonlyArray<string>,
		): Promise<string | undefined> {
			notifications.push({ kind: "warning", message, actions });
			return Promise.resolve(fake.notificationChoice);
		},
		showInformationMessage(
			message: string,
			actions: ReadonlyArray<string>,
		): Promise<string | undefined> {
			notifications.push({ kind: "info", message, actions });
			return Promise.resolve(fake.notificationChoice);
		},
		supportedProtocolVersion(): string {
			return "1";
		},
		serverProtocolVersion(_folderPath: string): string | undefined {
			return undefined;
		},
		extensionVersion(): string {
			return fake.extensionVersionValue;
		},
		log(message: string): void {
			logs.push(message);
		},
		onDidSave(listener: (event: FakeSaveEvent) => void): FakeDisposable {
			return fake.onDidSaveTextDocument(listener);
		},
		createDiagnosticCollection(name: string): FakeDiagnosticCollection {
			const entries = new Map<string, ReadonlyArray<FakeDiagnostic>>();
			const collection: FakeDiagnosticCollection = {
				name,
				entries,
				set(uri: string, diagnostics: ReadonlyArray<FakeDiagnostic>): void {
					entries.set(uri, [...diagnostics]);
				},
				deleteFile(uri: string): void {
					entries.delete(uri);
				},
				clear(): void {
					entries.clear();
				},
				dispose(): void {
					entries.clear();
					diagnosticCollections.delete(name);
				},
			};
			diagnosticCollections.set(name, collection);
			return collection;
		},
		onDidSaveTextDocument(
			listener: (event: FakeSaveEvent) => void,
		): FakeDisposable {
			saveListeners.push(listener);
			return createFakeDisposable(() => {
				removeListener(saveListeners, listener);
			});
		},
		saveDocument(folderPath: string, filePath: string): void {
			const event: FakeSaveEvent = { folderPath, filePath };
			for (const listener of [...saveListeners]) {
				listener(event);
			}
		},
		onEventsAppended(listener: (folderPath: string) => void): FakeDisposable {
			appendedListeners.push(listener);
			return createFakeDisposable(() => {
				removeListener(appendedListeners, listener);
			});
		},
		emitEventsAppended(folderPath: string): void {
			for (const listener of [...appendedListeners]) {
				listener(folderPath);
			}
		},
		registerTreeDataProvider(
			viewId: string,
			provider: MutableTreeDataProvider,
		): ExtensionDisposable | undefined {
			// The real extHost renders by calling getChildren, so a provider without function-typed entries throws here instead of at render.
			if (!isTreeDataProvider(provider)) {
				throw new TypeError(`view ${viewId} needs a tree data provider`);
			}
			treeProviders.set(viewId, provider);
			return createFakeDisposable(() => {
				treeProviders.delete(viewId);
			});
		},
	};
	return fake;
}
