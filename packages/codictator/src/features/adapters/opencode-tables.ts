// SPEC §4.5.3: the OpenCode native event and tool tables. Split from
// opencode.ts; this module owns the data, opencode-parse.ts owns the
// payload narrowing, opencode.ts owns the reply/render/adapter assembly.
import type { Trigger } from "../engine/index.ts";
import type { ToolKind } from "./contract.ts";
import { normalizeToolName } from "./contract.ts";

// SPEC §4.5.3: per-adapter table. OpenCode tool names are unverified until a
// first-party capture (§4.5.7); an unknown name maps to other and is still
// seen by tool.pre.other rules.
export const OPENCODE_TOOL_TABLE: Readonly<Record<string, ToolKind>> = {
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

// SPEC §4.5.3: OpenCode events to normalised triggers. The per-prompt hooks
// (chat.message, the experimental transform) both feed the prompt trigger:
// the bridge spawns prompt.submit and caches the returned additionalContext,
// so the launcher evaluates the same steering content either way (EC-22).
const OPENCODE_EVENT_TABLE: Readonly<Record<string, Trigger>> = {
	"tool.execute.before": "pre-tool",
	"tool.pre.write": "pre-tool",
	"tool.pre.shell": "pre-tool",
	"tool.pre.read": "pre-tool",
	"tool.pre.search": "pre-tool",
	"tool.pre.other": "pre-tool",
	"tool.execute.after": "post-tool",
	"tool.post.write": "post-tool",
	"session.idle": "post-tool",
	"message.updated": "post-tool",
	stop: "post-tool",
	"session.created": "startup",
	"session.start": "startup",
	"session.compacted": "compact",
	"experimental.session.compacting": "compact",
	"compact.post": "compact",
	"prompt.submit": "prompt",
	"chat.message": "prompt",
	"experimental.chat.system.transform": "prompt",
};

export function mapOpenCodeEvent(event: string): Trigger | undefined {
	return OPENCODE_EVENT_TABLE[event];
}
