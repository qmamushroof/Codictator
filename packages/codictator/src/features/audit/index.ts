// SPEC §4.18: event log, explain, summaries. Owns the §7.10 event log
// line format.
import type { Decision, Trigger } from "../engine/index.ts";

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
	readonly durationMs: number;
	readonly configHash: string;
	readonly packs: Readonly<Record<string, string>>;
	readonly message?: string;
}

// SPEC §4.18.2: human-readable explanation of an event id.
export function explain(_eventId: string): Promise<string> {
	throw new Error("not implemented: SPEC §4.18.2");
}

// SPEC §4.18.3: status summary over recent events.
export function summarize(_since: string, _limit: number): Promise<string> {
	throw new Error("not implemented: SPEC §4.18.3");
}
