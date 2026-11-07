// SPEC §4.20.2 + §4.20.3 PR4: the UX commands — Restart Engine, Show Log
// and Refresh plus the install, baseline, deps-check, open-finding, load
// more and focus commands behind the header, title and tree actions. The
// view-title refresh button and the settings live in package.json; this
// module owns the handlers and the header context values.
export interface UxTerminal {
	sendText(text: string, execute: boolean): void;
	show(): void;
}

export interface UxCommandPorts {
	registerCommand(
		commandId: string,
		handler: (...args: Array<unknown>) => unknown,
	): void;
	createTerminal(name: string): UxTerminal;
	showLog(): void;
	restartEngine(): void;
	refreshViews(): void;
	loadMore(cursor: string): void;
	focusViews(): void;
}

// SPEC §4.20.2 PR4: the header welcome states key off one context map, so
// setup, missing engine and method error never show together.
export interface UxContextInput {
	readonly setupNeeded: boolean;
	readonly engineMissing: boolean;
	readonly methodError?: string;
}

// SPEC §4.20.2 PR4: the context values for the viewsWelcome when-clauses.
export function uxContextValues(
	input: UxContextInput,
): Record<string, boolean | string> {
	const values: Record<string, boolean | string> = {
		"codictator.engineMissing": input.engineMissing,
		"codictator.methodError": input.methodError !== undefined,
		"codictator.setupNeeded": input.setupNeeded,
	};
	if (input.methodError !== undefined) {
		values["codictator.methodErrorCode"] = input.methodError;
	}
	return values;
}

// SPEC §4.20.2 PR4: `codictator.notifyOnBlock` — the block toast default.
// Absent or non-boolean reads on, so a fresh install toasts.
export function notifyOnBlockOf(
	read: (key: string) => string | number | boolean | undefined,
): boolean {
	const raw = read("codictator.notifyOnBlock");
	return typeof raw === "boolean" ? raw : true;
}

// SPEC §4.20.2 PR4: `codictator.timeline.pageSize` — the Timeline page,
// clamped to the EC-5 1..500 window with a 100 default.
export function timelinePageSizeOf(
	read: (key: string) => string | number | boolean | undefined,
): number {
	const raw = read("codictator.timeline.pageSize");
	if (typeof raw !== "number" || Number.isNaN(raw)) {
		return 100;
	}
	return Math.min(Math.max(Math.floor(raw), 1), 500);
}

// SPEC §4.20.2 PR4: the header welcome rows. One row per welcome state —
// connecting, missing engine, method error with its log, and the explain
// action — so every view spins or offers a repair instead of reading as
// broken. The shapes match tree-provider rows; the commands register in
// registerUxCommands.
export function connectingItem(): unknown {
	return "$(sync~spin) Connecting to engine…";
}

// SPEC §4.20.2 PR4: the engine-missing row. Clicking runs the install
// command, which pre-fills `npm ci` in a terminal for the human.
export function engineMissingItem(): unknown {
	return {
		command: { command: "codictator.installEngine", title: "Install engine" },
		label: "Engine missing — install it",
	};
}

// SPEC §4.20.2 PR4: the method-error rows. One surfaces the CDX code with
// the log behind it; the other explains the code.
export function methodErrorItem(code: string): unknown {
	return {
		command: { command: "codictator.showLog", title: "Show engine log" },
		label: `Engine error ${code}`,
	};
}

export function explainErrorItem(code: string): unknown {
	return {
		command: {
			args: [code],
			command: "codictator.explain",
			title: "Explain engine error",
		},
		label: `Explain ${code}`,
	};
}

// SPEC §4.20.2 + §4.20.3 PR4: register every UX command. Human-only repairs
// (install, baseline capture) pre-fill a terminal and execute nothing; the
// restart, log and refresh handlers route to their injected ports, which
// the activation wiring provides.
export function registerUxCommands(ports: UxCommandPorts): void {
	ports.registerCommand("codictator.restartEngine", () => {
		ports.restartEngine();
	});
	ports.registerCommand("codictator.showLog", () => {
		ports.showLog();
	});
	ports.registerCommand("codictator.refresh", () => {
		ports.refreshViews();
	});
	ports.registerCommand("codictator.focusViews", () => {
		ports.focusViews();
	});
	ports.registerCommand("codictator.timelineLoadMore", (cursor: unknown) => {
		if (typeof cursor === "string") {
			ports.loadMore(cursor);
		}
	});
	ports.registerCommand("codictator.installEngine", () => {
		const terminal = ports.createTerminal("Codictator Install");
		terminal.sendText("npm ci", true);
		terminal.show();
	});
	ports.registerCommand("codictator.captureBaseline", () => {
		const terminal = ports.createTerminal("Codictator Baseline");
		terminal.sendText("codictator baseline capture", false);
		terminal.show();
	});
	ports.registerCommand("codictator.depsCheck", () => {
		const terminal = ports.createTerminal("Codictator Deps");
		terminal.sendText("codictator deps check", false);
		terminal.show();
	});
}
