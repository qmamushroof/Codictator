// SPEC §4.5.8 EC-17..EC-20: the bridge payload to the normalised event.
// Split from opencode.ts; tables live in opencode-tables.ts, reply and the
// adapter assembly stay in opencode.ts.
import type { CdxError, Result } from "../../kernel/index.ts";
import { err, makeError, ok } from "../../kernel/index.ts";
import type { HookEvent, HookToolCall } from "./contract.ts";
import {
	mapOpenCodeEvent,
	normalizeOpenCodeToolName,
} from "./opencode-tables.ts";

interface OpenCodeRecord {
	readonly [key: string]: unknown;
	readonly contextDelivered?: unknown;
	readonly spawnError?: unknown;
	readonly timedOut?: unknown;
}

function isRecord(value: unknown): value is OpenCodeRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(
	record: OpenCodeRecord,
	keys: ReadonlyArray<string>,
): string | undefined {
	for (const key of keys) {
		const value: unknown = record[key];
		if (typeof value === "string" && value.length > 0) {
			return value;
		}
	}
	return undefined;
}

function readArgs(raw: OpenCodeRecord): OpenCodeRecord {
	for (const key of ["args", "tool_input", "toolInput", "input"]) {
		const value: unknown = raw[key];
		if (isRecord(value)) {
			return value;
		}
	}
	return {};
}

function collectOpenCodePaths(args: OpenCodeRecord): Array<string> {
	const found = new Set<string>();
	for (const key of ["filePath", "file_path", "path", "file", "filename"]) {
		const value: unknown = args[key];
		if (typeof value === "string" && value.length > 0) {
			found.add(value);
		} else if (Array.isArray(value)) {
			for (const entry of value) {
				if (typeof entry === "string" && entry.length > 0) {
					found.add(entry);
				}
			}
		}
	}
	return [...found].sort();
}

function blockError(detail: string): CdxError {
	return makeError(
		"CDX-E303",
		`unparseable opencode hook payload: ${detail}`,
		"Check the harness hook configuration, then retry the tool call.",
	);
}

function readOpenCodeTool(raw: OpenCodeRecord): Result<HookToolCall> {
	const toolName = readString(raw, ["tool", "toolName", "tool_name"]);
	if (toolName === undefined) {
		return err(blockError("missing tool"));
	}
	const args = readArgs(raw);
	const command = readString(args, ["command"]);
	const proposedContent = readString(args, [
		"content",
		"new_content",
		"newContent",
		"new_string",
		"newString",
		"text",
		"proposedContent",
	]);
	const query = readString(args, ["query", "pattern", "prompt"]);
	return ok({
		kind: normalizeOpenCodeToolName(toolName),
		name: toolName,
		paths: collectOpenCodePaths(args),
		...(command === undefined ? {} : { command }),
		...(proposedContent === undefined ? {} : { proposedContent }),
		...(query === undefined ? {} : { query }),
	});
}

// SPEC §4.5.8 EC-17..EC-19: the bridge payload to the normalised event. A
// spawn failure is CDX-E001; a launch timeout carries no tool data and is a
// pre-tool marker for the CDX-E902 the next run records; anything else
// without tool data fails closed.
export function parseOpenCodeEvent(
	event: string,
	raw: unknown,
): Result<HookEvent> {
	if (!isRecord(raw)) {
		return err(blockError("expected a JSON object"));
	}
	const spawnError: unknown = raw.spawnError;
	if (typeof spawnError === "string" && spawnError.length > 0) {
		return err(
			makeError(
				"CDX-E001",
				"opencode bridge could not start node",
				"Put node on PATH, then retry the tool call.",
			),
		);
	}
	const nativeName = readString(raw, ["event", "eventName", "type"]);
	const nativeTrigger =
		nativeName === undefined ? undefined : mapOpenCodeEvent(nativeName);
	const trigger = nativeTrigger ?? mapOpenCodeEvent(event);
	if (trigger === undefined) {
		return err(blockError("unknown event"));
	}
	const sessionId = readString(raw, ["sessionID", "sessionId", "session_id"]);
	if (sessionId === undefined) {
		return err(blockError("missing session id"));
	}
	const cwd = readString(raw, ["cwd", "directory"]) ?? "";
	if (trigger === "pre-tool" || trigger === "post-tool") {
		const tool = readOpenCodeTool(raw);
		if (!tool.ok) {
			if (trigger === "pre-tool" && raw.timedOut === true) {
				return ok({
					harness: "opencode",
					event: nativeName ?? event,
					trigger,
					sessionId,
					cwd,
				});
			}
			// SPEC §4.5.8 EC-20: the bridge probe trips when a tool call fires
			// in a turn whose context the transform never delivered. The
			// bridge forwards contextDelivered: false; the launcher records
			// the gap marker here and the bridge falls back to a synthetic
			// chat.message part from the next prompt. Never a block by itself.
			if (trigger === "pre-tool" && raw.contextDelivered === false) {
				return ok({
					harness: "opencode",
					event: nativeName ?? event,
					trigger,
					sessionId,
					cwd,
				});
			}
			return tool;
		}
		return ok({
			harness: "opencode",
			event: nativeName ?? event,
			trigger,
			sessionId,
			cwd,
			tool: tool.value,
		});
	}
	return ok({
		harness: "opencode",
		event: nativeName ?? event,
		trigger,
		sessionId,
		cwd,
	});
}
