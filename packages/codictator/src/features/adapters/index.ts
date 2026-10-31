// SPEC §4.5: rendering per harness, hook I/O translation. Owns the §7.8
// hook contract and the §7.9 capability declaration.
import type { Result } from "../../kernel/index.ts";
import { err, makeError } from "../../kernel/index.ts";
import type { Decision, Trigger } from "../engine/index.ts";
import {
	CLAUDE_CODE_CAPABILITIES,
	claudeCodeAdapter,
	normalizeClaudeCodeToolName,
	parseClaudeCodeEvent,
	replyClaudeCode,
	staticBlockClaudeCode,
} from "./claude-code.ts";
import {
	CODEX_CAPABILITIES,
	codexCliAdapter,
	normalizeCodexToolName,
	parseCodexEvent,
	replyCodex,
	staticBlockCodex,
} from "./codex-cli.ts";
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
	COPILOT_TIMEOUT_SEC,
	copilotAdapter,
	normalizeCopilotToolName,
	parseCopilotEvent,
	replyCopilot,
	staticBlockCopilot,
} from "./copilot.ts";
import { COPILOT_CAPABILITIES } from "./copilot-capabilities.ts";
import {
	CURSOR_CAPABILITIES,
	cursorAdapter,
	normalizeCursorToolName,
	parseCursorEvent,
	replyCursor,
	staticBlockCursor,
} from "./cursor.ts";
import {
	geminiCliAdapter,
	parseGeminiEvent,
	replyGemini,
	staticBlockGemini,
} from "./gemini-cli.ts";
import {
	GEMINI_CAPABILITIES,
	normalizeGeminiToolName,
} from "./gemini-tables.ts";
import {
	MUSE_CAPABILITIES,
	museAdapter,
	normalizeMuseToolName,
	parseMuseEvent,
	replyMuse,
	staticBlockMuse,
} from "./muse-code.ts";
import {
	isOpenCodeVersionSupported,
	normalizeOpenCodeToolName,
	OPENCODE_VERSION_MAXIMUM_EXCLUSIVE,
	OPENCODE_VERSION_MINIMUM,
	opencodeAdapter,
	parseOpenCodeEvent,
	replyOpenCode,
	staticBlockOpenCode,
} from "./opencode.ts";
import { OPENCODE_CAPABILITIES } from "./opencode-capabilities.ts";
import {
	parseUniversalEvent,
	replyUniversal,
	staticBlockUniversal,
	UNIVERSAL_CAPABILITIES,
	universalAdapter,
} from "./universal.ts";

export { hookBudgetMs } from "./hook-dispatch.ts";
export {
	type HookAppend,
	type HookBasePorts,
	type HookEnforcerLoader,
	type HookRunRequest,
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
	CLAUDE_CODE_CAPABILITIES,
	CODEX_CAPABILITIES,
	COPILOT_CAPABILITIES,
	COPILOT_TIMEOUT_SEC,
	CURSOR_CAPABILITIES,
	claudeCodeAdapter,
	codexCliAdapter,
	copilotAdapter,
	cursorAdapter,
	GEMINI_CAPABILITIES,
	geminiCliAdapter,
	HOOK_PAYLOAD_MAX_BYTES,
	isOpenCodeVersionSupported,
	MUSE_CAPABILITIES,
	museAdapter,
	normalizeClaudeCodeToolName,
	normalizeCodexToolName,
	normalizeCopilotToolName,
	normalizeCursorToolName,
	normalizeGeminiToolName,
	normalizeMuseToolName,
	normalizeOpenCodeToolName,
	OPENCODE_CAPABILITIES,
	OPENCODE_VERSION_MAXIMUM_EXCLUSIVE,
	OPENCODE_VERSION_MINIMUM,
	opencodeAdapter,
	parseClaudeCodeEvent,
	parseCodexEvent,
	parseCopilotEvent,
	parseCursorEvent,
	parseGeminiEvent,
	parseMuseEvent,
	parseOpenCodeEvent,
	parseUniversalEvent,
	replyClaudeCode,
	replyCodex,
	replyCopilot,
	replyCursor,
	replyGemini,
	replyMuse,
	replyOpenCode,
	replyUniversal,
	staticBlockClaudeCode,
	staticBlockCodex,
	staticBlockCopilot,
	staticBlockCursor,
	staticBlockGemini,
	staticBlockMuse,
	staticBlockOpenCode,
	staticBlockUniversal,
	UNIVERSAL_CAPABILITIES,
	universalAdapter,
};

// SPEC §4.5.3: native harness payload to the normalised event. Payloads
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
	if (harness === museAdapter.id) {
		return museAdapter.parse(event, raw);
	}
	if (harness === opencodeAdapter.id) {
		return opencodeAdapter.parse(event, raw);
	}
	if (harness === claudeCodeAdapter.id) {
		return claudeCodeAdapter.parse(event, raw);
	}
	if (harness === copilotAdapter.id) {
		return copilotAdapter.parse(event, raw);
	}
	if (harness === cursorAdapter.id) {
		return cursorAdapter.parse(event, raw);
	}
	if (harness === geminiCliAdapter.id) {
		return geminiCliAdapter.parse(event, raw);
	}
	if (harness === codexCliAdapter.id) {
		return codexCliAdapter.parse(event, raw);
	}
	if (harness === universalAdapter.id) {
		return universalAdapter.parse(event, raw);
	}
	throw new Error(`not implemented: SPEC §4.5.4 adapter for ${harness}`);
}

// SPEC §4.5.4: verdict to the harness-native reply.
export function renderReply(
	harness: string,
	decision: HookDecision,
): HookReply {
	if (harness === museAdapter.id) {
		return museAdapter.reply(decision);
	}
	if (harness === opencodeAdapter.id) {
		return opencodeAdapter.reply(decision);
	}
	if (harness === claudeCodeAdapter.id) {
		return claudeCodeAdapter.reply(decision);
	}
	if (harness === copilotAdapter.id) {
		return copilotAdapter.reply(decision);
	}
	if (harness === cursorAdapter.id) {
		return cursorAdapter.reply(decision);
	}
	if (harness === geminiCliAdapter.id) {
		return geminiCliAdapter.reply(decision);
	}
	if (harness === codexCliAdapter.id) {
		return codexCliAdapter.reply(decision);
	}
	if (harness === universalAdapter.id) {
		return universalAdapter.reply(decision);
	}
	throw new Error(`not implemented: SPEC §4.5.4 adapter for ${harness}`);
}
