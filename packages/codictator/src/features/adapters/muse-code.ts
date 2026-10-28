// SPEC §4.5.4: the Muse Code adapter. Parse, reply and staticBlock are
// pure; hookIoVerified stays false until a first-party capture lands (§4.5.7).
import type { Result } from "../../kernel/index.ts";
import { parseClaudeShapedEvent } from "./claude-shaped.ts";
import type {
	Adapter,
	CapabilityDeclaration,
	HookDecision,
	HookEvent,
	HookReply,
	ToolKind,
} from "./contract.ts";
import { normalizeToolName } from "./contract.ts";

// SPEC §4.5.3: per-adapter table. Unknown names fall back to other through
// the contract normaliser, so a new harness tool is still seen.
const MUSE_TOOL_TABLE: Readonly<Record<string, ToolKind>> = {
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

export function normalizeMuseToolName(name: string): ToolKind {
	return normalizeToolName(MUSE_TOOL_TABLE, name);
}

export function parseMuseEvent(event: string, raw: unknown): Result<HookEvent> {
	return parseClaudeShapedEvent("muse-code", event, raw, MUSE_TOOL_TABLE);
}

// SPEC §4.5.4: exit 0 always; stdout carries only the hookSpecificOutput
// form. Allow is exactly {}; a bare allow is rejected by the harness, and
// legacy top-level shapes are hook errors, so neither is ever emitted.
export function replyMuse(decision: HookDecision): HookReply {
	if (decision.decision === "block" || decision.decision === "escalate") {
		const reason = decision.message ?? "blocked";
		return {
			exitCode: 0,
			stdout: JSON.stringify({
				hookSpecificOutput: {
					hookEventName: "PreToolUse",
					permissionDecision: "deny",
					permissionDecisionReason: reason,
				},
			}),
			stderr: "",
		};
	}
	if (
		decision.additionalContext !== undefined &&
		decision.additionalContext.length > 0
	) {
		return {
			exitCode: 0,
			stdout: JSON.stringify({
				hookSpecificOutput: {
					additionalContext: decision.additionalContext,
				},
			}),
			stderr: "",
		};
	}
	return { exitCode: 0, stdout: "{}", stderr: "" };
}

// SPEC §4.5.1: the pre-engine deny form, embedded by regen for CDX-E002 and
// CDX-E003. No engine state, so it works when the engine is missing.
export function staticBlockMuse(code: string, message: string): HookReply {
	return replyMuse({
		decision: "block",
		message: `${code} ${message}`,
		eventId: "static",
	});
}

export const MUSE_CAPABILITIES: CapabilityDeclaration = {
	harness: "muse-code",
	adapterVersion: "0.0.0",
	verifiedAgainst: {
		version: "1.4.10",
		date: "2026-10-26",
		source: "vendor docs; third-party live probes (see SPEC §4.5.4)",
	},
	layers: {
		L0: "partial",
		L1: "native",
		L2: "none",
		L3: "native",
		L4: "native",
		L5: "none",
	},
	controls: {
		contextFile: true,
		contextInject: true,
		postCompactInject: false,
		promptBlock: false,
		preToolBlock: true,
		readBlock: true,
		postToolFeedback: false,
		autoCompactConfig: "none",
		forceCompact: false,
		forceClear: false,
		usageData: "none",
		skills: true,
		subagents: false,
		commands: false,
		projectPermissions: false,
		trustRequired: true,
		timeoutFailMode: "unknown",
		launcherMissingFailMode: "unknown",
		hookIoVerified: false,
		projectRootSource: "cwd",
		agentEnvMarkers: [],
	},
	gaps: [
		"hookIoVerified is false until a first-party capture passes (§4.5.7)",
		"subagent definition files: managed in-product, no documented file",
		"project-level permissions: settings are user-level",
		"hook timeout field: none documented",
		"post-tool feedback: blocking unconfirmed, reports disagree",
		"exit-2 deny: unconfirmed, never emitted",
		"updatedInput: reports disagree, never emitted",
		"SessionStart source values: unverified",
		"usage data: no documented field; transcript_path is null under exec",
	],
};

function renderMuse(): never {
	throw new Error("not implemented: SPEC §4.5.4 render lands in step 6.3");
}

export const museAdapter: Adapter = {
	id: "muse-code",
	capabilities: MUSE_CAPABILITIES,
	render: renderMuse,
	parse: parseMuseEvent,
	reply: replyMuse,
	staticBlock: staticBlockMuse,
};
