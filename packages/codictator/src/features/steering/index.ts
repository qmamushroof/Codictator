// SPEC §4.6: context rendering, budgets, read cache. Owns the AGENTS.md
// block (§4.6.2) and scoped injection (§4.6.3) byte budgets.
export interface SteeringBudget {
	readonly contextWindow: number;
	readonly usedTokens: number;
	readonly band: "green" | "amber" | "red";
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
	throw new Error("not implemented: SPEC §4.6.2");
}

// SPEC §4.6.3: per-scope injection inside its byte budget.
export function renderScopedInjection(
	_sessionId: string,
	_scope: ReadonlyArray<string>,
	_maxBytes: number,
): Promise<ScopedInjection> {
	throw new Error("not implemented: SPEC §4.6.3");
}

// SPEC §4.6.4: budget band lookup for the session.
export function currentBand(_sessionId: string): Promise<SteeringBudget> {
	throw new Error("not implemented: SPEC §4.6.4");
}
