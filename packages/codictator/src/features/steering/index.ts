// SPEC §4.6: context rendering, budgets, read cache. Owns the AGENTS.md
// block (§4.6.2) and scoped injection (§4.6.3) byte budgets. The three
// tested contracts stay on this entry; every helper lives beside it so
// adapters and the pack registry import through here (SPEC §3.3).
import { type BudgetBand, sessionBand } from "./budgets.ts";
import { renderContextFile as renderFile } from "./context-file.ts";
import {
	type InjectionOptions,
	renderScopedInjection as renderInjection,
} from "./injection.ts";

export type { AgentAssetId } from "./agent-assets.ts";
export {
	AGENT_ASSET_IDS,
	AGENT_ASSET_PURPOSES,
	AGENT_ASSET_TEMPLATES,
	findMissingHelpers,
	parseHelperList,
	renderAgentAsset,
} from "./agent-assets.ts";
export type { BudgetBand, SteeringSession } from "./budgets.ts";
export {
	bandForUsage,
	createSteeringSession,
	isSubagentSession,
	noteCheckpointCommitted,
	noteCompaction,
	noteSoftAdvised,
	recordSessionUsage,
	recordToolCall,
	sessionBand,
	startSteeringSession,
} from "./budgets.ts";
export {
	evaluateContextHardBand,
	evaluateContextSoftBand,
	evaluateRepeatReads,
	evaluateToolCallLimit,
	parseMarkerCount,
	parseMarkerMap,
	parseMarkerPercent,
} from "./checks.ts";
export type {
	ContextFileOptions,
	FloorRuleLine,
} from "./context-file.ts";
export { buildManagedBlock } from "./context-file.ts";
export {
	evaluateGraphBeforeScanMarkers,
	graphLookupInstruction,
	type SearchGate,
	shouldBlockSearch,
} from "./graph-scan.ts";
export type { InjectionOptions, InjectionRuleLine } from "./injection.ts";
export { injectionDigest } from "./injection.ts";
export {
	evaluateMcpDeclaredMarkers,
	findUndeclaredServers,
} from "./mcp.ts";
export {
	CONTEXT_BLOCK_MAX_BYTES,
	HARD_PERCENT_DEFAULT,
	MANAGED_BEGIN,
	MANAGED_END,
	MAX_TOOL_CALLS_DEFAULT,
	PRECEDENCE_STATEMENT,
	REQUIRED_HELPERS_DEFAULT,
	SCOPED_INJECTION_MAX_BYTES,
	SOFT_PERCENT_DEFAULT,
	utf8Bytes,
} from "./precedence.ts";
export type { ReadEntry, ReadRange } from "./read-cache.ts";
export {
	clearReadCache,
	createReadCache,
	isRepeatRead,
	recordRead,
} from "./read-cache.ts";

export interface SteeringBudget {
	readonly contextWindow: number;
	readonly usedTokens: number;
	readonly band: BudgetBand;
	// SPEC §4.6.7 EC-4: without usage data the band is unevaluated and the
	// budget view reports unavailable, never an estimate.
	readonly available: boolean;
}

export interface ScopedInjection {
	readonly sessionId: string;
	readonly content: string;
	readonly bytes: number;
}

// SPEC §4.6.2: precedence statement plus managed block rendering.
export function renderContextFile(
	_sessionId: string,
	_maxBytes: number,
): Promise<string> {
	return renderFile(_sessionId, _maxBytes);
}

// SPEC §4.6.3: per-scope injection inside its byte budget.
export function renderScopedInjection(
	_sessionId: string,
	_scope: ReadonlyArray<string>,
	_maxBytes: number,
	_options: InjectionOptions = {},
): Promise<ScopedInjection> {
	return renderInjection(_sessionId, _scope, _maxBytes, _options);
}

// SPEC §4.6.4: budget band lookup for the session. No usage is recorded
// through this contract, so the band is unevaluated by construction;
// runtimes thread a SteeringSession through recordSessionUsage and read
// sessionBand instead.
export function currentBand(_sessionId: string): Promise<SteeringBudget> {
	const fresh = sessionBand({
		sessionId: _sessionId,
		toolCalls: 0,
		usedTokens: 0,
		contextWindow: 0,
		usageKnown: false,
		checkpointRequired: false,
		softAdvised: false,
	});
	return Promise.resolve({
		contextWindow: 0,
		usedTokens: 0,
		band: fresh,
		available: false,
	});
}
