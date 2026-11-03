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
import {
	appendFailedFinding,
	runEnforcer,
	sortFindings,
} from "./run-enforcer.ts";
import {
	DEFAULT_WAIVER_STORE,
	matchWaivers,
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

// SPEC §4.3.4: suppress findings covered by an active waiver, recording
// the waiver ids. Synthetic fail-closed findings (CDX-E*) never suppress,
// and an invalid floor-rule waiver blocks loudly instead of suppressing.
async function applyWaivers(
	findings: ReadonlyArray<Finding>,
	store: WaiverStore,
	now: Instant,
): Promise<{ kept: Array<Finding>; waiversApplied: Array<string> }> {
	const kept: Array<Finding> = [];
	const applied = new Set<string>();
	for (const finding of findings) {
		if (finding.code?.startsWith("CDX-E") === true) {
			kept.push(finding);
			continue;
		}
		const matched = matchWaivers(
			store,
			finding.ruleId,
			finding.path ?? "",
			now,
		);
		if (!matched.ok) {
			kept.push(finding);
			kept.push({
				ruleId: finding.ruleId,
				code: matched.error.code,
				message: matched.error.message,
				remediation: matched.error.remediation,
			});
			continue;
		}
		if (matched.value.length === 0) {
			kept.push(finding);
			continue;
		}
		for (const waiver of matched.value) {
			applied.add(waiver.id);
		}
	}
	return { kept, waiversApplied: [...applied].sort() };
}

function ruleIdsOf(findings: ReadonlyArray<Finding>): Array<string> {
	const seen = new Set<string>();
	for (const finding of findings) {
		seen.add(finding.ruleId);
	}
	return [...seen].sort();
}

async function collectFindings(
	ordered: ReadonlyArray<Enforcer>,
	ctx: CheckContext,
	store: WaiverStore,
): Promise<{ kept: Array<Finding>; waiversApplied: Array<string> }> {
	const runnable = ordered.filter((enforcer) =>
		enforcer.kinds.includes(ctx.trigger),
	);
	// SPEC §4.3.3 step 2: bounded concurrency — one guard at a time keeps every
	// guard's event-loop share (no E902 herd); sortFindings keeps the verdict byte-identical (§4.3.6).
	const ran: Array<Array<Finding>> = [];
	for (const enforcer of runnable) {
		ran.push(await runEnforcer(enforcer, ctx));
	}
	return applyWaivers(sortFindings(ran.flat()), store, ctx.now);
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
			const { kept, waiversApplied } = await collectFindings(
				ordered,
				ctx,
				store,
			);
			const decision = decideDecision(kept, trigger);
			const eventId = makeVerdictId(
				now,
				trigger,
				scope,
				decision,
				kept,
				waiversApplied,
				configHash,
			);
			const message = buildMessage(decision, kept, eventId);
			const event = buildVerdictEvent(
				trigger,
				now,
				decision,
				kept,
				waiversApplied,
				configHash,
				packs,
				message,
				clockSkew,
			);
			const appended = await append(event);
			if (!appended.ok) {
				return blockedVerdict(now, trigger, scope, configHash);
			}
			return { decision, findings: kept, message, eventId, waiversApplied };
		},
	};
}

export type { Waiver, WaiverStore };
