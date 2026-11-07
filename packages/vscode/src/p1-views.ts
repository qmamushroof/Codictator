// SPEC §4.20.2: P1 views — Steering and Budget (Health lives in
// health-views.ts). Every view is data from the repo-pinned engine over
// stdio (§7.15); this module owns the shaping, the engine itself owns the
// verdicts.
import type { EngineRequest } from "./engine-client.ts";
import {
	arrayFieldOf,
	engineRequestFor,
	isRecord,
	numberFieldOf,
	stringFieldOf,
} from "./engine-client.ts";

// SPEC §4.20.2 Steering: exactly what was injected, when, into which
// harness session, over `steering/history`.
export interface SteeringEntry {
	readonly sessionId: string;
	readonly injectedAt: string;
	readonly harness: string;
	// SPEC §4.20.2 PR4: the injected text, when the engine reports it, for
	// the read-only virtual document.
	readonly text?: string;
}

// SPEC §4.20.2 PR4: one steering session with its injections, newest last.
export interface SteeringSession {
	readonly sessionId: string;
	readonly harness: string;
	readonly injections: ReadonlyArray<SteeringEntry>;
}

// SPEC §4.20.2 Budget: band and usage per session, or "unavailable", over
// `budget/current`.
export interface BudgetState {
	readonly band: string;
	readonly usage: string;
	// SPEC §4.20.2 PR4: the progress shaping — percent when usage is known,
	// otherwise the human reason with the harness that reported it.
	readonly percent?: number;
	readonly reason?: string;
	readonly harness?: string;
}

// The injected text under any of the engine's spellings; absent stays
// absent so metadata-only rows still list.
function steeringTextOf(entry: Record<string, unknown>): string | undefined {
	return (
		stringFieldOf(entry, "text") ??
		stringFieldOf(entry, "content") ??
		stringFieldOf(entry, "injected")
	);
}

// SPEC §4.20.2: one steering row per injection event with a named session.
// Rows without a session or timestamp carry no "when / into which session",
// so they stay out the way the Violations view drops findings without a
// rule id; the harness falls back the way the Active rules view falls back
// its pack.
function toSteeringEntry(entry: unknown): SteeringEntry | undefined {
	if (!isRecord(entry)) {
		return undefined;
	}
	const sessionId = stringFieldOf(entry, "sessionId");
	const injectedAt = stringFieldOf(entry, "ts") ?? stringFieldOf(entry, "now");
	if (
		sessionId === undefined ||
		sessionId === "" ||
		injectedAt === undefined ||
		injectedAt === ""
	) {
		return undefined;
	}
	const text = steeringTextOf(entry);
	if (text === undefined) {
		return {
			harness: stringFieldOf(entry, "harness") ?? "unknown",
			injectedAt,
			sessionId,
		};
	}
	return {
		harness: stringFieldOf(entry, "harness") ?? "unknown",
		injectedAt,
		sessionId,
		text,
	};
}

// SPEC §4.20.2: Steering view data over `steering/history` — exactly what
// was injected, when, into which harness session.
export async function listSteeringEntries(
	folderPath: string,
	request?: EngineRequest,
): Promise<Array<SteeringEntry>> {
	const answer = await engineRequestFor(request)(
		folderPath,
		"steering/history",
		{},
	);
	const entries: Array<SteeringEntry> = [];
	for (const entry of arrayFieldOf(answer, "injections")) {
		const row = toSteeringEntry(entry);
		if (row !== undefined) {
			entries.push(row);
		}
	}
	return entries;
}

// SPEC §4.20.2 + §4.6.7 EC-4: Budget view data over `budget/current` — the
// band and the usage per session, or "unavailable" when the engine has no
// usage to report. Only engine-reported numbers render; nothing estimates.
// SPEC §4.20.2 PR4: session → injections, sorted by session then time, so
// the Steering view opens one row per session.
export function groupInjectionsBySession(
	entries: ReadonlyArray<SteeringEntry>,
): Array<SteeringSession> {
	const sessions = new Map<string, Array<SteeringEntry>>();
	const harnessOf = new Map<string, string>();
	for (const entry of entries) {
		const listed = sessions.get(entry.sessionId) ?? [];
		listed.push(entry);
		sessions.set(entry.sessionId, listed);
		if (!harnessOf.has(entry.sessionId)) {
			harnessOf.set(entry.sessionId, entry.harness);
		}
	}
	const grouped: Array<SteeringSession> = [];
	for (const sessionId of [...sessions.keys()].sort()) {
		const injections = [...(sessions.get(sessionId) ?? [])].sort(
			(left, right) =>
				left.injectedAt < right.injectedAt
					? -1
					: left.injectedAt > right.injectedAt
						? 1
						: 0,
		);
		grouped.push({
			harness: harnessOf.get(sessionId) ?? "unknown",
			injections,
			sessionId,
		});
	}
	return grouped;
}

export async function currentBudget(
	folderPath: string,
	request?: EngineRequest,
): Promise<BudgetState> {
	const answer = await engineRequestFor(request)(
		folderPath,
		"budget/current",
		{},
	);
	const band =
		stringFieldOf(answer, "band") ??
		stringFieldOf(answer, "status") ??
		"unavailable";
	const usedTokens = numberFieldOf(answer, "usedTokens");
	const contextWindow = numberFieldOf(answer, "contextWindow");
	const reason = stringFieldOf(answer, "reason");
	const harness = stringFieldOf(answer, "harness");
	if (
		usedTokens !== undefined &&
		contextWindow !== undefined &&
		contextWindow > 0 &&
		usedTokens >= 0
	) {
		const percent = Math.round((usedTokens / contextWindow) * 100);
		if (harness === undefined) {
			return {
				band,
				percent,
				usage: `${usedTokens}/${contextWindow} tokens used`,
			};
		}
		return {
			band,
			harness,
			percent,
			usage: `${usedTokens}/${contextWindow} tokens used`,
		};
	}
	if (reason === undefined) {
		if (harness === undefined) {
			return { band, usage: stringFieldOf(answer, "usage") ?? "unavailable" };
		}
		return {
			band,
			harness,
			usage: stringFieldOf(answer, "usage") ?? "unavailable",
		};
	}
	if (harness === undefined) {
		return {
			band,
			reason,
			usage: stringFieldOf(answer, "usage") ?? "unavailable",
		};
	}
	return {
		band,
		harness,
		reason,
		usage: stringFieldOf(answer, "usage") ?? "unavailable",
	};
}

// SPEC §4.20.2 PR4: the Budget label — a progress-style "62% · amber" when
// usage is known, or the human reason when the engine reports none. Only
// engine-reported numbers render; nothing estimates.
export function budgetLabel(state: BudgetState): string {
	if (state.percent !== undefined) {
		return `${state.percent}% · ${state.band}`;
	}
	if (state.reason === "harness-no-usage") {
		return `${state.harness ?? "This harness"} does not report token usage`;
	}
	if (state.reason === "no-session") {
		return "no agent session yet";
	}
	if (state.reason !== undefined) {
		return state.reason;
	}
	return `${state.band}: ${state.usage}`;
}
