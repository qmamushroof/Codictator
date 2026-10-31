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
}

export function createFakeVscode(): FakeVscode {
	const commands: Array<string> = [];
	const terminals: Array<FakeTerminal> = [];
	const notifications: Array<FakeNotification> = [];
	const executedShellCommands: Array<string> = [];
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
	};
	return fake;
}
