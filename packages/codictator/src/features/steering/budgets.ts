// SPEC §4.6.4: budget bands and session limits. Bands are evaluated from
// recorded usage only, never estimated (PRD §10); without usage data the
// band is unevaluated and the view reports unavailable (SPEC §4.6.7 EC-4).
// State is caller-owned per session id; the hook runtime threads it.
import {
	HARD_PERCENT_DEFAULT,
	MAX_TOOL_CALLS_DEFAULT,
	SOFT_PERCENT_DEFAULT,
} from "./precedence.ts";

export type BudgetBand = "green" | "amber" | "red";

export interface SteeringSession {
	readonly sessionId: string;
	readonly toolCalls: number;
	readonly usedTokens: number;
	readonly contextWindow: number;
	readonly usageKnown: boolean;
	readonly checkpointRequired: boolean;
	readonly softAdvised: boolean;
}

export function createSteeringSession(sessionId: string): SteeringSession {
	return {
		sessionId,
		toolCalls: 0,
		usedTokens: 0,
		contextWindow: 0,
		usageKnown: false,
		checkpointRequired: false,
		softAdvised: false,
	};
}

// SPEC §5.1: softPercent 60 (bound 70), hardPercent 75 (bound 85) of the
// context window. Non-positive windows and unknown usage never estimate:
// they report green so the tool-call limit still enforces (EC-4).
export function bandForUsage(
	usedTokens: number,
	contextWindow: number,
	softPercent: number = SOFT_PERCENT_DEFAULT,
	hardPercent: number = HARD_PERCENT_DEFAULT,
): BudgetBand {
	if (
		!Number.isFinite(usedTokens) ||
		!Number.isFinite(contextWindow) ||
		contextWindow <= 0 ||
		usedTokens < 0
	) {
		return "green";
	}
	const percent = (usedTokens / contextWindow) * 100;
	if (percent >= hardPercent) {
		return "red";
	}
	if (percent >= softPercent) {
		return "amber";
	}
	return "green";
}

export function sessionBand(session: SteeringSession): BudgetBand {
	if (!session.usageKnown) {
		return "green";
	}
	return bandForUsage(session.usedTokens, session.contextWindow);
}

export function recordSessionUsage(
	session: SteeringSession,
	usedTokens: number,
	contextWindow: number,
): SteeringSession {
	return { ...session, usedTokens, contextWindow, usageKnown: true };
}

// SPEC §5.1 core/session-tool-call-limit: maxToolCalls 300 (bound 500).
export function recordToolCall(
	session: SteeringSession,
	maxToolCalls: number = MAX_TOOL_CALLS_DEFAULT,
): SteeringSession {
	const toolCalls = session.toolCalls + 1;
	return {
		...session,
		toolCalls,
		checkpointRequired: session.checkpointRequired || toolCalls > maxToolCalls,
	};
}

// SPEC §4.6.4: a new session id, or a start from clear/compact, clears the
// checkpoint flag; the runtime injects the resume context separately.
export function startSteeringSession(
	sessionId: string,
	source: string = "startup",
): SteeringSession {
	const fresh = createSteeringSession(sessionId);
	if (source === "clear" || source === "compact") {
		return fresh;
	}
	return fresh;
}

// SPEC §4.6.7 EC-8: a drop below a band after compaction removes the
// higher markers silently, so a new climb advises again.
export function noteCompaction(session: SteeringSession): SteeringSession {
	if (!session.usageKnown) {
		return { ...session, softAdvised: false };
	}
	const band = bandForUsage(session.usedTokens, session.contextWindow);
	if (band === "green") {
		return { ...session, softAdvised: false, checkpointRequired: false };
	}
	return session;
}

export function noteCheckpointCommitted(
	session: SteeringSession,
): SteeringSession {
	return { ...session, checkpointRequired: true };
}

export function noteSoftAdvised(session: SteeringSession): SteeringSession {
	return { ...session, softAdvised: true };
}

// SPEC §4.6.4: a subagent is measured on its own usage. The hook runtime
// names subagent sessions with this prefix, so steering text can tell the
// subagent to return CHECKPOINT instead of clearing.
export function isSubagentSession(sessionId: string): boolean {
	return sessionId.startsWith("subagent-");
}
