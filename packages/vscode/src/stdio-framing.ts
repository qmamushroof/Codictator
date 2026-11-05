// SPEC §4.20.1 Engine + §7.15: NDJSON framing for the stdio JSON-RPC
// client. Stdout chunks split anywhere, so bytes accumulate in buffered
// until each newline arrives; diagnostics stay on stderr. A numbered reply
// settles its waiter; an events/appended notification fans out to the
// Timeline source. Anything else is dropped: dropping never settles a
// waiter, so the request stays pending until the server answers or the
// transport closes.
import { isRecord, parseJsonLine, stringFieldOf } from "./engine-client.ts";
import type { EngineState } from "./stdio-client.ts";

const appendedMethod = "events/appended";

function errorMessageOf(message: Record<string, unknown>): string {
	const error = message["error"];
	if (!isRecord(error)) {
		return "engine error";
	}
	return stringFieldOf(error, "message") ?? "engine error";
}

// A numbered reply settles its waiter; an events/appended notification
// fans out to the Timeline source.
export function onEngineLine(state: EngineState, line: string): void {
	if (line === "") {
		return;
	}
	const message = parseJsonLine(line);
	if (message === undefined) {
		return;
	}
	const id = message["id"];
	if (typeof id === "number") {
		const call = state.pending.get(id);
		if (call === undefined) {
			return;
		}
		state.pending.delete(id);
		if ("error" in message) {
			call.reject(new Error(errorMessageOf(message)));
			return;
		}
		call.resolve(message["result"]);
		return;
	}
	if (id === undefined && message["method"] === appendedMethod) {
		for (const listener of [...state.appendedListeners]) {
			listener(state.folderPath);
		}
	}
}

// NDJSON framing: stdout chunks split anywhere, so bytes accumulate in
// buffered until each newline arrives.
export function appendEngineChunk(state: EngineState, chunk: string): void {
	state.buffered += chunk;
	let newline = state.buffered.indexOf("\n");
	while (newline >= 0) {
		const line = state.buffered.slice(0, newline).replace(/\r$/, "");
		state.buffered = state.buffered.slice(newline + 1);
		onEngineLine(state, line);
		newline = state.buffered.indexOf("\n");
	}
}
