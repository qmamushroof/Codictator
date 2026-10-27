// SPEC §4.18: event log, explain, summaries. Owns the §7.10 event log
// line format.
import type { Decision, Trigger } from "../engine/index.ts";
import { appendEvent, LOG_REL, type NewEvent } from "./append.ts";
import { type ReadEvents, readEvents } from "./read.ts";

export { summarize } from "./summarize.ts";
export { appendEvent, LOG_REL, type NewEvent, type ReadEvents, readEvents };

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

// SPEC §4.18.2: human-readable explanation of an event id.
export function explain(_eventId: string): Promise<string> {
	throw new Error("not implemented: SPEC §4.18.2");
}
