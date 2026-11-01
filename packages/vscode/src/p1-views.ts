// SPEC §4.20.2: P1 views — Steering, Budget and Health. Every view is data
// from the repo-pinned engine over stdio (§7.15); this module owns the
// shaping, the engine itself owns the verdicts.
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
}

// SPEC §4.20.2 Budget: band and usage per session, or "unavailable", over
// `budget/current`.
export interface BudgetState {
	readonly band: string;
	readonly usage: string;
}

// SPEC §4.20.2 Health: ratchet trend, dependency freshness, integrity and
// remediation progress, over `status`.
export interface HealthState {
	readonly ratchet: string;
	readonly dependencies: string;
	readonly integrity: string;
	readonly remediation: string;
}

// The narrow port the P1 views need to register their tree data providers.
export interface P1ViewsApi {
	registerTreeDataProvider(viewId: string, items: ReadonlyArray<unknown>): void;
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
	return {
		sessionId,
		injectedAt,
		harness: stringFieldOf(entry, "harness") ?? "unknown",
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
	if (
		usedTokens !== undefined &&
		contextWindow !== undefined &&
		contextWindow > 0 &&
		usedTokens >= 0
	) {
		return { band, usage: `${usedTokens}/${contextWindow} tokens used` };
	}
	return {
		band,
		usage: stringFieldOf(answer, "usage") ?? "unavailable",
	};
}

// SPEC §4.20.2: Health view data over `status` — ratchet trend, dependency
// freshness, integrity and remediation progress. Absent sections read the
// same defaults the `status` text renders (§4.18.3), so the view stays
// live-shaped on an empty log.
export async function healthSummary(
	folderPath: string,
	request?: EngineRequest,
): Promise<HealthState> {
	const answer = await engineRequestFor(request)(folderPath, "status", {});
	return {
		ratchet: stringFieldOf(answer, "ratchet") ?? "no baseline history",
		dependencies: stringFieldOf(answer, "deps") ?? "freshness unknown",
		integrity: stringFieldOf(answer, "integrity") ?? "unverified",
		remediation: stringFieldOf(answer, "remediation") ?? "no plan",
	};
}

// SPEC §4.20.2: the Codictator container gains the three P1 tree views
// beside the P0 ones; each registration pins its view id.
export function registerSteeringBudgetHealthViews(api: P1ViewsApi): void {
	for (const viewId of [
		"codictator-budget",
		"codictator-health",
		"codictator-steering",
	]) {
		api.registerTreeDataProvider(viewId, []);
	}
}
