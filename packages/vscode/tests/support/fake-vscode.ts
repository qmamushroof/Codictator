// SPEC §4.20.1, §10.2: fake vscode API object for extension unit tests. It
// records every call so shape tests can assert what the extension did —
// which commands were registered, which terminals were pre-filled, which
// notifications were shown — without an extension host.
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

// SPEC §4.20.2: Problems-panel diagnostics the Violations view writes.
// Code is the rule id, message the remediation with an explain pointer.
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

// SPEC §4.20.2: the save seam for L2 on save plus the `events/appended`
// notification seam for the Timeline view. Tests drive both directly.
export interface FakeSaveEvent {
	readonly folderPath: string;
	readonly filePath: string;
}

export interface FakeEventEmitter<T> {
	readonly fired: ReadonlyArray<T>;
	event(listener: (data: T) => void): FakeDisposable;
	fire(data: T): void;
}

export function createFakeEventEmitter<T>(): FakeEventEmitter<T> {
	const fired: Array<T> = [];
	const listeners: Array<(data: T) => void> = [];
	return {
		fired,
		event(listener: (data: T) => void): FakeDisposable {
			listeners.push(listener);
			return createFakeDisposable(() => {
				const at = listeners.indexOf(listener);
				if (at >= 0) {
					listeners.splice(at, 1);
				}
			});
		},
		fire(data: T): void {
			fired.push(data);
			for (const listener of [...listeners]) {
				listener(data);
			}
		},
	};
}

export interface FakeVscode {
	folders: Array<string>;
	configPaths: Set<string>;
	enginePaths: Set<string>;
	extensionVersionValue: string;
	notificationChoice: string | undefined;
	readonly commands: Array<string>;
	readonly terminals: Array<FakeTerminal>;
	readonly notifications: Array<FakeNotification>;
	readonly executedShellCommands: Array<string>;
	readonly diagnosticCollections: ReadonlyMap<string, FakeDiagnosticCollection>;
	readonly treeProviders: ReadonlyMap<string, ReadonlyArray<unknown>>;
	addFolder(path: string, options: { config: boolean; engine: boolean }): void;
	registerCommand(commandId: string): void;
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
	registerTreeDataProvider(viewId: string, items: ReadonlyArray<unknown>): void;
}

export function createFakeVscode(): FakeVscode {
	const commands: Array<string> = [];
	const terminals: Array<FakeTerminal> = [];
	const notifications: Array<FakeNotification> = [];
	const executedShellCommands: Array<string> = [];
	const diagnosticCollections = new Map<string, FakeDiagnosticCollection>();
	const treeProviders = new Map<string, ReadonlyArray<unknown>>();
	const saveListeners: Array<(event: FakeSaveEvent) => void> = [];
	const appendedListeners: Array<(folderPath: string) => void> = [];
	const fake: FakeVscode = {
		folders: [],
		configPaths: new Set(),
		enginePaths: new Set(),
		extensionVersionValue: "0.0.0",
		notificationChoice: undefined,
		commands,
		terminals,
		notifications,
		executedShellCommands,
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
		registerCommand(commandId: string): void {
			commands.push(commandId);
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
				const at = saveListeners.indexOf(listener);
				if (at >= 0) {
					saveListeners.splice(at, 1);
				}
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
				const at = appendedListeners.indexOf(listener);
				if (at >= 0) {
					appendedListeners.splice(at, 1);
				}
			});
		},
		emitEventsAppended(folderPath: string): void {
			for (const listener of [...appendedListeners]) {
				listener(folderPath);
			}
		},
		registerTreeDataProvider(
			viewId: string,
			items: ReadonlyArray<unknown>,
		): void {
			treeProviders.set(viewId, [...items]);
		},
	};
	return fake;
}
