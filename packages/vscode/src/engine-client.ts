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
				pack: "core@0.0.0",
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
