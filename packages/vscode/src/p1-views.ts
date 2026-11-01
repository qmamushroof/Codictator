// SPEC §4.20.2: P1 views — Steering, Budget and Health. Every view is data
// from the repo-pinned engine over stdio (§7.15); this module will own the
// shaping once step 12.9 lands. Red-first: every entry throws.
import type { EngineRequest } from "./engine-client.ts";

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

export function listSteeringEntries(
	_folderPath: string,
	_request?: EngineRequest,
): Promise<Array<SteeringEntry>> {
	throw new Error("not implemented: SPEC §4.20.2 Steering");
}

export function currentBudget(
	_folderPath: string,
	_request?: EngineRequest,
): Promise<BudgetState> {
	throw new Error("not implemented: SPEC §4.20.2 Budget");
}

export function healthSummary(
	_folderPath: string,
	_request?: EngineRequest,
): Promise<HealthState> {
	throw new Error("not implemented: SPEC §4.20.2 Health");
}

export function registerSteeringBudgetHealthViews(_api: P1ViewsApi): void {
	throw new Error("not implemented: SPEC §4.20.2");
}
