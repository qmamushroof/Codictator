// SPEC §4.5: rendering per harness, hook I/O translation. Owns the §7.8
// hook contract and the §7.9 capability declaration.
import type { Result } from "../../kernel/index.ts";
import type { Decision, Trigger } from "../engine/index.ts";

export interface HookToolCall {
	readonly kind: string;
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

export interface HookReply {
	readonly exitCode: number;
	readonly stdout: string;
}

export interface FileArtifact {
	readonly path: string;
	readonly content: string;
}

export interface AdapterCapabilities {
	readonly layers: Readonly<Record<string, "native" | "partial" | "none">>;
}

export interface AdapterCapability extends AdapterCapabilities {
	readonly harness: string;
	readonly adapterVersion: string;
	readonly verifiedAgainst: {
		readonly version: string;
		readonly date: string;
		readonly source: string;
	};
	readonly gaps: ReadonlyArray<string>;
}

export interface RenderInput {
	readonly event: HookEvent;
	readonly decision: HookDecision;
}

// SPEC §3.4: one harness's churn cannot break another; adapter sub-folders
// import only the contract plus modules allowed to adapters (§3.3).
export interface Adapter {
	readonly id: string;
	readonly capabilities: AdapterCapabilities;
	readonly render: (input: RenderInput) => Array<FileArtifact>;
	readonly parse: (event: string, raw: unknown) => Result<HookEvent>;
	readonly reply: (decision: HookDecision) => HookReply;
}

// SPEC §4.5.3: native harness payload to the normalised event.
export function parseEvent(
	_harness: string,
	_event: string,
	_raw: unknown,
): Result<HookEvent> {
	throw new Error("not implemented: SPEC §4.5.3");
}

// SPEC §4.5.4: verdict to the harness-native reply.
export function renderReply(
	_harness: string,
	_decision: HookDecision,
): HookReply {
	throw new Error("not implemented: SPEC §4.5.4");
}
