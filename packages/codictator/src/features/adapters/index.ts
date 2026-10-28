// SPEC §4.5: rendering per harness, hook I/O translation. Owns the §7.8
// hook contract and the §7.9 capability declaration.
import type { Result } from "../../kernel/index.ts";
import type { Decision, Trigger } from "../engine/index.ts";
import { parseClaudeShapedEvent } from "./claude-shaped.ts";
import type {
	Adapter,
	CapabilityDeclaration,
	FileArtifact,
	HookDecision,
	HookEvent,
	HookReply,
	HookToolCall,
	RenderInput,
	ToolKind,
} from "./contract.ts";
import {
	MUSE_CAPABILITIES,
	museAdapter,
	normalizeMuseToolName,
	parseMuseEvent,
	replyMuse,
	staticBlockMuse,
} from "./muse-code.ts";

export type {
	Adapter,
	CapabilityDeclaration,
	Decision,
	FileArtifact,
	HookDecision,
	HookEvent,
	HookReply,
	HookToolCall,
	RenderInput,
	ToolKind,
	Trigger,
};
export {
	MUSE_CAPABILITIES,
	museAdapter,
	normalizeMuseToolName,
	parseMuseEvent,
	replyMuse,
	staticBlockMuse,
};

// SPEC §4.5.4: the Claude-shaped contract parse shared until each
// Claude-family harness lands its own adapter in phase 9.
const CLAUDE_SHAPED_TABLE: Readonly<Record<string, ToolKind>> = {
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

// SPEC §4.5.3: native harness payload to the normalised event. Muse Code is
// implemented in step 6.2; the Claude-shaped contract parse also covers the
// claude-code unit rows until its own adapter lands in phase 9.
export function parseEvent(
	harness: string,
	event: string,
	raw: unknown,
): Result<HookEvent> {
	if (harness === "muse-code") {
		return parseMuseEvent(event, raw);
	}
	if (harness === "claude-code") {
		return parseClaudeShapedEvent(harness, event, raw, CLAUDE_SHAPED_TABLE);
	}
	throw new Error(`not implemented: SPEC §4.5.4 adapter for ${harness}`);
}

// SPEC §4.5.4: verdict to the harness-native reply.
export function renderReply(
	harness: string,
	decision: HookDecision,
): HookReply {
	if (harness === "muse-code") {
		return replyMuse(decision);
	}
	throw new Error(`not implemented: SPEC §4.5.4 adapter for ${harness}`);
}
