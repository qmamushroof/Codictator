// SPEC §4.20.1: the host terminal and message seams. Terminals pre-fill
// human-only commands for the human to run; messages surface engine and
// install prompts. A host without either surface degrades to a no-op
// instead of throwing.
import { fieldOf, isRecord } from "./engine-client.ts";

// SPEC §4.20.1: narrow ports the extension needs from the vscode terminal
// and message surfaces.
export interface ExtensionTerminal {
	sendText(text: string, execute: boolean): void;
	show(): void;
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
			if (typeof sendText === "function") {
				sendText(text, execute);
			}
		},
		show: (): void => {
			if (typeof show === "function") {
				show();
			}
		},
	};
}

export function terminalOf(
	hostWindow: unknown,
	name: string,
): ExtensionTerminal {
	const create = fieldOf(hostWindow, "createTerminal");
	if (typeof create === "function") {
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

export function messageOf(
	hostWindow: unknown,
	kind: "showWarningMessage" | "showInformationMessage",
	message: string,
	actions: ReadonlyArray<string>,
): Promise<string | undefined> {
	if (!isRecord(hostWindow)) {
		return Promise.resolve(undefined);
	}
	const show = hostWindow[kind];
	if (typeof show !== "function") {
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
