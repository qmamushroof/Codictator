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

function failFinding(
	enforcerId: string,
	code: "CDX-E801" | "CDX-E901" | "CDX-E902" | "CDX-E903",
	detail: string,
	remediation: string,
): Finding {
	return {
		ruleId: enforcerId,
		code,
		message: `the guard "${enforcerId}" ${detail}; the code was not judged`,
		remediation,
	};
}

// SPEC §4.3.8: a throw is CDX-E901, unless the enforcer threw its CdxError
// for unavailable data, which is CDX-E903.
function thrownCode(error: unknown): "CDX-E901" | "CDX-E903" {
	if (typeof error === "object" && error !== null && "code" in error) {
		const code: unknown = error.code;
		if (code === "CDX-E903") {
			return "CDX-E903";
		}
	}
	return "CDX-E901";
}

const TIMED_OUT = { timedOut: true };

function withBudget(
	pending: Promise<Array<Finding>>,
	budgetMs: number,
): Promise<Array<Finding>> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<Array<Finding>>((_resolve, reject) => {
		timer = setTimeout(() => {
			reject(TIMED_OUT);
		}, budgetMs);
	});
	return Promise.race([pending, timeout]).finally(() => {
		if (timer !== undefined) {
			clearTimeout(timer);
		}
	});
}

async function runEnforcer(
	enforcer: Enforcer,
	ctx: CheckContext,
): Promise<Array<Finding>> {
	let pending: Promise<Array<Finding>>;
	try {
		// Rule params arrive with the pack registry (phase 5); E2 runs
		// enforcers with an empty param set.
		pending = enforcer.check(ctx, {});
	} catch (error) {
		return [
			failFinding(
				enforcer.id,
				thrownCode(error),
				"failed with CDX-E901",
				"Fix the guard or retry the hook, then run codictator verify.",
			),
		];
	}
	try {
		return await withBudget(pending, enforcer.budgetMs);
	} catch (error) {
		if (error === TIMED_OUT) {
			return [
				failFinding(
					enforcer.id,
					"CDX-E902",
					`exceeded its ${enforcer.budgetMs} ms budget (CDX-E902)`,
					"Give the guard a larger budget or a smaller scope, then retry.",
				),
			];
		}
		return [
			failFinding(
				enforcer.id,
				thrownCode(error),
				"failed with CDX-E901",
				"Fix the guard or retry the hook, then run codictator verify.",
			),
		];
	}
}

function sortFindings(findings: Array<Finding>): Array<Finding> {
	return [...findings].sort((a, b) => {
		if (a.ruleId !== b.ruleId) {
			return a.ruleId < b.ruleId ? -1 : 1;
		}
		if ((a.path ?? "") !== (b.path ?? "")) {
			return (a.path ?? "") < (b.path ?? "") ? -1 : 1;
		}
		if ((a.line ?? 0) !== (b.line ?? 0)) {
			return (a.line ?? 0) - (b.line ?? 0);
		}
		return a.message < b.message ? -1 : a.message > b.message ? 1 : 0;
	});
}

function appendFailedFinding(): Finding {
	return failFinding(
		"core/engine",
		"CDX-E801",
		"could not record its verdict event (CDX-E801)",
		"Free disk space and fix permissions on .codictator/state/, then retry.",
	);
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
			// SPEC §4.3.9 EC-15: skew never changes the verdict; the event
			// carries the flag so replay can see it.
			const clockSkew = lastNow !== undefined && now < lastNow;
			if (lastNow === undefined || now > lastNow) {
				lastNow = now;
			}
			const ctx: CheckContext = { trigger, scope, now, configHash };
			// SPEC §4.3.3 step 1: a rule runs when the trigger is in its
			// kinds. Scope-glob selection arrives with the pack rule model
			// (phase 5); path-free rules always match, so E2 runs all of them.
			const runnable = ordered.filter((enforcer) =>
				enforcer.kinds.includes(trigger),
			);
			const ran = await Promise.all(
				runnable.map((enforcer) => runEnforcer(enforcer, ctx)),
			);
			const { kept, waiversApplied } = await applyWaivers(
				sortFindings(ran.flat()),
				store,
				now,
			);
			const decision: Decision =
				kept.length === 0
					? "allow"
					: ADVISORY_TRIGGERS.includes(trigger)
						? "advise"
						: "block";
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
			const event: NewEvent = {
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
			// SPEC §4.3.3 step 6: the verdict event appends before the
			// return; an append failure blocks with CDX-E801 (PRD §6 P5).
			const appended = await append(event);
			if (!appended.ok) {
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
			return { decision, findings: kept, message, eventId, waiversApplied };
		},
	};
}

export type { Waiver, WaiverStore };
