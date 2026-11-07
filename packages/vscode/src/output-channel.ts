// SPEC §4.20.2: the Codictator output channel behind the log port. Spawn,
// transport and handshake failures land here so a dead engine is visible
// instead of silent. The failure detail every channel line renders lives
// here too.
import { fieldOf, isRecord } from "./engine-client.ts";

// Narrowing: the host object is unknown, so every field narrows through a
// check (CONVENTIONS.md, no `as` widening); one callable guard covers every
// host function slot.
type HostFn = (...args: Array<unknown>) => unknown;

function isHostFn(value: unknown): value is HostFn {
	return typeof value === "function";
}

// SPEC §4.20.2: the failure detail for the output channel.
export function detailOf(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}

// SPEC §4.20.2: the Codictator output channel behind the log port. A host
// without createOutputChannel logs nowhere instead of throwing.
function appendLineOf(host: unknown): ((message: string) => void) | undefined {
	const window = fieldOf(host, "window");
	const create = fieldOf(window, "createOutputChannel");
	if (!isHostFn(create)) {
		return undefined;
	}
	let channel: unknown;
	try {
		channel = create("Codictator");
	} catch {
		// Without a channel the log port below stays a no-op.
		return undefined;
	}
	if (!isRecord(channel)) {
		return undefined;
	}
	const appendLine = fieldOf(channel, "appendLine");
	if (!isHostFn(appendLine)) {
		return undefined;
	}
	return (message: string): void => {
		appendLine(message);
	};
}

export function logOf(host: unknown): (message: string) => void {
	const appendLine = appendLineOf(host);
	if (appendLine === undefined) {
		return (): void => undefined;
	}
	return (message: string): void => {
		try {
			appendLine(message);
		} catch {
			// Logging never blocks activation.
		}
	};
}

// SPEC §4.20.2 PR4: revealing the Codictator channel behind the "Show
// Engine Log" command. A host without a show surface degrades to a no-op.
export function showOf(host: unknown): (() => void) | undefined {
	const window = fieldOf(host, "window");
	const create = fieldOf(window, "createOutputChannel");
	if (!isHostFn(create)) {
		return undefined;
	}
	let channel: unknown;
	try {
		channel = create("Codictator");
	} catch {
		return undefined;
	}
	if (!isRecord(channel)) {
		return undefined;
	}
	const show = fieldOf(channel, "show");
	if (!isHostFn(show)) {
		return undefined;
	}
	return (): void => {
		try {
			show();
		} catch {
			// Revealing never blocks the command.
		}
	};
}
