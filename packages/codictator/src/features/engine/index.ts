// SPEC §4.3: rule model, evaluation, verdicts, waivers, ratchet.
import type { Instant, Result } from "../../kernel/index.ts";

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

export interface Verdict {
	readonly decision: Decision;
	readonly findings: ReadonlyArray<Finding>;
	readonly message: string;
}

// SPEC §3.4: rules are data; enforcers plug in through the registry so the
// engine never grows per family.
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
export function createEngine(_enforcers: ReadonlyArray<Enforcer>): Engine {
	throw new Error("not implemented: SPEC §4.3.3");
}

// SPEC §4.3.4: waiver lookup for the verdict path.
export function isWaived(
	_ruleId: string,
	_path: string,
	_now: Instant,
): Promise<Result<boolean>> {
	throw new Error("not implemented: SPEC §4.3.4");
}

// SPEC §4.3.5: ratchet comparison against the baseline.
export function compareRatchet(
	_baseline: Readonly<Record<string, number>>,
	_current: Readonly<Record<string, number>>,
): ReadonlyArray<string> {
	throw new Error("not implemented: SPEC §4.3.5");
}
