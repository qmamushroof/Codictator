// SPEC §4.5.4: the Gemini CLI capability declaration and native event tables.
// Split from gemini-cli.ts; this module owns the data, gemini-cli.ts owns the
// parse/reply/render logic.
import type { Trigger } from "../engine/index.ts";
import type { CapabilityDeclaration, ToolKind } from "./contract.ts";
import { normalizeToolName } from "./contract.ts";

export const GEMINI_CAPABILITIES: CapabilityDeclaration = {
	harness: "gemini-cli",
	adapterVersion: "0.0.0",
	verifiedAgainst: {
		version: "0.0.0",
		date: "2026-10-26",
		source:
			"SPEC §4.5.4 Gemini CLI row; vendor version unpinned until a first-party capture (§4.5.7)",
	},
	layers: {
		L0: "native",
		L1: "native",
		L2: "none",
		L3: "native",
		L4: "native",
		L5: "none",
	},
	controls: {
		contextFile: true,
		contextInject: false,
		postCompactInject: false,
		promptBlock: false,
		preToolBlock: true,
		readBlock: false,
		postToolFeedback: false,
		autoCompactConfig: "none",
		forceCompact: false,
		forceClear: false,
		usageData: "none",
		skills: false,
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
		"trusted-folder requirement unverified",
		"compaction events unverified",
	],
};

export const GEMINI_TOOL_TABLE: Readonly<Record<string, ToolKind>> = {
	write: "write",
	edit: "write",
	create: "write",
	apply_patch: "write",
	bash: "shell",
	shell: "shell",
	exec: "shell",
	terminal: "shell",
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
	task: "task",
	todo: "task",
};

export function normalizeGeminiToolName(name: string): ToolKind {
	return normalizeToolName(GEMINI_TOOL_TABLE, name);
}

// SPEC §4.5.3: native Gemini CLI events to the normalised trigger. Unknown
// names stay undefined so parse fails closed. AfterAgent feeds post-tool
// like every sibling stop-ish native (cursor stop, claude-shaped
// Stop/stop, opencode stop); the engine matches no rules on it and allows,
// which is the safe stop-hook behaviour (cf. §4.5.2: post-tool events
// never gate).
export const GEMINI_TRIGGER_TABLE: Readonly<Record<string, Trigger>> = {
	BeforeTool: "pre-tool",
	"tool.pre.write": "pre-tool",
	"tool.pre.shell": "pre-tool",
	"tool.pre.read": "pre-tool",
	"tool.pre.search": "pre-tool",
	"tool.pre.web": "pre-tool",
	"tool.pre.task": "pre-tool",
	"tool.pre.other": "pre-tool",
	AfterTool: "post-tool",
	"tool.post.write": "post-tool",
	"tool.post.shell": "post-tool",
	"tool.post.read": "post-tool",
	"tool.post.search": "post-tool",
	"tool.post.web": "post-tool",
	"tool.post.task": "post-tool",
	"tool.post.other": "post-tool",
	SessionStart: "startup",
	"session.start": "startup",
	BeforeAgent: "prompt",
	"prompt.submit": "prompt",
	AfterAgent: "post-tool",
};

export function mapGeminiEvent(event: string): Trigger | undefined {
	return GEMINI_TRIGGER_TABLE[event];
}
