// SPEC §4.5: rendering per harness, hook I/O translation. Owns the §7.8
// hook contract and the §7.9 capability declaration.
import type { Result } from "../../kernel/index.ts";
import { err, makeError } from "../../kernel/index.ts";
import type { Decision, Trigger } from "../engine/index.ts";
import { replyClaudeCode, staticBlockClaudeCode } from "./claude-code.ts";
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
import { HOOK_PAYLOAD_MAX_BYTES } from "./contract.ts";
import {
	MUSE_CAPABILITIES,
	museAdapter,
	normalizeMuseToolName,
	parseMuseEvent,
	replyMuse,
	staticBlockMuse,
} from "./muse-code.ts";
import {
	normalizeOpenCodeToolName,
	opencodeAdapter,
	parseOpenCodeEvent,
	replyOpenCode,
	staticBlockOpenCode,
} from "./opencode.ts";
import { OPENCODE_CAPABILITIES } from "./opencode-capabilities.ts";

export {
	type HookAppend,
	type HookBasePorts,
	type HookRunRequest,
	hookBudgetMs,
	runHookEvent,
	staticBlock,
	supportedHarness,
} from "./runtime.ts";
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
	HOOK_PAYLOAD_MAX_BYTES,
	MUSE_CAPABILITIES,
	museAdapter,
	normalizeMuseToolName,
	normalizeOpenCodeToolName,
	OPENCODE_CAPABILITIES,
	opencodeAdapter,
	parseMuseEvent,
	parseOpenCodeEvent,
	replyClaudeCode,
	replyMuse,
	replyOpenCode,
	staticBlockClaudeCode,
	staticBlockMuse,
	staticBlockOpenCode,
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
// claude-code unit rows until its own adapter lands in phase 9. Payloads
// over the 8 MiB cap block CDX-E305 here too (§4.5 EC-11), so the parse
// layer enforces the same limit the runtime stdin read enforces.
export function parseEvent(
	harness: string,
	event: string,
	raw: unknown,
): Result<HookEvent> {
	const text = JSON.stringify(raw);
	if (
		text !== undefined &&
		new TextEncoder().encode(text).length > HOOK_PAYLOAD_MAX_BYTES
	) {
		return err(
			makeError(
				"CDX-E305",
				"hook payload over 8 MiB is refused",
				"Write the file in smaller edits, then retry the tool call.",
			),
		);
	}
	if (harness === "muse-code") {
		return parseMuseEvent(event, raw);
	}
	if (harness === "opencode") {
		return parseOpenCodeEvent(event, raw);
	}
	if (harness === "claude-code") {
		return parseClaudeShapedEvent(harness, event, raw, CLAUDE_SHAPED_TABLE);
	}
	throw new Error(`not implemented: SPEC §4.5.4 adapter for ${harness}`);
}

// SPEC §4.5.4: verdict to the harness-native reply. Claude Code rides the
// shared Claude-shaped reply until its full adapter lands in phase 9.4, the
// same way its parse already rides the shared contract parse.
export function renderReply(
	harness: string,
	decision: HookDecision,
): HookReply {
	if (harness === "muse-code") {
		return replyMuse(decision);
	}
	if (harness === "opencode") {
		return replyOpenCode(decision);
	}
	if (harness === "claude-code") {
		return replyClaudeCode(decision);
	}
	throw new Error(`not implemented: SPEC §4.5.4 adapter for ${harness}`);
}
