// SPEC §4.3: rule model, evaluation, verdicts, waivers, ratchet.
import type { Instant, Result } from "../../kernel/index.ts";
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

export type { EngineOptions, Result, Waiver, WaiverStore };
export { DEFAULT_WAIVER_STORE, MAX_WAIVER_DAYS };

export const TRIGGERS = [
	"pre-tool",
	"post-tool",
	"prompt",
	"startup",
	"compact",
	"review",
	"scheduled",
] as const;

export type Trigger = (typeof TRIGGERS)[number];

export interface CheckContext {
	readonly trigger: Trigger;
	readonly scope: Scope;
	readonly now: Instant;
	readonly configHash: string;
}

export interface Scope {
	readonly files: ReadonlyArray<string>;
	readonly sessionId?: string;
}

export interface Finding {
	readonly ruleId: string;
	readonly path?: string;
	readonly line?: number;
	readonly code?: string;
	readonly message: string;
	readonly remediation: string;
}

export type Decision = "allow" | "advise" | "block" | "escalate";

// SPEC §4.3.7: the verdict carries its event id and the waivers that
// changed it, alongside the decision, findings and agent message.
export interface Verdict {
	readonly decision: Decision;
	readonly findings: ReadonlyArray<Finding>;
	readonly message: string;
	readonly eventId: string;
	readonly waiversApplied: ReadonlyArray<string>;
}

// SPEC §3.4: rules are data; enforcers plug in through the registry so the
// engine never grows per family. The enforcer carries the rule's identity
// (id), its triggers (kinds) and its check; scope globs and params arrive
// with the pack rule model (phase 5).
export interface Enforcer {
	readonly id: string;
	readonly kinds: ReadonlyArray<Trigger>;
	readonly budgetMs: number;
	readonly check: (
		ctx: CheckContext,
		params: Readonly<Record<string, unknown>>,
	) => Promise<Array<Finding>>;
}

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
