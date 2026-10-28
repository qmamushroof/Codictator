// SPEC §4.5.1-§4.5.3: the adapter contract every harness implements.
// Pure types plus the tool-name normaliser, so one harness's churn cannot
// break another (§3.4).
import type { Result } from "../../kernel/index.ts";
import type { Decision, Trigger } from "../engine/index.ts";

export type ToolKind =
	| "write"
	| "shell"
	| "read"
	| "search"
	| "web"
	| "mcp"
	| "task"
	| "other";

export interface HookToolCall {
	readonly kind: ToolKind;
	readonly name: string;
	readonly paths: ReadonlyArray<string>;
	readonly command?: string;
	readonly proposedContent?: string;
	readonly range?: { readonly offset: number; readonly limit: number };
	readonly query?: string;
}

export interface HookEvent {
	readonly harness: string;
	readonly event: string;
	readonly trigger: Trigger;
	readonly sessionId: string;
	readonly agentId?: string;
	readonly role?: string;
	readonly cwd: string;
	readonly source?: "startup" | "resume" | "clear" | "compact";
	readonly tool?: HookToolCall;
	readonly usage?: {
		readonly contextTokens: number;
		readonly contextWindow: number;
	};
	readonly transcriptPath?: string;
	readonly modelProvider?: string;
}

export interface HookDecision {
	readonly decision: Decision;
	readonly message?: string;
	readonly additionalContext?: string;
	readonly eventId: string;
}

// SPEC §4.5.1: the harness-native reply. stdout carries the whole reply;
// stderr stays empty so exit 0 plus hookSpecificOutput is the only signal.
export interface HookReply {
	readonly exitCode: number;
	readonly stdout: string;
	readonly stderr: string;
}

export interface FileArtifact {
	readonly path: string;
	readonly content: string;
}

export interface CapabilityLayers {
	readonly L0: "native" | "partial" | "none";
	readonly L1: "native" | "partial" | "none";
	readonly L2: "native" | "partial" | "none";
	readonly L3: "native" | "partial" | "none";
	readonly L4: "native" | "partial" | "none";
	readonly L5: "native" | "partial" | "none";
}

export interface CapabilityControls {
	readonly contextFile: boolean;
	readonly contextInject: boolean;
	readonly postCompactInject: boolean;
	readonly promptBlock: boolean;
	readonly preToolBlock: boolean;
	readonly readBlock: boolean;
	readonly postToolFeedback: boolean;
	readonly autoCompactConfig: "native" | "partial" | "none";
	readonly forceCompact: boolean;
	readonly forceClear: boolean;
	readonly usageData: "native" | "transcript" | "none";
	readonly skills: boolean;
	readonly subagents: boolean;
	readonly commands: boolean;
	readonly projectPermissions: boolean;
	readonly trustRequired: boolean;
	readonly timeoutFailMode: "closed" | "open" | "unknown";
	readonly launcherMissingFailMode: "closed" | "open" | "unknown";
	readonly hookIoVerified: boolean;
	readonly projectRootSource: string;
	readonly agentEnvMarkers: ReadonlyArray<string>;
}

// SPEC §7.9: capability declaration shape.
export interface CapabilityDeclaration {
	readonly harness: string;
	readonly adapterVersion: string;
	readonly verifiedAgainst: {
		readonly version: string;
		readonly date: string;
		readonly source: string;
	};
	readonly layers: CapabilityLayers;
	readonly controls: CapabilityControls;
	readonly gaps: ReadonlyArray<string>;
}

export interface RenderInput {
	readonly event: HookEvent;
	readonly decision: HookDecision;
}

// SPEC §3.4 plus §4.5.1: staticBlock carries the pre-engine deny form.
export interface Adapter {
	readonly id: string;
	readonly capabilities: CapabilityDeclaration;
	readonly render: (input: RenderInput) => Array<FileArtifact>;
	readonly parse: (event: string, raw: unknown) => Result<HookEvent>;
	readonly reply: (decision: HookDecision) => HookReply;
	readonly staticBlock: (code: string, message: string) => HookReply;
}

// SPEC §4.5.3: per-adapter table from lower-cased tool name to kind.
// An unknown name maps to other so a new harness tool is still seen.
export function normalizeToolName(
	table: Readonly<Record<string, ToolKind>>,
	name: string,
): ToolKind {
	const key = name.trim().toLowerCase();
	const direct = table[key];
	if (direct !== undefined) {
		return direct;
	}
	if (key.startsWith("mcp__") || key === "mcp") {
		return "mcp";
	}
	return "other";
}
