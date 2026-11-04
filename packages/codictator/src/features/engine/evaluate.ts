// SPEC §4.3.3 evaluation with §4.3.8 fail closed: select rules for the
// trigger, run their enforcers concurrently under budget, apply waivers,
// decide, then append the verdict event before returning. The verdict is
// a pure function of the inputs (SPEC §4.3.6): enforcer and finding order
// is sorted and the id derives from the inputs, so replay is byte-identical.
// The clock arrives only through CheckContext.
import {
	type Instant,
	ok,
	type Result,
	sha256Text,
	stableStringify,
} from "../../kernel/index.ts";
import type { NewEvent } from "../audit/index.ts";
import type {
	CheckContext,
	Decision,
	Enforcer,
	Engine,
	Finding,
	Scope,
	Trigger,
	Verdict,
} from "./index.ts";
import { buildMessage } from "./message.ts";
import { appendFailedFinding, collectFindings } from "./run-enforcer.ts";
import {
	DEFAULT_WAIVER_STORE,
	type Waiver,
	type WaiverStore,
} from "./waivers.ts";

// SPEC §4.3.2: each engine trigger evaluates at one layer. Coarse triggers
// map to the layer of their first scope; finer hook names arrive with the
// adapter contract (phase 5).
const TRIGGER_LAYERS: Record<Trigger, string> = {
	startup: "L0",
	prompt: "L0",
	compact: "L0",
	"pre-tool": "L1",
	"post-tool": "L1",
	review: "L3",
	scheduled: "L5",
};

// SPEC §4.3.3: findings only from advisory triggers advise; everything
// else with findings blocks. L2 (editor.save, never a gate per §4.3.8) has
// no trigger in this union yet; prompt carries the injection path.
const ADVISORY_TRIGGERS: ReadonlyArray<Trigger> = ["prompt"];

export interface EngineOptions {
	readonly waiverStore?: WaiverStore;
	// Verdict sink. The default succeeds in memory so pure evaluation is
	// testable without I/O (SPEC §10.2); the hook runtime injects the
	// audit appendEvent here, whose failure fails the verdict closed.
	readonly append?: (event: NewEvent) => Promise<Result<void>>;
	readonly configHash?: string;
	readonly packs?: Readonly<Record<string, string>>;
}

// SPEC §4.3.6: the verdict id is a pure function of the inputs, so the
// same evaluation replays byte-identical (EC-12). Uniqueness across
// concurrent processes lives at append time: the hook runtime passes its
// per-process counter as the appendEvent seq (SPEC §7.10).
function makeVerdictId(
	now: Instant,
	trigger: Trigger,
	scope: Scope,
	decision: Decision,
	findings: ReadonlyArray<Finding>,
	waiversApplied: ReadonlyArray<string>,
	configHash: string,
): string {
	const stamp = now.replace(/[-:.]/g, "");
	const canonical = stableStringify({
		trigger,
		files: [...scope.files].sort(),
		sessionId: scope.sessionId,
		// SPEC §4.3.6: the hook input is a verdict input, so the proposed
		// tool content joins the id; two proposals never share an event.
		...(scope.proposedContent === undefined
			? {}
			: { proposedContent: scope.proposedContent }),
		...(scope.shellCommand === undefined
			? {}
			: { shellCommand: scope.shellCommand }),
		...(scope.proposedPaths === undefined
			? {}
			: { proposedPaths: [...scope.proposedPaths].sort() }),
		decision,
		findings,
		waiversApplied,
		configHash,
	});
	return `${stamp}-${sha256Text(canonical).slice(0, 12)}`;
}

function ruleIdsOf(findings: ReadonlyArray<Finding>): Array<string> {
	const seen = new Set<string>();
	for (const finding of findings) {
		seen.add(finding.ruleId);
	}
	return [...seen].sort();
}

function decideDecision(
	kept: ReadonlyArray<Finding>,
	trigger: Trigger,
): Decision {
	if (kept.length === 0) {
		return "allow";
	}
	return ADVISORY_TRIGGERS.includes(trigger) ? "advise" : "block";
}

// SPEC §4.3.8 + §4.3.9 EC-19: zero effective enforcers block, except the
// never-gating L2 layer, which advises. No engine trigger maps to L2 yet
// (see TRIGGER_LAYERS), so every trigger blocks until that phase lands.
function decideZeroEnforcer(trigger: Trigger): Decision {
	return TRIGGER_LAYERS[trigger] === "L2" ? "advise" : "block";
}

function buildVerdictEvent(
	trigger: Trigger,
	now: Instant,
	decision: Decision,
	kept: Array<Finding>,
	waiversApplied: ReadonlyArray<string>,
	configHash: string,
	packs: Readonly<Record<string, string>>,
	message: string,
	clockSkew: boolean,
): NewEvent {
	return {
		kind: "verdict",
		layer: TRIGGER_LAYERS[trigger],
		trigger,
		ruleIds: ruleIdsOf(kept),
		decision,
		findings: kept,
		durationMs: 0,
		configHash,
		packs,
		message,
		ts: now,
		...(clockSkew ? { clockSkew: true as const } : {}),
		...(waiversApplied.length > 0 ? { waivers: waiversApplied } : {}),
	};
}

function blockedVerdict(
	now: Instant,
	trigger: Trigger,
	scope: Scope,
	configHash: string,
): Verdict {
	const blocked = [appendFailedFinding()];
	const blockedId = makeVerdictId(
		now,
		trigger,
		scope,
		"block",
		blocked,
		[],
		configHash,
	);
	return {
		decision: "block",
		findings: blocked,
		message: buildMessage("block", blocked, blockedId),
		eventId: blockedId,
		waiversApplied: [],
	};
}

// SPEC §4.3.3 steps 4-6: decide the verdict from the collected findings,
// build the agent message, append the verdict event before returning, and
// fail closed when the append fails (PRD §6 P5).
async function finishEvaluation(
	input: {
		readonly trigger: Trigger;
		readonly scope: Scope;
		readonly now: Instant;
		readonly configHash: string;
		readonly packs: Readonly<Record<string, string>>;
		readonly kept: Array<Finding>;
		readonly waiversApplied: Array<string>;
		readonly zeroEnforcers: boolean;
		readonly clockSkew: boolean;
	},
	append: (event: NewEvent) => Promise<Result<void>>,
): Promise<Verdict> {
	const decision = input.zeroEnforcers
		? decideZeroEnforcer(input.trigger)
		: decideDecision(input.kept, input.trigger);
	const eventId = makeVerdictId(
		input.now,
		input.trigger,
		input.scope,
		decision,
		input.kept,
		input.waiversApplied,
		input.configHash,
	);
	const message = buildMessage(decision, input.kept, eventId);
	const event = buildVerdictEvent(
		input.trigger,
		input.now,
		decision,
		input.kept,
		input.waiversApplied,
		input.configHash,
		input.packs,
		message,
		input.clockSkew,
	);
	const appended = await append(event);
	if (!appended.ok) {
		return blockedVerdict(
			input.now,
			input.trigger,
			input.scope,
			input.configHash,
		);
	}
	return {
		decision,
		findings: input.kept,
		message,
		eventId,
		waiversApplied: input.waiversApplied,
	};
}

// SPEC §4.3.3: pure evaluation over registered enforcers.
export function createEngine(
	enforcers: ReadonlyArray<Enforcer>,
	options: EngineOptions = {},
): Engine {
	const ordered = [...enforcers].sort((a, b) =>
		a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
	);
	const store = options.waiverStore ?? DEFAULT_WAIVER_STORE;
	const append =
		options.append ??
		((): Promise<Result<void>> => Promise.resolve(ok(undefined)));
	const configHash = options.configHash ?? "unknown";
	const packs = options.packs ?? {};
	// Per-engine memory for EC-15 skew detection: closure state, never
	// module-level, so engines stay independent (CONVENTIONS determinism).
	// It never leaks into the verdict, which stays a pure function of its
	// inputs (SPEC §4.3.6).
	let lastNow: Instant | undefined;
	return {
		evaluate: async (
			trigger: Trigger,
			scope: Scope,
			now: Instant,
		): Promise<Verdict> => {
			const clockSkew = lastNow !== undefined && now < lastNow;
			if (lastNow === undefined || now > lastNow) {
				lastNow = now;
			}
			const ctx: CheckContext = { trigger, scope, now, configHash };
			const { kept, waiversApplied, zeroEnforcers } = await collectFindings(
				ordered,
				ctx,
				store,
			);
			return finishEvaluation(
				{
					trigger,
					scope,
					now,
					configHash,
					packs,
					kept,
					waiversApplied,
					zeroEnforcers,
					clockSkew,
				},
				append,
			);
		},
	};
}

export type { Waiver, WaiverStore };
