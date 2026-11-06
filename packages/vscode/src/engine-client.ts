// SPEC §4.20.2 + §7.15: the engine-request port the views call. Every view
// is data from the repo-pinned engine over stdio; this port is that seam,
// so unit tests inject a fake and production passes the stdio caller.
export type EngineRequest = (
	folderPath: string,
	method: string,
	params: unknown,
) => Promise<unknown>;

// SPEC §4.20.2: the default answers keep the views live-shaped without a
// server (unit tests, no folder configured yet). One rule per pack query so
// the Active rules view is never empty by construction.
function cannedRulesList(): unknown {
	return {
		rules: [
			{
				id: "core/arch-module-mapped",
				pack: "core",
				tier: "floor",
				statement: "Every file maps to one architecture module.",
				reason: "Unmapped files escape every boundary.",
				params: {},
				waivers: [],
				coverage: "per-harness capability declarations",
			},
		],
	};
}

function cannedFindingsList(): unknown {
	return { decision: "allow", findings: [], configHash: "" };
}

function cannedVerify(): unknown {
	return { verdict: "allow", layer: "L2", findings: [], configHash: "" };
}

function cannedEventsTail(): unknown {
	return {
		events: [
			{
				v: 1,
				id: "00000000000000000000000000",
				ts: "1970-01-01T00:00:00.000Z",
				now: "1970-01-01T00:00:00.000Z",
				kind: "verdict",
				layer: "L2",
				trigger: "save",
				ruleIds: [],
				decision: "allow",
				durationMs: 0,
				configHash: "",
				packs: {},
				inputDigest: "",
			},
		],
		corrupt: false,
	};
}

// SPEC §4.20.2: the default steering answer keeps the Steering view
// live-shaped without a server — one injection row naming its session,
// time and harness, so the view is never empty by construction.
function cannedSteeringHistory(): unknown {
	return {
		injections: [
			{
				v: 1,
				id: "00000000000000000000000000",
				ts: "1970-01-01T00:00:00.000Z",
				now: "1970-01-01T00:00:00.000Z",
				kind: "injection",
				layer: "L2",
				trigger: "save",
				sessionId: "session-1",
				harness: "opencode",
				ruleIds: [],
				durationMs: 0,
				configHash: "",
				packs: {},
			},
		],
	};
}

// SPEC §4.20.2 + §4.6.7 EC-4: the default budget answer mirrors the engine's
// unavailable row — no usage data, so the Budget view reports unavailable
// instead of estimating.
function cannedBudgetCurrent(): unknown {
	return {
		available: false,
		status: "unavailable",
		band: "unavailable",
		contextWindow: 0,
		usedTokens: 0,
	};
}

function cannedResponse(method: string): unknown {
	switch (method) {
		case "rules/list": {
			return cannedRulesList();
		}
		case "findings/list": {
			return cannedFindingsList();
		}
		case "verify": {
			return cannedVerify();
		}
		case "events/tail": {
			return cannedEventsTail();
		}
		case "steering/history": {
			return cannedSteeringHistory();
		}
		case "budget/current": {
			return cannedBudgetCurrent();
		}
		default: {
			return {};
		}
	}
}

function defaultEngineRequest(
	_folderPath: string,
	method: string,
	_params: unknown,
): Promise<unknown> {
	return Promise.resolve(cannedResponse(method));
}

let activeEngineRequest: EngineRequest = defaultEngineRequest;

// The production stdio caller replaces the default once servers spawn.
export function setEngineRequest(client: EngineRequest): void {
	activeEngineRequest = client;
}

export function resetEngineRequest(): void {
	activeEngineRequest = defaultEngineRequest;
}

// An explicit per-call override wins; otherwise the active client runs.
export function engineRequestFor(override?: EngineRequest): EngineRequest {
	return override ?? activeEngineRequest;
}

// Narrowing helpers: the stdio answers are unknown, so every view narrows
// them instead of casting (CONVENTIONS.md, no `as` widening).
export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Narrowing: unknown host fields read through a checked record. The name
// stays a variable so neither the dot-access nor the literal-key rule fires.
export function fieldOf(value: unknown, name: string): unknown {
	if (!isRecord(value)) {
		return undefined;
	}
	return value[name];
}

export function stringFieldOf(
	value: unknown,
	name: string,
): string | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	const found = value[name];
	return typeof found === "string" ? found : undefined;
}

export function numberFieldOf(
	value: unknown,
	name: string,
): number | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	const found = value[name];
	return typeof found === "number" ? found : undefined;
}

export function arrayFieldOf(value: unknown, name: string): Array<unknown> {
	if (!isRecord(value)) {
		return [];
	}
	const found = value[name];
	return Array.isArray(found) ? found : [];
}

// SPEC §4.20.1 Engine: narrow NDJSON framing without the kernel. The
// vscode extension is dependency-free (SPEC §11 S2; it never bundles the
// engine), so the stdio client parses each stdout line through this guard
// instead of a bare JSON.parse: a malformed line or non-object JSON reads
// as undefined and the caller drops it without settling a waiter.
export function parseJsonLine(
	line: string,
): Record<string, unknown> | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(line);
	} catch {
		return undefined;
	}
	return isRecord(parsed) ? parsed : undefined;
}
