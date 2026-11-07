// SPEC §4.20.2 + §4.20.3 PR4: the violation actions — Problems-panel
// diagnostics with rule id as code plus explain and waive code actions
// (EC-7 opens a terminal pre-filled with `codictator waive …` and runs
// nothing), and the open-at-line command behind grouped violation rows.
import { fieldOf, isRecord } from "./engine-client.ts";
export interface FindingRef {
	readonly uri: string;
	readonly line?: number;
}

export interface WaiveRef {
	readonly uri: string;
	readonly code: string;
	readonly line?: number;
}

export interface ViolationCodeAction {
	readonly title: string;
	readonly command: string;
	readonly args: ReadonlyArray<unknown>;
}

// SPEC §4.20.2 PR4: the command descriptor behind a violation group row.
export function openFindingCommand(ref: FindingRef): ViolationCodeAction {
	if (ref.line === undefined) {
		return {
			args: [ref.uri],
			command: "codictator.openFinding",
			title: "Open finding",
		};
	}
	return {
		args: [ref.uri, ref.line],
		command: "codictator.openFinding",
		title: "Open finding",
	};
}

// SPEC §4.20.4 EC-7 PR4: the exact `codictator waive …` command line for a
// finding — rule, file and line — pre-filled in a terminal, never run.
export function waiveCommandLine(ref: WaiveRef): string {
	const line = ref.line === undefined ? "" : ` --line ${ref.line}`;
	return `codictator waive --rule ${ref.code} --file ${ref.uri}${line}`;
}

// SPEC §4.20.2 PR4: the explain action for a rule id.
export function explainActionFor(code: string): ViolationCodeAction {
	return {
		args: [code],
		command: "codictator.explain",
		title: "Explain rule",
	};
}

// SPEC §4.20.2 PR4: the per-finding code actions — explain the rule, waive
// the finding. The host registers them through its code-action provider at
// wiring time; this stays the pure descriptor list.
export function violationCodeActions(
	uri: string,
	entries: ReadonlyArray<{ code: string; line?: number }>,
): Array<ViolationCodeAction> {
	const actions: Array<ViolationCodeAction> = [];
	for (const entry of entries) {
		actions.push(explainActionFor(entry.code));
		const ref: WaiveRef =
			entry.line === undefined
				? { code: entry.code, uri }
				: { code: entry.code, line: entry.line, uri };
		actions.push({
			args: [ref.uri, ref.code, ...(ref.line === undefined ? [] : [ref.line])],
			command: "codictator.waiveFinding",
			title: "Waive…",
		});
	}
	return actions;
}

// The narrow ports the violation actions need: open-at-line, command
// registration and human-only terminals. No vscode import keeps the source
// erasable-syntax (SPEC §4.20.1).
export interface ViolationTerminal {
	sendText(text: string, execute: boolean): void;
	show(): void;
}

export interface ViolationActionPorts {
	registerCommand(
		commandId: string,
		handler: (...args: Array<unknown>) => unknown,
	): void;
	openFileAt(uri: string, line?: number): void;
	createTerminal(name: string): ViolationTerminal;
}

// SPEC §4.20.4 EC-7 PR4: register the open and waive-finding commands. The
// waive handler pre-fills the terminal and executes nothing — waive owns
// the repair (SPEC §4.19), so the UI never runs it.
export function registerViolationActions(ports: ViolationActionPorts): void {
	ports.registerCommand(
		"codictator.openFinding",
		(uri: unknown, line: unknown) => {
			if (typeof uri !== "string") {
				return;
			}
			if (typeof line === "number") {
				ports.openFileAt(uri, line);
			} else {
				ports.openFileAt(uri);
			}
		},
	);
	ports.registerCommand(
		"codictator.waiveFinding",
		(uri: unknown, code: unknown, line: unknown) => {
			if (typeof uri !== "string" || typeof code !== "string") {
				return;
			}
			const ref: WaiveRef =
				typeof line === "number" ? { code, line, uri } : { code, uri };
			const terminal = ports.createTerminal("Codictator Waive");
			terminal.sendText(waiveCommandLine(ref), false);
			terminal.show();
		},
	);
}

// SPEC §4.20.2 PR4: opening a violation row at its file and line. The
// selection needs the host Range and Position constructors; without them
// the document still opens, just without the line selected.
export function openFileAtOf(
	host: unknown,
): ((uri: string, line?: number) => void) | undefined {
	if (!isRecord(host)) {
		return undefined;
	}
	const window = fieldOf(host, "window");
	if (!isRecord(window)) {
		return undefined;
	}
	const showDoc = fieldOf(window, "showTextDocument");
	const uriSpace = fieldOf(host, "Uri");
	if (typeof showDoc !== "function" || !isRecord(uriSpace)) {
		return undefined;
	}
	const uriParse = fieldOf(uriSpace, "parse");
	if (typeof uriParse !== "function") {
		return undefined;
	}
	return (uri: string, line?: number): void => {
		try {
			const parsed: unknown = uriParse(uri);
			if (line === undefined) {
				showDoc(parsed);
				return;
			}
			const rangeCtor = fieldOf(host, "Range");
			const positionCtor = fieldOf(host, "Position");
			if (
				typeof rangeCtor === "function" &&
				typeof positionCtor === "function"
			) {
				const at: unknown = positionCtor(line, 0);
				showDoc(parsed, { selection: rangeCtor(at, at) });
			} else {
				showDoc(parsed);
			}
		} catch {
			// Opening never blocks the command.
		}
	};
}
