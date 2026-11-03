// SPEC §4.5.3-§4.5.4: the Claude-shaped snake_case stdin shared by the
// Claude-family harnesses. Missing required fields fail closed with
// CDX-E303; the raw shape is never echoed, so no prompt or file content
// leaks (§9.2).

import type { CdxError, Result } from "../../kernel/index.ts";
import { err, makeError, ok } from "../../kernel/index.ts";
import type { Trigger } from "../engine/index.ts";
import type { HookEvent, HookToolCall, ToolKind } from "./contract.ts";
import { normalizeToolName } from "./contract.ts";

type RawRecord = Record<string, unknown>;

// SPEC §4.5.3: first non-empty string under any of the keys. Shared with
// the sibling adapters, so the field readers never drift apart.
export function readString(
	record: Record<string, unknown>,
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

function isRecord(value: unknown): value is RawRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readToolInput(raw: RawRecord): RawRecord {
	for (const key of ["tool_input", "toolInput", "input", "args"]) {
		const value: unknown = raw[key];
		if (isRecord(value)) {
			return value;
		}
	}
	return {};
}

function collectPaths(input: RawRecord): Array<string> {
	const found = new Set<string>();
	for (const key of ["file_path", "filePath", "path", "file", "filename"]) {
		const value: unknown = input[key];
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

// SPEC §4.5.3: event names map to triggers through one table, so adding a
// harness alias is a row, not a branch.
const CLAUDE_EVENT_TABLE: Readonly<Record<string, Trigger>> = {
	PreToolUse: "pre-tool",
	"tool.pre.write": "pre-tool",
	"tool.pre.shell": "pre-tool",
	"tool.pre.read": "pre-tool",
	"tool.pre.search": "pre-tool",
	"tool.pre.other": "pre-tool",
	PostToolUse: "post-tool",
	"tool.post.write": "post-tool",
	Stop: "post-tool",
	stop: "post-tool",
	SessionStart: "startup",
	"session.start": "startup",
	SubagentStart: "startup",
	"subagent.start": "startup",
	UserPromptSubmit: "prompt",
	"prompt.submit": "prompt",
	PostCompact: "compact",
	"compact.post": "compact",
};

function mapClaudeEvent(event: string): Trigger | undefined {
	return CLAUDE_EVENT_TABLE[event];
}

function blockError(harness: string, detail: string): CdxError {
	return makeError(
		"CDX-E303",
		`unparseable ${harness} hook payload: ${detail}`,
		"Check the harness hook configuration, then retry the tool call.",
	);
}

interface BaseFields {
	readonly trigger: Trigger;
	readonly sessionId: string;
	readonly cwd: string;
	readonly canonicalEvent: string;
	readonly transcriptPath?: string;
	readonly modelProvider?: string;
	readonly source?: "startup" | "resume" | "clear" | "compact";
}

function readBaseFields(
	harness: string,
	event: string,
	raw: RawRecord,
): Result<BaseFields> {
	const nativeName = readString(raw, ["hook_event_name", "hookEventName"]);
	const trigger =
		mapClaudeEvent(event) ??
		(nativeName === undefined ? undefined : mapClaudeEvent(nativeName));
	if (trigger === undefined) {
		return err(blockError(harness, "unknown event"));
	}
	const cwd = readString(raw, ["cwd", "directory"]);
	if (cwd === undefined) {
		return err(blockError(harness, "missing cwd"));
	}
	const sessionId = readString(raw, ["session_id", "sessionId", "sessionID"]);
	if (sessionId === undefined) {
		return err(blockError(harness, "missing session id"));
	}
	const sourceValue = readString(raw, ["source"]);
	const source =
		sourceValue === "startup" ||
		sourceValue === "resume" ||
		sourceValue === "clear" ||
		sourceValue === "compact"
			? sourceValue
			: undefined;
	const transcriptPath = readString(raw, ["transcript_path", "transcriptPath"]);
	const modelProvider = readString(raw, ["model", "modelProvider"]);
	return ok({
		trigger,
		sessionId,
		cwd,
		canonicalEvent: nativeName ?? event,
		...(transcriptPath === undefined ? {} : { transcriptPath }),
		...(modelProvider === undefined ? {} : { modelProvider }),
		...(source === undefined ? {} : { source }),
	});
}

function readToolFields(
	harness: string,
	raw: RawRecord,
	table: Readonly<Record<string, ToolKind>>,
): Result<HookToolCall> {
	const toolName = readString(raw, ["tool_name", "toolName", "tool"]);
	if (toolName === undefined) {
		return err(blockError(harness, "missing tool_name"));
	}
	const input = readToolInput(raw);
	const command = readString(input, ["command"]);
	const proposedContent = readString(input, [
		"content",
		"new_content",
		"newContent",
		"new_string",
		"newString",
		"text",
		"proposedContent",
	]);
	const query = readString(input, ["query", "pattern", "prompt"]);
	return ok({
		kind: normalizeToolName(table, toolName),
		name: toolName,
		paths: collectPaths(input),
		...(command === undefined ? {} : { command }),
		...(proposedContent === undefined ? {} : { proposedContent }),
		...(query === undefined ? {} : { query }),
	});
}

export function parseClaudeShapedEvent(
	harness: string,
	event: string,
	raw: unknown,
	table: Readonly<Record<string, ToolKind>>,
): Result<HookEvent> {
	if (!isRecord(raw)) {
		return err(blockError(harness, "expected a JSON object"));
	}
	const base = readBaseFields(harness, event, raw);
	if (!base.ok) {
		return base;
	}
	if (base.value.trigger === "pre-tool") {
		const tool = readToolFields(harness, raw, table);
		if (!tool.ok) {
			return tool;
		}
		const baseValue = base.value;
		return ok({
			harness,
			event: baseValue.canonicalEvent,
			trigger: baseValue.trigger,
			sessionId: baseValue.sessionId,
			cwd: baseValue.cwd,
			...(baseValue.source === undefined ? {} : { source: baseValue.source }),
			tool: tool.value,
			...(baseValue.transcriptPath === undefined
				? {}
				: { transcriptPath: baseValue.transcriptPath }),
			...(baseValue.modelProvider === undefined
				? {}
				: { modelProvider: baseValue.modelProvider }),
		});
	}
	const { trigger, sessionId, cwd, canonicalEvent, ...rest } = base.value;
	return ok({
		...rest,
		harness,
		event: canonicalEvent,
		trigger,
		sessionId,
		cwd,
	});
}
