// SPEC §4.18: event log, explain, summaries. Owns the §7.10 event log
// line format.
import type { Decision, Trigger } from "../../kernel/index.ts";
import { appendEvent, LOG_REL, type NewEvent } from "./append.ts";
import {
	errorRowFor,
	explainCodeText,
	explainUnknownText,
	isKnownExplainId,
	nearestExplainIds,
} from "./explain.ts";
import { type ReadEvents, readEvents } from "./read.ts";
import {
	buildCiSummary,
	buildReportText,
	buildStatusJson,
	buildStatusText,
	type CiSummaryInput,
	type HarnessLayerState,
	type HarnessStatus,
	type HelperStatus,
	type ReportInput,
	replaySummary,
	type StatusInput,
	summarizeTokenSaverEvidence,
	type TokenSaverEvidence,
	tokenSaverHelper,
} from "./surfaces.ts";

export { summarize } from "./summarize.ts";
export {
	appendEvent,
	buildCiSummary,
	buildReportText,
	buildStatusJson,
	buildStatusText,
	type CiSummaryInput,
	errorRowFor,
	explainCodeText,
	explainUnknownText,
	type HarnessLayerState,
	type HarnessStatus,
	type HelperStatus,
	isKnownExplainId,
	LOG_REL,
	type NewEvent,
	nearestExplainIds,
	type ReadEvents,
	type ReportInput,
	readEvents,
	replaySummary,
	type StatusInput,
	summarizeTokenSaverEvidence,
	type TokenSaverEvidence,
	tokenSaverHelper,
};

export type EventKind =
	| "verdict"
	| "injection"
	| "escalation"
	| "waiver"
	| "upgrade"
	| "integrity"
	| "tool"
	| "install"
	| "remediation"
	| "review"
	| "session"
	| "llm";

// SPEC §7.10: findings on the line carry rule, path, line and code only.
export interface EventFinding {
	readonly ruleId: string;
	readonly path?: string;
	readonly line?: number;
	readonly code?: string;
}

export interface EventLogLine {
	readonly v: 1;
	readonly id: string;
	readonly ts: string;
	readonly now: string;
	readonly kind: EventKind;
	readonly layer: string;
	readonly trigger: Trigger;
	readonly harness?: string;
	readonly sessionId?: string;
	readonly taskId?: string;
	readonly ruleIds: ReadonlyArray<string>;
	readonly decision?: Decision;
	readonly findings?: ReadonlyArray<EventFinding>;
	readonly waivers?: ReadonlyArray<string>;
	readonly clockSkew?: boolean;
	readonly durationMs: number;
	readonly configHash: string;
	readonly packs: Readonly<Record<string, string>>;
	readonly message?: string;
}

// SPEC §4.18.2: human-readable explanation of a rule, event or error id.
// Error codes print their §8 row; anything else prints CDX-E010 with the
// nearest known ids (EC-4), which names CDX-E011 for replay-flavoured ids.
export function explain(eventId: string): Promise<string> {
	const found = errorRowFor(eventId);
	if (found !== undefined) {
		return Promise.resolve(explainCodeText(found));
	}
	return Promise.resolve(explainUnknownText(eventId));
}
