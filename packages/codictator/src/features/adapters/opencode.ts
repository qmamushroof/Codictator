// SPEC §4.5.4: the OpenCode adapter. Parse, reply and staticBlock are pure;
// hookIoVerified stays false until a first-party capture lands (§4.5.7).
import type { CdxError, Result } from "../../kernel/index.ts";
import { err, makeError, ok, stableStringify } from "../../kernel/index.ts";
import type { Trigger } from "../engine/index.ts";
import type {
	Adapter,
	FileArtifact,
	HookDecision,
	HookEvent,
	HookReply,
	HookToolCall,
	RenderInput,
	ToolKind,
} from "./contract.ts";
import { normalizeToolName } from "./contract.ts";
import { OPENCODE_BRIDGE_SOURCE } from "./opencode-bridge.ts";
import { OPENCODE_CAPABILITIES } from "./opencode-capabilities.ts";

// SPEC §4.5.3: per-adapter table. OpenCode tool names are unverified until a
// first-party capture (§4.5.7); an unknown name maps to other and is still
// seen by tool.pre.other rules.
const OPENCODE_TOOL_TABLE: Readonly<Record<string, ToolKind>> = {
	write: "write",
	edit: "write",
	notebookedit: "write",
	create: "write",
	apply_patch: "write",
	bash: "shell",
	shell: "shell",
	exec: "shell",
	terminal: "shell",
	bashoutput: "shell",
	read: "read",
	cat: "read",
	view: "read",
	glob: "search",
	grep: "search",
	search: "search",
	find: "search",
	ls: "search",
	webfetch: "web",
	websearch: "web",
	fetch: "web",
	curl: "web",
	task: "task",
	todo: "task",
	todowrite: "task",
	todoread: "task",
};

export function normalizeOpenCodeToolName(name: string): ToolKind {
	return normalizeToolName(OPENCODE_TOOL_TABLE, name);
}

interface OpenCodeRecord {
	readonly [key: string]: unknown;
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

// SPEC §4.5.3: OpenCode events to normalised triggers. The per-prompt hooks
// (chat.message, the experimental transform) land in phase 9.3; until then
// they are unknown shapes and fail closed.
function mapOpenCodeEvent(event: string): Trigger | undefined {
	switch (event) {
		case "tool.execute.before":
		case "tool.pre.write":
		case "tool.pre.shell":
		case "tool.pre.read":
		case "tool.pre.search":
		case "tool.pre.other":
			return "pre-tool";
		case "tool.execute.after":
		case "tool.post.write":
		case "session.idle":
		case "message.updated":
		case "stop":
			return "post-tool";
		case "session.created":
		case "session.start":
			return "startup";
		case "session.compacted":
		case "experimental.session.compacting":
		case "compact.post":
			return "compact";
		case "prompt.submit":
			return "prompt";
		default:
			return undefined;
	}
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
		kind: normalizeToolName(OPENCODE_TOOL_TABLE, toolName),
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

// SPEC §4.5.4 with S29: the wire is Codictator's own HookDecision JSON on
// stdout, exit 0. The bridge throws on a block reply, so gating stays closed.
export function replyOpenCode(decision: HookDecision): HookReply {
	return {
		exitCode: 0,
		stdout: JSON.stringify({
			decision: decision.decision,
			...(decision.message === undefined ? {} : { message: decision.message }),
			...(decision.additionalContext === undefined
				? {}
				: { additionalContext: decision.additionalContext }),
			eventId: decision.eventId,
		}),
		stderr: "",
	};
}

// SPEC §4.5.1: the pre-engine deny form, embedded by regen for CDX-E002 and
// CDX-E003. No engine state, so it works when the engine is missing.
export function staticBlockOpenCode(code: string, message: string): HookReply {
	return replyOpenCode({
		decision: "block",
		message: `${code} ${message}`,
		eventId: "static",
	});
}

// SPEC §4.5.4: owned opencode.json keys. Bypass-command deny patterns come
// from §4.14.3 in phase 9; until then the owned list is empty.
function renderOpenCodeJson(): string {
	return stableStringify({
		compaction: { auto: true },
		permission: { bash: [] },
	});
}

function renderOpenCode(_input: RenderInput): Array<FileArtifact> {
	return [
		{
			path: ".opencode/plugins/codictator.mjs",
			content: OPENCODE_BRIDGE_SOURCE,
		},
		{ path: "opencode.json", content: renderOpenCodeJson() },
	];
}

export const opencodeAdapter: Adapter = {
	id: "opencode",
	capabilities: OPENCODE_CAPABILITIES,
	render: renderOpenCode,
	parse: parseOpenCodeEvent,
	reply: replyOpenCode,
	staticBlock: staticBlockOpenCode,
};
