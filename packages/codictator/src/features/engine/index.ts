// SPEC §4.3: rule model, evaluation, verdicts, waivers, ratchet.
import type {
	CheckContext,
	Decision,
	Enforcer,
	Finding,
	Instant,
	Result,
	Scope,
	Trigger,
} from "../../kernel/index.ts";
import type { EngineOptions } from "./evaluate.ts";
import { createEngine as createEngineImpl } from "./evaluate.ts";
import { buildMessage as buildMessageImpl } from "./message.ts";
import {
	DEFAULT_WAIVER_STORE,
	isWaived as isWaivedImpl,
	MAX_WAIVER_DAYS,
	matchWaivers as matchWaiversImpl,
	type Waiver,
	type WaiverStore,
} from "./waivers.ts";

export { TRIGGERS } from "../../kernel/index.ts";
export type {
	CheckContext,
	Decision,
	Enforcer,
	EngineOptions,
	Finding,
	Result,
	Scope,
	Trigger,
	Waiver,
	WaiverStore,
};
export { DEFAULT_WAIVER_STORE, MAX_WAIVER_DAYS };

// SPEC §4.3.7: the verdict carries its event id and the waivers that
// changed it, alongside the decision, findings and agent message.
export interface Verdict {
	readonly decision: Decision;
	readonly findings: ReadonlyArray<Finding>;
	readonly message: string;
	readonly eventId: string;
	readonly waiversApplied: ReadonlyArray<string>;
}

// SPEC §3.4 (types live in the kernel shared vocabulary): rules are data;
// enforcers plug in through the registry so the engine never grows per
// family. Enforcer arrives with the kernel type imports above and is
// re-exported with them, so existing importers keep working.

export interface Engine {
	readonly evaluate: (
		trigger: Trigger,
		scope: Scope,
		now: Instant,
	) => Promise<Verdict>;
}

// SPEC §4.3.3: pure evaluation over registered enforcers.
export function createEngine(
	enforcers: ReadonlyArray<Enforcer>,
	options: EngineOptions = {},
): Engine {
	return createEngineImpl(enforcers, options);
}

// SPEC §4.3.7: the agent-facing verdict text inside its byte budget.
export function buildMessage(
	decision: Decision,
	findings: ReadonlyArray<Finding>,
	eventId: string,
): string {
	return buildMessageImpl(decision, findings, eventId);
}

// SPEC §4.3.4: waiver lookup for the verdict path.
export function isWaived(
	ruleId: string,
	path: string,
	now: Instant,
	store: WaiverStore = DEFAULT_WAIVER_STORE,
): Promise<Result<boolean>> {
	return isWaivedImpl(ruleId, path, now, store);
}

// SPEC §4.3.4: the waivers suppressing a finding, or CDX-E103 for a floor
// rule waiver.
export function matchWaivers(
	store: WaiverStore,
	ruleId: string,
	path: string,
	now: Instant,
): Result<ReadonlyArray<Waiver>> {
	return matchWaiversImpl(store, ruleId, path, now);
}

// SPEC §4.3.5: ratchet comparison against the baseline.
export { compareRatchet } from "./ratchet.ts";
