// SPEC §4.3.3 step 2 with §4.3.8 fail closed: run the trigger's enforcers
// under budget, then apply waivers to the findings. Sorted enforcer and
// finding order keeps the verdict a pure function of its inputs (§4.3.6).
// An enforcer that throws, exceeds its budget, or lacks data yields a
// synthetic finding and the verdict blocks.
import type { CheckContext, Enforcer, Finding, Trigger } from "./index.ts";
import { applyWaivers, type WaiverStore } from "./waivers.ts";

// SPEC §4.3.9 EC-1: the feedback-only triggers (tool.post.write and stop
// both arrive here as post-tool) allow with the event recorded when no
// enforcer runs; every other trigger with zero enforcers fails closed.
const FEEDBACK_ONLY_TRIGGERS: ReadonlyArray<Trigger> = ["post-tool"];

function failFinding(
	enforcerId: string,
	code: "CDX-E801" | "CDX-E901" | "CDX-E902" | "CDX-E903" | "CDX-E904",
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

export async function runEnforcer(
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

export function sortFindings(findings: Array<Finding>): Array<Finding> {
	return [...findings].sort(compareFindings);
}

function compareText(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

function compareFindingPaths(a: Finding, b: Finding): number {
	return compareText(a.path ?? "", b.path ?? "");
}

function compareFindingContent(a: Finding, b: Finding): number {
	if ((a.line ?? 0) !== (b.line ?? 0)) {
		return (a.line ?? 0) - (b.line ?? 0);
	}
	return compareText(a.message, b.message);
}

function compareFindings(a: Finding, b: Finding): number {
	return (
		compareText(a.ruleId, b.ruleId) ||
		compareFindingPaths(a, b) ||
		compareFindingContent(a, b)
	);
}

export function appendFailedFinding(): Finding {
	return failFinding(
		"core/engine",
		"CDX-E801",
		"could not record its verdict event (CDX-E801)",
		"Free disk space and fix permissions on .codictator/state/, then retry.",
	);
}

// SPEC §4.3.8: zero effective enforcers fail closed with a synthetic CDX-E904
// finding. No guard ran, so the finding names the engine, not a rule.
export function zeroEnforcerFinding(): Finding {
	return failFinding(
		"core/engine",
		"CDX-E904",
		"has no effective enforcer for this trigger (CDX-E904)",
		"Configure a pack with a rule for this trigger, then run codictator verify.",
	);
}

// SPEC §4.3.3 steps 1-3: run the trigger's enforcers, then apply waivers to
// the findings. Zero effective enforcers fail closed with the synthetic
// CDX-E904 finding, except the feedback-only triggers, which allow with the
// event recorded (§4.3.9 EC-1/EC-19).
export async function collectFindings(
	ordered: ReadonlyArray<Enforcer>,
	ctx: CheckContext,
	store: WaiverStore,
): Promise<{
	kept: Array<Finding>;
	waiversApplied: Array<string>;
	zeroEnforcers: boolean;
}> {
	const runnable = ordered.filter((enforcer) =>
		enforcer.kinds.includes(ctx.trigger),
	);
	if (runnable.length === 0) {
		if (FEEDBACK_ONLY_TRIGGERS.includes(ctx.trigger)) {
			return { kept: [], waiversApplied: [], zeroEnforcers: false };
		}
		return {
			kept: [zeroEnforcerFinding()],
			waiversApplied: [],
			zeroEnforcers: true,
		};
	}
	// SPEC §4.3.3 step 2: bounded concurrency — one guard at a time keeps every
	// guard's event-loop share (no E902 herd); sortFindings keeps the verdict byte-identical (§4.3.6).
	const ran: Array<Array<Finding>> = [];
	for (const enforcer of runnable) {
		ran.push(await runEnforcer(enforcer, ctx));
	}
	const { kept, waiversApplied } = await applyWaivers(
		sortFindings(ran.flat()),
		store,
		ctx.now,
	);
	return { kept, waiversApplied, zeroEnforcers: false };
}
